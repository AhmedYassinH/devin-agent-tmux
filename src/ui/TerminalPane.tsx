/**
 * One xterm terminal bound to one server-side PTY.
 *
 * The terminal is created once and never torn down on re-render: remounting
 * would clear scrollback and, worse, look to the user like the agent restarted.
 * View switches (grid <-> tabs) and reorders therefore move the DOM node, not
 * the terminal.
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Backend } from './backend.js';
import { TERMINAL_FONT, TERMINAL_THEME } from './theme.js';

export function TerminalPane({
  paneId,
  backend,
  onReady,
}: {
  paneId: string;
  backend: Backend;
  /** Called with the initial size, so the caller can spawn at the right dimensions. */
  onReady?: (cols: number, rows: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      // IBM Plex Mono is the system's measuring face (DESIGN.md §3), and the
      // terminal is the one surface that is nothing but measurement.
      fontFamily: TERMINAL_FONT,
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { ...TERMINAL_THEME },
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    // Swallow OSC color *queries* (`ESC]10;?`, `]11;?`, `]12;?`) so xterm never
    // generates a reply for them. Devin queries the terminal's fg/bg/cursor
    // colours at startup; because our replies round-trip browser→server→PTY,
    // they arrive after devin has finished starting and get read as prompt input
    // — the `10;rgb:a6a6/b2b2/c0c0…` garbage. The pane is our themed surface
    // (theme.ts), so a color report is not needed; a non-`?` payload is a real
    // color *set* and is left to xterm's default handler. This fixes both fresh
    // panes and snapshot replay, where the query sits in the backlog too.
    for (const ident of [10, 11, 12]) {
      term.parser.registerOscHandler(ident, (data) => data === '?');
    }

    // Same class of problem for the CSI reports a program can request: Device
    // Attributes (`ESC[c`, `ESC[>c`, `ESC[=c`) and Device Status / cursor
    // position (`ESC[5n`, `ESC[6n`). Under our browser→server→PTY round-trip
    // their replies also arrive too late and land in devin's prompt. Swallow the
    // queries so xterm never replies; these have no visual effect, only a
    // response, and TERM=xterm-256color already tells devin what it needs.
    for (const id of [{ final: 'c' }, { prefix: '>', final: 'c' }, { prefix: '=', final: 'c' }, { final: 'n' }]) {
      term.parser.registerCsiHandler(id, () => true);
    }

    // Belt and braces: also gate onData while a snapshot is being replayed, so
    // any OTHER report the backlog might trigger (Device Attributes, cursor
    // position) is not re-answered into devin's prompt.
    let replaying = false;
    term.onData((data) => {
      if (replaying) return;
      backend.send({ t: 'pane:input', paneId, data });
    });

    // The PTY this terminal points at has usually been running before this
    // xterm existed — we mount fresh on a workspace switch, a grid re-render, or
    // a page reload. `pane:attach` asks the server to replay the pane's recent
    // output so we repaint instead of coming up blank. Until that snapshot lands
    // we queue live bytes and flush them after it, so the older snapshot can
    // never be written on top of newer live output.
    let attached = false;
    const pending: string[] = [];

    const flushPending = () => {
      for (const chunk of pending) term.write(chunk);
      pending.length = 0;
    };

    const off = backend.subscribe((msg) => {
      if (msg.t === 'pane:snapshot' && msg.paneId === paneId && !attached) {
        attached = true;
        if (msg.data) {
          // Suppress replies for the whole snapshot parse, then re-enable and
          // flush live bytes — a query that arrived live is current and should
          // still be answered. The write callback runs after xterm has emitted
          // every reply the backlog would trigger.
          replaying = true;
          term.write(msg.data, () => {
            replaying = false;
            flushPending();
          });
        } else {
          flushPending();
        }
        return;
      }
      if (msg.t === 'pane:data' && msg.paneId === paneId) {
        if (attached) term.write(msg.data);
        else pending.push(msg.data);
      }
      if (msg.t === 'pane:exit' && msg.paneId === paneId) {
        const line = `\r\n\x1b[2m[process exited with code ${msg.code}]\x1b[0m\r\n`;
        if (attached) term.write(line);
        else pending.push(line);
      }
    });

    backend.send({ t: 'pane:attach', paneId });

    // ResizeObserver rather than a window listener: panes resize when a divider
    // moves or a sibling closes, neither of which resizes the window.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        backend.send({ t: 'pane:resize', paneId, cols: term.cols, rows: term.rows });
      } catch {
        /* zero-size while hidden in the tab strip */
      }
    });
    observer.observe(host);

    onReady?.(term.cols, term.rows);

    return () => {
      off();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // paneId identifies the terminal; backend is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  return <div className="term-host" ref={hostRef} />;
}
