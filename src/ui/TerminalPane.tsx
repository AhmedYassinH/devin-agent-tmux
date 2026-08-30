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

    term.onData((data) => backend.send({ t: 'pane:input', paneId, data }));

    let disposed = false;
    let pendingWrites = 0;
    let disposeRequested = false;
    const write = (data: string) => {
      if (disposed) return;
      pendingWrites++;
      term.write(data, () => {
        pendingWrites--;
        if (disposeRequested && pendingWrites === 0) term.dispose();
      });
    };
    let attached = false;
    const pending: string[] = [];
    let off = () => {};
    const subscribeFrame = requestAnimationFrame(() => {
      if (disposed) return;
      off = backend.subscribe((msg) => {
        if (msg.t === 'pane:snapshot' && msg.paneId === paneId && !attached) {
          attached = true;
          if (msg.data) write(msg.data);
          for (const chunk of pending) write(chunk);
          pending.length = 0;
          return;
        }
        if (msg.t === 'pane:data' && msg.paneId === paneId) {
          if (attached) write(msg.data);
          else pending.push(msg.data);
        }
        if (msg.t === 'pane:exit' && msg.paneId === paneId) {
          const line = `\r\n\x1b[2m[process exited with code ${msg.code}]\x1b[0m\r\n`;
          if (attached) write(line);
          else pending.push(line);
        }
      });
      backend.attach(paneId);
    });

    // ResizeObserver rather than a window listener: panes resize when a divider
    // moves or a sibling closes, neither of which resizes the window.
    let lastCols = 0;
    let lastRows = 0;
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        if (term.cols === lastCols && term.rows === lastRows) return;
        lastCols = term.cols;
        lastRows = term.rows;
        backend.send({ t: 'pane:resize', paneId, cols: term.cols, rows: term.rows });
      } catch {
        /* zero-size while hidden in the tab strip */
      }
    });
    observer.observe(host);

    onReady?.(term.cols, term.rows);

    return () => {
      disposed = true;
      disposeRequested = true;
      cancelAnimationFrame(subscribeFrame);
      off();
      observer.disconnect();
      if (pendingWrites === 0) term.dispose();
      termRef.current = null;
    };
    // paneId identifies the terminal; backend is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  return <div className="term-host" ref={hostRef} />;
}
