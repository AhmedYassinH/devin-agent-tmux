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

export type WorkspaceView = 'grid' | 'tabs' | 'board';

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
  /**
   * Kanban tickets for this workspace, and their board order.
   *
   * Per-workspace rather than app-global: a ticket runs an agent in the
   * workspace's directory and bills to its context.dev key, so the board is
   * just a third way to look at one workspace — alongside the grid and the tab
   * strip — not a separate place. See core/board.ts.
   */
  cards: Record<string, Card>;
  cardOrder: string[];
  /**
   * context.dev API key for the panes in this workspace.
   *
   * Collected when the workspace is created and used at spawn time to write the
   * pane's `mcp_config.json`. Optional: when it is unset every pane falls back
   * to CONTEXT_DEV_API_KEY from the server's `.env`, which is what makes
   * context.dev a default rather than something each workspace must opt into.
   * Per-workspace rather than global so two workspaces can bill to two accounts.
   */
  contextApiKey?: string;
  updatedAt: number;
}

/**
 * A Kanban column, and the whole lifecycle of a ticket.
 *
 * A card starts in `backlog` (a ticket the user wrote, no agent yet). Clicking
 * Start spawns a Devin session with the card's description as its first-turn
 * prompt, and from then on the column tracks the pane's live status rather than
 * being dragged by hand — see `columnForStatus` in core/board.ts:
 *
 *   running -> in-progress · waiting -> attention · exited -> done
 *
 * This is the board's answer to "ditch the terminal": the ticket IS the unit of
 * work, and its column is the true state of the agent working it.
 */
export type CardColumn = 'backlog' | 'in-progress' | 'attention' | 'done';

export const CARD_COLUMNS: CardColumn[] = ['backlog', 'in-progress', 'attention', 'done'];

/**
 * One ticket on the Kanban board.
 *
 * The board is app-level, not owned by a workspace: a card carries its own
 * `cwd`, so tickets for different repos can live on one board and a user can
 * work entirely from here without ever opening the terminal grid.
 *
 * `paneId` doubles as the id of the PTY the server supervises — the same
 * mechanism a terminal pane uses, so a card's live session gets status, context
 * health and an embedded terminal for free. Undefined until the card is Started.
 */
export interface Card {
  id: string;
  title: string;
  /** Handed to Devin as the first-turn prompt when the card is Started. */
  description: string;
  /** Working directory the agent runs in. Absolute, or `~/…`. */
  cwd: string;
  column: CardColumn;
  /** Set on Start; the id of the supervised pane. Also see `devinSessionId`. */
  paneId?: string;
  /** Devin's own session slug, learned from the SessionStart hook (see §4). */
  devinSessionId?: string;
  model?: string;
  permissionMode: DevinPermissionMode;
  /** context.dev key for this card's session; falls back to CONTEXT_DEV_API_KEY. */
  contextApiKey?: string;
  createdAt: number;
  /** When Start was first clicked. */
  startedAt?: number;
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
  return {
    storeVersion: STORE_VERSION,
    activeWorkspaceId: null,
    workspaceOrder: [],
    workspaces: {},
  };
}

/** URL-safe id. Not a uuid — these show up in file paths and the sidebar. */
export function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
