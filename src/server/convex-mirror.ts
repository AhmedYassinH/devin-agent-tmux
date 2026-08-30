/**
 * Convex mirror — a sync layer OVER the local file store, never in front of it.
 *
 * The local tree stays authoritative (see store.ts), so this is best-effort by
 * construction: every failure is logged once and swallowed. If Convex is
 * unreachable, unconfigured, or slow, the app keeps working and simply stops
 * syncing — which is the entire reason the file store remained the truth.
 *
 * Two jobs, both optional and additive:
 *
 *   1. State mirror — `push` debounces and last-write-wins per workspace, so a
 *      remote browser can read what a machine has open (workspaces, sessions and
 *      the Kanban board). Nothing here ever writes back down.
 *   2. Realtime relay — when Convex is configured, terminal output, status and
 *      lifecycle events are `publish`ed to Convex, and browser commands are read
 *      back via `start`, so a browser that is NOT on this machine can drive the
 *      panes through Convex instead of the local WebSocket.
 *
 * When no CONVEX_URL is set, both jobs no-op and the app runs exactly as before
 * over the local WebSocket.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { WebSocket as NodeWebSocket } from 'ws';
import type { AppState } from '../core/models.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

type CommandRow = { commandId: string; message: string };
type ConvexClientLike = {
  mutation: (name: unknown, args: unknown) => Promise<unknown>;
  onUpdate: (
    name: unknown,
    args: unknown,
    callback: (value: CommandRow[]) => void,
    onError?: (error: Error) => void,
  ) => () => void;
  close: () => Promise<void>;
};

export class ConvexMirror {
  private client: ConvexClientLike | null = null;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private queued: AppState | null = null;
  private output = new Map<string, string>();
  private outputTimers = new Map<string, NodeJS.Timeout>();
  private outputInFlight = new Set<string>();
  private processing = new Set<string>();
  private commandTail = Promise.resolve();
  private warned = false;
  private readonly profileKey = process.env.CONVEX_PROFILE || 'default';
  private readonly agentId = randomUUID();

  /**
   * Dynamic import so a missing/unconfigured Convex never breaks server startup —
   * offline is a supported mode, not a degraded one. Uses the realtime
   * `ConvexClient` (not the HTTP client) so the server can subscribe to the
   * command queue a remote browser writes into.
   */
  static async create(url: string | undefined): Promise<ConvexMirror> {
    const mirror = new ConvexMirror();
    if (!url) {
      console.log('[convex] no CONVEX_URL set — running local-only, mirror disabled');
      return mirror;
    }
    try {
      const { ConvexClient } = (await import('convex/browser')) as {
        ConvexClient: new (url: string, options?: unknown) => ConvexClientLike;
      };
      // Hand Convex the `ws` package's WebSocket rather than let it pick up
      // Node's built-in undici WebSocket, which is experimental and crashes the
      // client on the first message it receives ("Cannot read properties of
      // null (reading 'length')" in web_socket_manager). `ws` is already a
      // dependency (the app's own server uses it).
      mirror.client = new ConvexClient(url, {
        webSocketConstructor: NodeWebSocket as unknown as typeof WebSocket,
      });
      console.log(`[convex] realtime agent connected to ${url} as ${mirror.profileKey}`);
    } catch (err) {
      console.warn('[convex] client unavailable; running local-only:', (err as Error).message);
    }
    return mirror;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Begin relaying: publish machine presence on a heartbeat, and subscribe to
   * the command queue so a remote browser's input/spawn/resize/kill reach the
   * PTYs. `onCommand` is the server's own message handler.
   */
  start(onCommand: (message: ClientMessage) => Promise<void>): void {
    if (!this.client) return;
    const updateStatus = () =>
      this.fire('mux:updateMachineStatus', {
        profileKey: this.profileKey,
        home: homedir(),
        cwd: process.cwd(),
        agentId: this.agentId,
        hasDefaultContextKey: Boolean(process.env.CONTEXT_DEV_API_KEY?.trim()),
      });
    updateStatus();
    this.heartbeat = setInterval(updateStatus, 10_000);
    this.heartbeat.unref?.();
    this.unsubscribe = this.client.onUpdate(
      'mux:pendingCommands',
      { profileKey: this.profileKey },
      (rows) => this.consume(rows, onCommand),
      (error) => console.warn('[convex] command subscription failed:', error.message),
    );
  }

  /** Relay a server→browser message to Convex. Terminal bytes are batched. */
  publish(message: ServerMessage): void {
    if (!this.client) return;
    if (message.t === 'pane:data') {
      this.publishOutput(message.paneId, message.data);
      return;
    }
    this.fire('mux:publishEvent', {
      profileKey: this.profileKey,
      eventId: randomUUID(),
      message: JSON.stringify(message),
      createdAt: Date.now(),
    });
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribe?.();
    for (const timer of this.outputTimers.values()) clearTimeout(timer);
    for (const paneId of this.output.keys()) this.flushOutput(paneId);
    void this.client?.close();
  }

  private consume(rows: CommandRow[], onCommand: (message: ClientMessage) => Promise<void>): void {
    const pending = rows.filter((row) => !this.processing.has(row.commandId));
    if (pending.length === 0) return;
    for (const row of pending) this.processing.add(row.commandId);
    this.commandTail = this.commandTail.then(async () => {
      for (const row of pending) {
        try {
          await onCommand(JSON.parse(row.message) as ClientMessage);
        } catch (err) {
          console.warn('[convex] command failed:', (err as Error).message);
        }
      }
      try {
        await this.client?.mutation('mux:acknowledgeCommands', {
          profileKey: this.profileKey,
          commandIds: pending.map((row) => row.commandId),
        });
      } catch (err) {
        console.warn('[convex] command acknowledgement failed:', (err as Error).message);
      } finally {
        for (const row of pending) this.processing.delete(row.commandId);
      }
    });
  }

  private publishOutput(paneId: string, data: string): void {
    this.output.set(paneId, `${this.output.get(paneId) ?? ''}${data}`);
    this.scheduleOutput(paneId, 25);
  }

  private scheduleOutput(paneId: string, delay: number): void {
    if (this.outputInFlight.has(paneId) || this.outputTimers.has(paneId)) return;
    const timer = setTimeout(() => this.flushOutput(paneId), delay);
    timer.unref?.();
    this.outputTimers.set(paneId, timer);
  }

  private flushOutput(paneId: string): void {
    this.outputTimers.delete(paneId);
    if (!this.client || this.outputInFlight.has(paneId)) return;
    const queued = this.output.get(paneId);
    if (!queued) return;
    const data = queued.slice(0, 64_000);
    const remaining = queued.slice(data.length);
    if (remaining) this.output.set(paneId, remaining);
    else this.output.delete(paneId);
    this.outputInFlight.add(paneId);
    let retryDelay = 0;
    void this.client
      .mutation('mux:appendOutput', { profileKey: this.profileKey, paneId, data })
      .then(
        () => {
          this.warned = false;
        },
        (err: Error) => {
          retryDelay = 500;
          this.output.set(paneId, `${data}${this.output.get(paneId) ?? ''}`);
          if (!this.warned) console.warn('[convex] realtime mutation failed:', err.message);
          this.warned = true;
        },
      )
      .finally(() => {
        this.outputInFlight.delete(paneId);
        if (this.output.has(paneId)) this.scheduleOutput(paneId, retryDelay);
      });
  }

  private fire(name: string, args: unknown): void {
    if (!this.client) return;
    void this.client.mutation(name, args).then(
      () => {
        this.warned = false;
      },
      (err: Error) => {
        if (!this.warned) console.warn('[convex] realtime mutation failed:', err.message);
        this.warned = true;
      },
    );
  }

  /** Queue a push. Coalesces bursts (a divider drag emits many state updates). */
  push(state: AppState): void {
    if (!this.client) return;
    this.queued = state;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const pending = this.queued;
      this.queued = null;
      if (pending) void this.flush(pending);
    }, 1000);
    this.timer.unref?.();
  }

  private async flush(state: AppState): Promise<void> {
    if (!this.client) return;
    try {
      // Reference the function by path string: the generated `api` object only
      // exists after `convex dev` has run, and the server must start without it.
      await this.client.mutation('mux:pushState', {
        storeVersion: state.storeVersion,
        activeWorkspaceId: state.activeWorkspaceId ?? undefined,
        workspaceOrder: state.workspaceOrder,
        workspaces: state.workspaceOrder
          .map((id) => state.workspaces[id])
          .filter((ws): ws is NonNullable<typeof ws> => Boolean(ws))
          .map((ws) => ({
            id: ws.id,
            name: ws.name,
            cwd: ws.cwd,
            view: ws.view,
            updatedAt: ws.updatedAt,
            // Trees, pane maps and cards are stored opaquely: their shape belongs
            // to core/models.ts, and mirroring it into a Convex schema would mean
            // migrating two stores every time one gains a field.
            layout: JSON.stringify(ws.layout),
            sessions: JSON.stringify(ws.sessions),
            sessionOrder: ws.sessionOrder,
            cards: JSON.stringify(ws.cards ?? {}),
            cardOrder: ws.cardOrder ?? [],
          })),
      });
      this.warned = false;
    } catch (err) {
      if (!this.warned) {
        console.warn('[convex] push failed; local store is unaffected:', (err as Error).message);
        this.warned = true; // once per outage, not once per second
      }
    }
  }
}
