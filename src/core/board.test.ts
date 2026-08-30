import { describe, expect, it } from 'vitest';
import {
  applyCardSession,
  applyCardStatus,
  cardsInColumn,
  columnForStatus,
  createCard,
  markStarted,
  moveCard,
  removeCard,
  updateCard,
} from './board.js';
import { createWorkspace } from './workspace.js';
import { emptyState, type AppState } from './models.js';

/** A state with one workspace, and that workspace's id. */
function withWorkspace(): { state: AppState; wsId: string } {
  const state = createWorkspace(emptyState(), 'app', '/tmp/app');
  return { state, wsId: state.activeWorkspaceId! };
}

const newCard = (title = 'Fix auth') => {
  const { state, wsId } = withWorkspace();
  const created = createCard(state, wsId, { title, description: 'do the thing', cwd: '/tmp/app' });
  return { state: created.state, wsId, id: created.id };
};

describe('createCard', () => {
  it('lands a ticket in the backlog of its workspace and returns its id', () => {
    const { state, wsId, id } = newCard();
    expect(state.workspaces[wsId]!.cardOrder).toEqual([id]);
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('backlog');
    expect(state.workspaces[wsId]!.cards[id]!.paneId).toBeUndefined();
  });

  it('normalises a blank context key to undefined so it cannot shadow the .env default', () => {
    const { state, wsId } = withWorkspace();
    const { state: next, id } = createCard(state, wsId, {
      title: 't',
      description: 'd',
      cwd: '/tmp',
      contextApiKey: '   ',
    });
    expect(next.workspaces[wsId]!.cards[id]!.contextApiKey).toBeUndefined();
  });
});

describe('markStarted', () => {
  it('links the pane, moves to in-progress, and stamps the start once', () => {
    const { state, wsId, id } = newCard();
    const started = markStarted(state, wsId, id, 'pane-1');
    expect(started.workspaces[wsId]!.cards[id]!.paneId).toBe('pane-1');
    expect(started.workspaces[wsId]!.cards[id]!.column).toBe('in-progress');
    const stamp = started.workspaces[wsId]!.cards[id]!.startedAt;
    expect(stamp).toBeTruthy();

    // A restart keeps the original stamp so elapsed time stays honest.
    const restarted = markStarted(started, wsId, id, 'pane-2');
    expect(restarted.workspaces[wsId]!.cards[id]!.startedAt).toBe(stamp);
    expect(restarted.workspaces[wsId]!.cards[id]!.paneId).toBe('pane-2');
  });
});

describe('columnForStatus', () => {
  it('maps a live pane status to its column, idle staying in-progress', () => {
    expect(columnForStatus('running')).toBe('in-progress');
    expect(columnForStatus('idle')).toBe('in-progress');
    expect(columnForStatus('waiting')).toBe('attention');
    expect(columnForStatus('exited')).toBe('done');
  });
});

describe('applyCardStatus', () => {
  it("moves the owning card and leaves other panes' cards alone", () => {
    let { state, wsId, id } = newCard();
    state = markStarted(state, wsId, id, 'pane-1');

    state = applyCardStatus(state, 'pane-1', 'waiting');
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('attention');

    state = applyCardStatus(state, 'pane-1', 'exited');
    expect(state.workspaces[wsId]!.cards[id]!.column).toBe('done');
  });

  it('is a no-op for a pane no card owns (a terminal-grid pane)', () => {
    const { state } = newCard();
    expect(applyCardStatus(state, 'some-terminal-pane', 'running')).toBe(state);
  });
});

describe('applyCardSession', () => {
  it("records Devin's own session slug on the owning card", () => {
    let { state, wsId, id } = newCard();
    state = markStarted(state, wsId, id, 'pane-1');
    state = applyCardSession(state, 'pane-1', 'lofty-utahraptor');
    expect(state.workspaces[wsId]!.cards[id]!.devinSessionId).toBe('lofty-utahraptor');
  });
});

describe('moveCard / updateCard / removeCard / cardsInColumn', () => {
  it('supports manual placement, edits, deletion and column queries', () => {
    let { state, wsId, id } = newCard('one');
    const second = createCard(state, wsId, { title: 'two', description: 'd', cwd: '/tmp' });
    state = second.state;

    state = updateCard(state, wsId, id, { title: 'renamed' });
    expect(state.workspaces[wsId]!.cards[id]!.title).toBe('renamed');

    state = moveCard(state, wsId, id, 'done');
    expect(cardsInColumn(state.workspaces[wsId]!, 'done').map((c) => c.id)).toEqual([id]);
    expect(cardsInColumn(state.workspaces[wsId]!, 'backlog').map((c) => c.id)).toEqual([second.id]);

    state = removeCard(state, wsId, id);
    expect(state.workspaces[wsId]!.cardOrder).toEqual([second.id]);
    expect(state.workspaces[wsId]!.cards[id]).toBeUndefined();
  });
});
