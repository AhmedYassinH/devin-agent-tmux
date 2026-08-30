/**
 * Browser-side transport. One websocket to the local server, with typed
 * send/subscribe and request/response helpers for the two ACP-backed calls.
 *
 * Reconnects on drop: `npm run dev` restarts the server on edit, and a UI that
 * needed a manual refresh after every server reload would be unusable.
 */
import type { ClientMessage, ServerMessage } from '../server/protocol.js';
import type { AcpSessionSummary } from '../core/acp.js';
import type { Trace } from '../core/trace.js';

type Listener = (msg: ServerMessage) => void;

export class Backend {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private reconnectTimer: number | null = null;

  constructor(private url = `ws://${location.hostname}:5173/pty`) {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      // Replay anything queued while we were down — a spawn issued during a
      // server restart should still happen, not vanish.
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.reconnectTimer !== null) return;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 1000);
    };

    ws.onerror = () => ws.close();
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Correlated request: send with a reqId, resolve on the matching reply.
   *
   * `match` returns a tagged result rather than throwing, because it runs inside
   * the socket listener where a throw would escape into the message loop and
   * take down every other subscriber.
   */
  private request<T>(
    msg: ClientMessage,
    match: (m: ServerMessage) => { value: T } | { error: string } | undefined,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        off();
        reject(new Error('timed out'));
      }, 90_000);
      const off = this.subscribe((m) => {
        const outcome = match(m);
        if (!outcome) return;
        window.clearTimeout(timer);
        off();
        if ('error' in outcome) reject(new Error(outcome.error));
        else resolve(outcome.value);
      });
      this.send(msg);
    });
  }

  listSessions(cwd: string): Promise<AcpSessionSummary[]> {
    const reqId = Math.random().toString(36).slice(2);
    return this.request<AcpSessionSummary[]>({ t: 'sessions:list', cwd, reqId }, (m) => {
      if (m.t !== 'sessions:result' || m.reqId !== reqId) return undefined;
      return m.error ? { error: m.error } : { value: m.sessions ?? [] };
    });
  }

  loadTrace(sessionId: string, cwd: string): Promise<Trace> {
    const reqId = Math.random().toString(36).slice(2);
    return this.request<Trace>({ t: 'trace:load', sessionId, cwd, reqId }, (m) => {
      if (m.t !== 'trace:result' || m.reqId !== reqId) return undefined;
      if (m.error) return { error: m.error };
      return m.trace ? { value: m.trace } : { error: 'the agent returned no trace' };
    });
  }
}
