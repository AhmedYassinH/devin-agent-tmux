/**
 * Workspace operations — pure state transitions over AppState. The server owns
 * persistence and the UI owns rendering; both go through these so a rename or a
 * pane close means the same thing on either side.
 */
import {
  type AppState,
  type LayoutNode,
  type SessionConfig,
  type Workspace,
  type WorkspaceView,
  makeId,
  STORE_VERSION,
} from './models.js';
import { firstEmptyLeafIndex, layoutForSessions, setLeafAt, templateLayout, type TemplateName } from './layout.js';

/**
 * Last path segment — used to name a workspace after the directory it opens.
 * Falls back rather than returning empty, because a workspace with no name is
 * unclickable in the sidebar.
 */
export function dirBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const last = trimmed.split('/').pop();
  return last && last !== '~' ? last : 'workspace';
}

/**
 * A workspace name not already taken: "app", then "app 2", "app 3"…
 *
 * Imports create a workspace per session, so importing three conversations from
 * one repo would otherwise produce three identically-named rows in the sidebar.
 */
export function uniqueWorkspaceName(state: AppState, base: string): string {
  const taken = new Set(Object.values(state.workspaces).map((ws) => ws.name));
  if (!taken.has(base)) return base;
  // Bounded by the number of existing workspaces: one of these must be free.
  for (let n = 2; n <= taken.size + 2; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function createWorkspace(
  state: AppState,
  name: string,
  cwd: string,
  template: TemplateName = '1x2',
  /**
   * context.dev key for this workspace's panes. Blank is normalised away here
   * rather than at every call site: an empty string would otherwise reach the
   * spawn as a present-but-useless key and shadow the .env default.
   */
  contextApiKey?: string,
): AppState {
  const id = makeId('ws');
  const ws: Workspace = {
    id,
    name,
    cwd,
    view: 'grid',
    layout: templateLayout(template),
    sessionOrder: [],
    sessions: {},
    cards: {},
    cardOrder: [],
    contextApiKey: contextApiKey?.trim() || undefined,
    updatedAt: Date.now(),
  };
  return {
    ...state,
    storeVersion: STORE_VERSION,
    activeWorkspaceId: id,
    workspaceOrder: [...state.workspaceOrder, id],
    workspaces: { ...state.workspaces, [id]: ws },
  };
}

export function removeWorkspace(state: AppState, id: string): AppState {
  const workspaces = { ...state.workspaces };
  delete workspaces[id];
  const workspaceOrder = state.workspaceOrder.filter((w) => w !== id);
  return {
    ...state,
    workspaces,
    workspaceOrder,
    // Fall back to the first remaining workspace, not to null, so the app is
    // never left showing an empty shell when others exist.
    activeWorkspaceId: state.activeWorkspaceId === id ? (workspaceOrder[0] ?? null) : state.activeWorkspaceId,
  };
}

function patch(state: AppState, id: string, fn: (ws: Workspace) => Workspace): AppState {
  const ws = state.workspaces[id];
  if (!ws) return state;
  return { ...state, workspaces: { ...state.workspaces, [id]: { ...fn(ws), updatedAt: Date.now() } } };
}

export function renameWorkspace(state: AppState, id: string, name: string): AppState {
  return patch(state, id, (ws) => ({ ...ws, name }));
}

/**
 * Change a workspace's context.dev key.
 *
 * Takes effect on the NEXT spawn, not on running panes: a pane's MCP config is
 * read by `devin` when the process starts, so a live session keeps the key it
 * launched with. Relaunch the pane to move it onto a new key.
 */
export function setWorkspaceContextApiKey(state: AppState, id: string, key: string): AppState {
  return patch(state, id, (ws) => ({ ...ws, contextApiKey: key.trim() || undefined }));
}

export function setWorkspaceView(state: AppState, id: string, view: WorkspaceView): AppState {
  return patch(state, id, (ws) => ({ ...ws, view }));
}

export function setWorkspaceLayout(state: AppState, id: string, layout: LayoutNode): AppState {
  return patch(state, id, (ws) => ({ ...ws, layout }));
}

/**
 * Apply a layout template, preserving live panes.
 *
 * Panes that no longer fit are NOT dropped from `sessions` — the caller decides
 * whether to kill them. Silently discarding a running agent because the grid
 * shrank is exactly the kind of data loss the user cannot undo.
 */
export function applyTemplate(state: AppState, id: string, template: TemplateName): AppState {
  return patch(state, id, (ws) => {
    let layout = templateLayout(template);
    ws.sessionOrder.forEach((sid, i) => {
      layout = setLeafAt(layout, i, sid);
    });
    return { ...ws, layout };
  });
}

/** Add a pane and seat it in the first free slot. */
export function addSession(state: AppState, wsId: string, session: SessionConfig): AppState {
  return patch(state, wsId, (ws) => {
    const slot = firstEmptyLeafIndex(ws.layout);
    return {
      ...ws,
      sessions: { ...ws.sessions, [session.id]: session },
      sessionOrder: [...ws.sessionOrder, session.id],
      layout: slot === -1 ? ws.layout : setLeafAt(ws.layout, slot, session.id),
    };
  });
}

/**
 * Close a pane and SHRINK the grid to what is left.
 *
 * The alternative — blanking the leaf and keeping the slot — leaves an empty
 * launcher sitting where the terminal was, and makes the Terminals count
 * disagree with the number of panes actually on screen. Reshaping costs the
 * divider positions, which is the right thing to lose when the grid changes
 * shape anyway.
 */
export function removeSession(state: AppState, wsId: string, sessionId: string): AppState {
  return patch(state, wsId, (ws) => {
    const sessions = { ...ws.sessions };
    delete sessions[sessionId];
    const sessionOrder = ws.sessionOrder.filter((s) => s !== sessionId);
    return { ...ws, sessions, sessionOrder, layout: layoutForSessions(sessionOrder) };
  });
}

export function updateSession(
  state: AppState,
  wsId: string,
  sessionId: string,
  fields: Partial<SessionConfig>,
): AppState {
  return patch(state, wsId, (ws) => {
    const prev = ws.sessions[sessionId];
    if (!prev) return ws;
    return { ...ws, sessions: { ...ws.sessions, [sessionId]: { ...prev, ...fields } } };
  });
}

/** Reorder panes (tab drag). Rebuilds the layout so the grid follows the strip. */
export function reorderSessions(state: AppState, wsId: string, order: string[]): AppState {
  return patch(state, wsId, (ws) => {
    let layout = ws.layout;
    order.forEach((sid, i) => {
      layout = setLeafAt(layout, i, sid);
    });
    return { ...ws, sessionOrder: order, layout };
  });
}
