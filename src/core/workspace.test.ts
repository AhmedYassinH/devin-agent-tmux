import { describe, expect, it } from 'vitest';
import { addSession, createWorkspace, dirBasename, removeSession, uniqueWorkspaceName } from './workspace.js';
import { emptyState, type SessionConfig } from './models.js';
import { collectLeaves } from './layout.js';

const session = (id: string): SessionConfig => ({
  id,
  cwd: '/tmp',
  permissionMode: 'auto',
  createdAt: 0,
});

describe('dirBasename', () => {
  it('names a workspace after its directory', () => {
    expect(dirBasename('/Users/me/projects/my-repo')).toBe('my-repo');
  });
  it('ignores a trailing slash', () => {
    expect(dirBasename('/Users/me/projects/my-repo/')).toBe('my-repo');
  });
  it('falls back rather than producing an unclickable empty name', () => {
    expect(dirBasename('/')).toBe('workspace');
    expect(dirBasename('~')).toBe('workspace');
  });
});

describe('uniqueWorkspaceName', () => {
  it('keeps the base name when it is free', () => {
    expect(uniqueWorkspaceName(emptyState(), 'app')).toBe('app');
  });

  it('suffixes on collision, so imports from one repo stay distinguishable', () => {
    let s = createWorkspace(emptyState(), 'app', '/tmp/app');
    expect(uniqueWorkspaceName(s, 'app')).toBe('app 2');
    s = createWorkspace(s, 'app 2', '/tmp/app');
    expect(uniqueWorkspaceName(s, 'app')).toBe('app 3');
  });
});

describe('createWorkspace', () => {
  it('makes the new workspace active, which is how callers learn its id', () => {
    const s = createWorkspace(emptyState(), 'app', '/tmp/app');
    expect(s.activeWorkspaceId).toBeTruthy();
    expect(s.workspaces[s.activeWorkspaceId!]?.name).toBe('app');
  });
});

describe('addSession / removeSession', () => {
  it('seats a pane in the first free slot and frees it again on close', () => {
    let s = createWorkspace(emptyState(), 'app', '/tmp/app');
    const wsId = s.activeWorkspaceId!;
    s = addSession(s, wsId, session('p1'));
    expect(collectLeaves(s.workspaces[wsId]!.layout)).toEqual(['p1', null]);

    s = removeSession(s, wsId, 'p1');
    expect(collectLeaves(s.workspaces[wsId]!.layout)).toEqual([null]);
    expect(s.workspaces[wsId]!.sessionOrder).toEqual([]);
  });
});

describe('removeSession shrinks the grid', () => {
  it('drops the slot, not just the pane, so no empty launcher is left behind', () => {
    let s = createWorkspace(emptyState(), 'app', '/tmp/app');
    const wsId = s.activeWorkspaceId!;
    s = addSession(s, wsId, session('p1'));
    s = addSession(s, wsId, session('p2'));
    expect(collectLeaves(s.workspaces[wsId]!.layout)).toEqual(['p1', 'p2']);

    s = removeSession(s, wsId, 'p1');
    // Two terminals became one — not one terminal plus a hole.
    expect(collectLeaves(s.workspaces[wsId]!.layout)).toEqual(['p2']);
    expect(s.workspaces[wsId]!.sessionOrder).toEqual(['p2']);
  });

  it('leaves exactly one empty slot when the last pane closes', () => {
    let s = createWorkspace(emptyState(), 'app', '/tmp/app');
    const wsId = s.activeWorkspaceId!;
    s = addSession(s, wsId, session('p1'));
    s = removeSession(s, wsId, 'p1');
    expect(collectLeaves(s.workspaces[wsId]!.layout)).toEqual([null]);
  });
});
