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
import type { AppState } from '../core/models.js';

type ConvexClientLike = { mutation: (name: unknown, args: unknown) => Promise<unknown> };

export class ConvexMirror {
  private client: ConvexClientLike | null = null;
  private timer: NodeJS.Timeout | null = null;
  private queued: AppState | null = null;
  private warned = false;

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
      const { ConvexHttpClient } = (await import('convex/browser')) as {
        ConvexHttpClient: new (url: string) => ConvexClientLike;
      };
      mirror.client = new ConvexHttpClient(url);
      console.log(`[convex] mirroring to ${url}`);
    } catch (err) {
      console.warn('[convex] client unavailable; running local-only:', (err as Error).message);
    }
    return mirror;
  }

  get enabled(): boolean {
    return this.client !== null;
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
