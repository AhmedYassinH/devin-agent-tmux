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
    termRef.current = term;

    // Swallow OSC color *queries* (`ESC]10;?`, `]11;?`, `]12;?`) so xterm never
    // generates a reply for them. Devin queries the terminal's fg/bg/cursor
    // colours at startup; because our replies round-trip browser→server→PTY,
    // they arrive after devin has finished starting and get read as prompt input
    // — the `10;rgb:a6a6/b2b2/c0c0…` garbage. The pane is our themed surface
    // (theme.ts), so a color report is not needed; a non-`?` payload is a real
    // color *set* and is left to xterm's default handler. Because these run for
    // replayed backlog too, the snapshot can't re-trigger a reply either.
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

    term.onData((data) => backend.send({ t: 'pane:input', paneId, data }));

    // Nothing is written to xterm until it has been fit at least once: calling
    // fit() — or writing — before the renderer has real dimensions throws
    // "Cannot read properties of undefined (reading 'dimensions')", and a pane
    // that mounts hidden (the tab strip) or before layout has flushed has zero
    // size. So output queues in `pending` and is flushed once `ready`. `attached`
    // is the separate attach handshake: pane:data that arrives before the
    // backlog snapshot is held so the older snapshot can't land on newer bytes.
    let disposed = false;
    let ready = false;
    let attached = false;
    const pending: string[] = [];

    const flush = () => {
      if (!ready || !attached || disposed) return;
      for (const chunk of pending) term.write(chunk);
      pending.length = 0;
    };

    // First successful fit: needs the renderer up (next frame) and a sized host.
    const tryReady = () => {
      if (ready || disposed) return;
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return; // renderer not ready yet; ResizeObserver will retry
      }
      ready = true;
      backend.send({ t: 'pane:resize', paneId, cols: term.cols, rows: term.rows });
      onReady?.(term.cols, term.rows);
      flush();
    };
    requestAnimationFrame(tryReady);

    const off = backend.subscribe((msg) => {
      if (msg.t === 'pane:snapshot' && msg.paneId === paneId && !attached) {
        attached = true;
        if (msg.data) pending.unshift(msg.data); // backlog goes before live bytes
        flush();
        return;
      }
      if (msg.t === 'pane:data' && msg.paneId === paneId) {
        pending.push(msg.data);
        flush();
      }
      if (msg.t === 'pane:exit' && msg.paneId === paneId) {
        pending.push(`\r\n\x1b[2m[process exited with code ${msg.code}]\x1b[0m\r\n`);
        flush();
      }
    });

    backend.send({ t: 'pane:attach', paneId });

    // ResizeObserver rather than a window listener: panes resize when a divider
    // moves or a sibling closes, neither of which resizes the window. It also
    // fires once on observe, which is how a pane that mounted hidden becomes
    // ready the moment it is shown.
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (!ready) {
        tryReady();
        return;
      }
      try {
        fit.fit();
        backend.send({ t: 'pane:resize', paneId, cols: term.cols, rows: term.rows });
      } catch {
        /* zero-size while hidden in the tab strip */
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
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
