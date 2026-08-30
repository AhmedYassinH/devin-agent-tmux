/**
 * Convex mirror — a sync layer OVER the local file store, never in front of it.
 *
 * The local tree stays authoritative (see store.ts), so this is best-effort by
 * construction: every failure is logged once and swallowed. If Convex is
 * unreachable, unconfigured, or slow, the app keeps working and simply stops
 * syncing — which is the entire reason the file store remained the truth.
 *
 * Pushes are debounced and last-write-wins per workspace. Two hosts editing the
 * same workspace concurrently is not a case this resolves; it is a case it does
 * not corrupt, because the loser can always re-push from its own local tree.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
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
  private processing = new Set<string>();
  private commandTail = Promise.resolve();
  private warned = false;
  private readonly profileKey = process.env.CONVEX_PROFILE || 'default';
  private readonly agentId = randomUUID();

  /**
   * Dynamic import so a missing/unconfigured Convex never breaks server startup —
   * offline is a supported mode, not a degraded one.
   */
  static async create(url: string | undefined): Promise<ConvexMirror> {
    const mirror = new ConvexMirror();
    if (!url) {
      console.log('[convex] no CONVEX_URL set — running local-only, mirror disabled');
      return mirror;
    }
    try {
      const { ConvexClient } = (await import('convex/browser')) as {
        ConvexClient: new (url: string) => ConvexClientLike;
      };
      mirror.client = new ConvexClient(url);
      console.log(`[convex] realtime agent connected to ${url} as ${mirror.profileKey}`);
    } catch (err) {
      console.warn('[convex] client unavailable; running local-only:', (err as Error).message);
    }
    return mirror;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  start(onCommand: (message: ClientMessage) => Promise<void>): void {
    if (!this.client) return;
    const updateStatus = () =>
      this.fire('mux:updateMachineStatus', {
        profileKey: this.profileKey,
        home: homedir(),
        cwd: process.cwd(),
        agentId: this.agentId,
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
    for (const row of rows) {
      if (this.processing.has(row.commandId)) continue;
      this.processing.add(row.commandId);
      this.commandTail = this.commandTail.then(async () => {
        try {
          await onCommand(JSON.parse(row.message) as ClientMessage);
        } catch (err) {
          console.warn('[convex] command failed:', (err as Error).message);
        }
        try {
          await this.client?.mutation('mux:acknowledgeCommand', {
            profileKey: this.profileKey,
            commandId: row.commandId,
          });
        } catch (err) {
          console.warn('[convex] command acknowledgement failed:', (err as Error).message);
        } finally {
          this.processing.delete(row.commandId);
        }
      });
    }
  }

  private publishOutput(paneId: string, data: string): void {
    this.output.set(paneId, `${this.output.get(paneId) ?? ''}${data}`);
    if (this.outputTimers.has(paneId)) return;
    const timer = setTimeout(() => this.flushOutput(paneId), 25);
    timer.unref?.();
    this.outputTimers.set(paneId, timer);
  }

  private flushOutput(paneId: string): void {
    this.outputTimers.delete(paneId);
    const data = this.output.get(paneId);
    this.output.delete(paneId);
    if (!data) return;
    this.fire('mux:appendOutput', { profileKey: this.profileKey, paneId, data });
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
            // Trees and pane maps are stored opaquely: their shape belongs to
            // core/models.ts, and mirroring it into a Convex schema would mean
            // migrating two stores every time a layout gains a field.
            layout: JSON.stringify(ws.layout),
            sessions: JSON.stringify(ws.sessions),
            sessionOrder: ws.sessionOrder,
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
