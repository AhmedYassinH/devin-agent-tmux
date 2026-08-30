/**
 * Kanban board operations — pure state transitions over AppState, the same
 * shape and discipline as core/workspace.ts. Cards live INSIDE a workspace
 * (`workspace.cards`), because the board is just a third way to look at one
 * workspace — its tickets run agents in that workspace's directory and bill to
 * its context.dev key. So every mutation is addressed by `(wsId, cardId)`, and
 * the two "an agent changed" appliers scan the workspaces to find the owner.
 *
 * A card is a ticket. Before it is Started it is just text the user wrote; after
 * Start it owns a Devin session (a supervised pane) and its column follows that
 * session's live status rather than being placed by hand — see columnForStatus.
 */
import {
  type AppState,
  type Card,
  type CardColumn,
  type DevinPermissionMode,
  type PaneStatus,
  type Workspace,
  DEFAULT_PERMISSION_MODE,
  makeId,
} from './models.js';

export interface NewCardFields {
  title: string;
  description: string;
  cwd: string;
  model?: string;
  permissionMode?: DevinPermissionMode;
  contextApiKey?: string;
}

/** Patch one workspace in place, bumping its updatedAt like core/workspace.ts. */
function patchWs(state: AppState, wsId: string, fn: (ws: Workspace) => Workspace): AppState {
  const ws = state.workspaces[wsId];
  if (!ws) return state;
  return { ...state, workspaces: { ...state.workspaces, [wsId]: { ...fn(ws), updatedAt: Date.now() } } };
}

/** Patch one card within a workspace. */
function patchCard(state: AppState, wsId: string, id: string, fn: (card: Card) => Card): AppState {
  const ws = state.workspaces[wsId];
  const card = ws?.cards[id];
  if (!ws || !card) return state;
  return patchWs(state, wsId, (w) => ({ ...w, cards: { ...w.cards, [id]: fn(card) } }));
}

/** Add a ticket to a workspace's backlog and return its id alongside the state. */
export function createCard(
  state: AppState,
  wsId: string,
  fields: NewCardFields,
): { state: AppState; id: string } {
  const id = makeId('card');
  const card: Card = {
    id,
    title: fields.title.trim(),
    description: fields.description,
    cwd: fields.cwd.trim(),
    column: 'backlog',
    model: fields.model,
    permissionMode: fields.permissionMode ?? DEFAULT_PERMISSION_MODE,
    // Blank normalises to undefined so it cannot shadow the .env default at
    // spawn — the same trap workspace keys avoid (see core/mcp.ts).
    contextApiKey: fields.contextApiKey?.trim() || undefined,
    createdAt: Date.now(),
  };
  return {
    id,
    state: patchWs(state, wsId, (ws) => ({
      ...ws,
      cards: { ...ws.cards, [id]: card },
      cardOrder: [...ws.cardOrder, id],
    })),
  };
}

/** Edit a ticket's fields. Only ever called on a backlog card from the UI. */
export function updateCard(state: AppState, wsId: string, id: string, fields: Partial<Card>): AppState {
  return patchCard(state, wsId, id, (card) => ({ ...card, ...fields }));
}

export function removeCard(state: AppState, wsId: string, id: string): AppState {
  return patchWs(state, wsId, (ws) => {
    const cards = { ...ws.cards };
    delete cards[id];
    return { ...ws, cards, cardOrder: ws.cardOrder.filter((c) => c !== id) };
  });
}

/** Move a card to a column by hand (drag-and-drop, or Reopen). */
export function moveCard(state: AppState, wsId: string, id: string, column: CardColumn): AppState {
  return patchCard(state, wsId, id, (card) => ({ ...card, column }));
}

/**
 * Record that a ticket has been Started: it now owns pane `paneId`, has moved to
 * In Progress, and stamps its start time (only the first time — a Restart keeps
 * the original stamp so "how long has this ticket been worked" stays honest).
 */
export function markStarted(state: AppState, wsId: string, id: string, paneId: string): AppState {
  return patchCard(state, wsId, id, (card) => ({
    ...card,
    paneId,
    column: 'in-progress',
    startedAt: card.startedAt ?? Date.now(),
  }));
}

/**
 * The column a started card belongs in, given its pane's live status.
 *
 *   running -> in-progress   the agent is working
 *   waiting -> attention     it is blocked on the user (the one column that
 *                            earns a warning colour on the board)
 *   idle    -> in-progress   between turns, session still alive — not "done":
 *                            Devin stays resident after a turn, so idle is a
 *                            pause, and only the process exiting is completion
 *   exited  -> done          the session ended
 *
 * Returns null for a status that should not move the card, so a plain status
 * echo can never yank a card the user is mid-drag on.
 */
export function columnForStatus(status: PaneStatus): CardColumn | null {
  switch (status) {
    case 'running':
    case 'idle':
      return 'in-progress';
    case 'waiting':
      return 'attention';
    case 'exited':
      return 'done';
    default:
      return null;
  }
}

/** The (workspace, card) that owns a pane, scanning every workspace. */
function findCardByPane(state: AppState, paneId: string): { wsId: string; id: string } | null {
  for (const wsId of state.workspaceOrder) {
    const ws = state.workspaces[wsId];
    if (!ws) continue;
    const id = ws.cardOrder.find((c) => ws.cards[c]?.paneId === paneId);
    if (id) return { wsId, id };
  }
  return null;
}

/**
 * Apply a pane status to whichever card owns that pane. No-op if no card does
 * (the pane is a terminal-grid pane, not a ticket) or the status does not map.
 */
export function applyCardStatus(state: AppState, paneId: string, status: PaneStatus): AppState {
  const found = findCardByPane(state, paneId);
  if (!found) return state;
  const column = columnForStatus(status);
  if (!column || state.workspaces[found.wsId]?.cards[found.id]?.column === column) return state;
  return moveCard(state, found.wsId, found.id, column);
}

/** Learn a card's Devin session id from the SessionStart hook (see §4). */
export function applyCardSession(state: AppState, paneId: string, devinSessionId: string): AppState {
  const found = findCardByPane(state, paneId);
  if (!found) return state;
  return patchCard(state, found.wsId, found.id, (card) => ({ ...card, devinSessionId }));
}

/** Cards in a given column of a workspace, in board order. */
export function cardsInColumn(ws: Workspace, column: CardColumn): Card[] {
  return ws.cardOrder
    .map((id) => ws.cards[id])
    .filter((c): c is Card => Boolean(c) && c!.column === column);
}
