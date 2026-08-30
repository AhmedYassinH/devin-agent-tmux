/**
 * Browser-side transport. One websocket to the local server, with typed
 * send/subscribe and request/response helpers for the two ACP-backed calls.
 *
 * Reconnects on drop: `npm run dev` restarts the server on edit, and a UI that
 * needed a manual refresh after every server reload would be unusable.
 */
import { ConvexClient } from 'convex/browser';
import type { ClientMessage, ServerMessage } from '../server/protocol.js';
import type { AcpSessionSummary } from '../core/acp.js';
import type { AppState, Workspace } from '../core/models.js';
import type { Trace } from '../core/trace.js';

type Listener = (msg: ServerMessage) => void;
type ConvexClientLike = {
  mutation: (name: unknown, args: unknown) => Promise<unknown>;
  onUpdate: (
    name: unknown,
    args: unknown,
    callback: (value: any) => void,
    onError?: (error: Error) => void,
  ) => () => void;
};
type QueuedCommand = { commandId: string; message: string; createdAt: number };

export class Backend {
  private ws: WebSocket | null = null;
  private convex: ConvexClientLike | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private commandQueue: QueuedCommand[] = [];
  private commandTimer: number | null = null;
  private commandInFlight = false;
  private resizeQueue = new Map<string, Extract<ClientMessage, { t: 'pane:resize' }>>();
  private resizeTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private latestState: ServerMessage | null = null;
  private latestEnv: ServerMessage | null = null;
  private latestRuntime = new Map<string, ServerMessage>();
  private snapshots = new Map<string, { snapshot: string; outputVersion: number }>();
  private seenEvents = new Set<string>();
  private readonly profileKey = import.meta.env.VITE_CONVEX_PROFILE || 'default';

  constructor(private url = `ws://${location.hostname}:5173/pty`) {
    const convexUrl = import.meta.env.VITE_CONVEX_URL;
    if (convexUrl) this.connectConvex(convexUrl);
    else this.connect();
  }

  private connectConvex(url: string) {
    this.convex = new ConvexClient(url) as unknown as ConvexClientLike;
    const args = { profileKey: this.profileKey };

    this.convex.onUpdate('mux:pullState', args, (value) => {
      if (!value?.profile) return;
      const workspaces: Record<string, Workspace> = {};
      for (const row of value.workspaces as any[]) {
        try {
          workspaces[row.workspaceId] = {
            id: row.workspaceId,
            name: row.name,
            cwd: row.cwd,
            view: row.view,
            sessionOrder: row.sessionOrder,
            layout: JSON.parse(row.layout),
            sessions: JSON.parse(row.sessions),
            updatedAt: row.updatedAt,
          };
        } catch {
          continue;
        }
      }
      const state: AppState = {
        storeVersion: value.profile.storeVersion,
        activeWorkspaceId: value.profile.activeWorkspaceId ?? null,
        workspaceOrder: value.profile.workspaceOrder.filter((id: string) => Boolean(workspaces[id])),
        workspaces,
      };
      this.emit({ t: 'state', state });
    });

    this.convex.onUpdate('mux:getMachineStatus', args, (value) => {
      if (value) this.emit({ t: 'env', home: value.home, cwd: value.cwd });
    });

    this.convex.onUpdate('mux:terminalState', args, (rows) => {
      for (const row of rows as any[]) {
        const previous = this.snapshots.get(row.paneId);
        this.snapshots.set(row.paneId, {
          snapshot: row.snapshot,
          outputVersion: row.outputVersion,
        });
        if (!previous && row.snapshot) this.emit({ t: 'pane:data', paneId: row.paneId, data: row.snapshot });
        else if (previous && row.outputVersion > previous.outputVersion && row.lastChunk) {
          this.emit({ t: 'pane:data', paneId: row.paneId, data: row.lastChunk });
        }
      }
    });

    this.convex.onUpdate('mux:realtimeEvents', args, (rows) => {
      for (const row of rows as any[]) {
        if (this.seenEvents.has(row.eventId)) continue;
        this.seenEvents.add(row.eventId);
        try {
          this.emit(JSON.parse(row.message) as ServerMessage);
        } catch {
          continue;
        }
      }
    });
  }

  private emit(msg: ServerMessage): void {
    if (msg.t === 'state') this.latestState = msg;
    else if (msg.t === 'env') this.latestEnv = msg;
    else if ('paneId' in msg && msg.t !== 'pane:data') this.latestRuntime.set(`${msg.t}:${msg.paneId}`, msg);
    for (const listener of this.listeners) listener(msg);
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
      this.emit(msg);
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
    if (this.convex) {
      if (msg.t === 'pane:resize') this.enqueueResize(msg);
      else this.enqueue(msg);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  private enqueueResize(msg: Extract<ClientMessage, { t: 'pane:resize' }>): void {
    this.resizeQueue.set(msg.paneId, msg);
    if (this.resizeTimer === null) this.resizeTimer = window.setTimeout(() => this.flushResizes(), 100);
  }

  private flushResizes(): void {
    this.resizeTimer = null;
    const pending = [...this.resizeQueue.values()];
    this.resizeQueue.clear();
    for (const msg of pending) this.enqueue(msg);
  }

  private enqueue(msg: ClientMessage): void {
    const last = this.commandQueue.at(-1);
    if (last && (msg.t === 'pane:input' || msg.t === 'pane:resize')) {
      const previous = JSON.parse(last.message) as ClientMessage;
      if (msg.t === 'pane:input' && previous.t === 'pane:input' && previous.paneId === msg.paneId) {
        last.message = JSON.stringify({ ...msg, data: previous.data + msg.data });
        return;
      }
      if (msg.t === 'pane:resize' && previous.t === 'pane:resize' && previous.paneId === msg.paneId) {
        last.message = JSON.stringify(msg);
        return;
      }
    }
    this.commandQueue.push({
      commandId: crypto.randomUUID(),
      message: JSON.stringify(msg),
      createdAt: Date.now(),
    });
    if (this.commandTimer === null) this.commandTimer = window.setTimeout(() => this.flushCommands(), 16);
  }

  private flushCommands(): void {
    this.commandTimer = null;
    if (!this.convex || this.commandInFlight || this.commandQueue.length === 0) return;
    const commands = this.commandQueue;
    this.commandQueue = [];
    this.commandInFlight = true;
    let retryDelay = 16;
    void this.convex
      .mutation('mux:enqueueCommands', { profileKey: this.profileKey, commands })
      .catch(() => {
        retryDelay = 500;
        this.commandQueue = [...commands, ...this.commandQueue];
      })
      .finally(() => {
        this.commandInFlight = false;
        if (this.commandQueue.length > 0 && this.commandTimer === null) {
          this.commandTimer = window.setTimeout(() => this.flushCommands(), retryDelay);
        }
      });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.latestEnv) listener(this.latestEnv);
    if (this.latestState) listener(this.latestState);
    for (const [paneId, value] of this.snapshots) {
      if (value.snapshot) listener({ t: 'pane:data', paneId, data: value.snapshot });
    }
    for (const message of this.latestRuntime.values()) listener(message);
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
