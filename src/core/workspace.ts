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
import { clearSession, firstEmptyLeafIndex, setLeafAt, templateLayout, type TemplateName } from './layout.js';

export function createWorkspace(state: AppState, name: string, cwd: string, template: TemplateName = '1x2'): AppState {
  const id = makeId('ws');
  const ws: Workspace = {
    id,
    name,
    cwd,
    view: 'grid',
    layout: templateLayout(template),
    sessionOrder: [],
    sessions: {},
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

export function removeSession(state: AppState, wsId: string, sessionId: string): AppState {
  return patch(state, wsId, (ws) => {
    const sessions = { ...ws.sessions };
    delete sessions[sessionId];
    return {
      ...ws,
      sessions,
      sessionOrder: ws.sessionOrder.filter((s) => s !== sessionId),
      layout: clearSession(ws.layout, sessionId),
    };
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
