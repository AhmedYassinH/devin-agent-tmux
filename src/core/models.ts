/**
 * Framework-agnostic models. Nothing here imports React, node, or a transport —
 * the server and the browser both build on these, and the pure logic modules
 * (layout, workspace, status, trace) operate only on these shapes.
 */

/** Pane lifecycle as the UI understands it. Driven by Devin hooks over OSC-777. */
export type PaneStatus = 'idle' | 'running' | 'waiting' | 'exited';

/**
 * Devin's permission postures, verbatim from `devin --permission-mode`. Devin
 * has a richer ladder than Claude Code's binary skip/don't-skip: `smart` runs a
 * fast model as the judge. We keep Devin's own vocabulary rather than inventing
 * a mapping, so the UI label and the CLI flag can never drift apart.
 */
export type DevinPermissionMode = 'auto' | 'accept-edits' | 'smart' | 'dangerous';

/**
 * The posture every pane launches with.
 *
 * `accept-edits` auto-approves workspace edits, so an agent can write files
 * without stopping to ask. It does NOT auto-approve everything — shell commands
 * and other side-effecting tools still raise a permission request, which is what
 * drives the `waiting` badge.
 *
 * Not exposed as a launch-form field: a pane is the real Devin TUI, and
 * `Shift+Tab` cycles the mode there (Normal -> Accept Edits -> Smart -> Bypass).
 * Choosing it twice, in two places, is how the two get out of step.
 */
export const DEFAULT_PERMISSION_MODE: DevinPermissionMode = 'accept-edits';

/** One pane: a `devin` process in a PTY, plus what we know about its session. */
export interface SessionConfig {
  /** Our id for the pane. Stable across restarts; NOT Devin's session id. */
  id: string;
  name?: string;
  /** Working directory the process was spawned in. */
  cwd: string;
  /**
   * Devin's own session id (a slug like `lofty-utahraptor`).
   *
   * Devin has no `--session-id` to pin this at launch the way Claude Code does,
   * so we cannot dictate it — we LEARN it: every Devin hook payload carries a
   * stable `session_id`, and our SessionStart hook echoes it back over OSC-777.
   * Undefined until that hook fires (a second or two after spawn), which is why
   * every consumer treats it as optional.
   */
  devinSessionId?: string;
  model?: string;
  permissionMode: DevinPermissionMode;
  /** First-turn prompt, passed positionally after `--`. */
  prompt?: string;
  /** When set, the pane launched with `devin -r <id>` instead of fresh. */
  resumeSessionId?: string;
  /** Absolute path of this pane's `--export` transcript (context-health input). */
  exportPath?: string;
  createdAt: number;
}

/** Layout is a binary-ish tree; leaves hold a pane id (or nothing, when empty). */
export type LayoutNode =
  | { type: 'leaf'; sessionId: string | null }
  | { type: 'split'; dir: 'row' | 'col'; sizes: number[]; children: LayoutNode[] };

export type WorkspaceView = 'grid' | 'tabs';

export interface Workspace {
  id: string;
  name: string;
  /** Default cwd new panes inherit. */
  cwd: string;
  view: WorkspaceView;
  layout: LayoutNode;
  /** Pane order — drives the tab strip and the sidebar. */
  sessionOrder: string[];
  sessions: Record<string, SessionConfig>;
  updatedAt: number;
}

export interface AppState {
  /**
   * Bumped only on a breaking change to the on-disk shape. A profile written by
   * a NEWER build is left strictly untouched rather than downgraded.
   */
  storeVersion: number;
  activeWorkspaceId: string | null;
  workspaceOrder: string[];
  workspaces: Record<string, Workspace>;
}

export const STORE_VERSION = 1;

export function emptyState(): AppState {
  return { storeVersion: STORE_VERSION, activeWorkspaceId: null, workspaceOrder: [], workspaces: {} };
}

/** URL-safe id. Not a uuid — these show up in file paths and the sidebar. */
export function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
