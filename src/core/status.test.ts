import { describe, expect, it } from 'vitest';
import { applyExit, applyOutput, applySignal, initialPaneState, workspaceNeedsAttention } from './status.js';

const t0 = 1_000;

describe('applySignal', () => {
  it('moves the badge on a status signal', () => {
    const s = applySignal(initialPaneState(t0), { kind: 'status', status: 'waiting' });
    expect(s.status).toBe('waiting');
    expect(s.hooked).toBe(true);
  });

  it('records the session id WITHOUT moving the badge', () => {
    // Identity is not status: an id arriving must never clear a "needs you" badge.
    const waiting = applySignal(initialPaneState(t0), { kind: 'status', status: 'waiting' });
    const s = applySignal(waiting, { kind: 'session', devinSessionId: 'trail-aardwolf' });
    expect(s.devinSessionId).toBe('trail-aardwolf');
    expect(s.status).toBe('waiting');
  });
});

describe('applyOutput', () => {
  it('promotes idle to running before any hook has spoken', () => {
    expect(applyOutput(initialPaneState(t0), t0 + 1).status).toBe('running');
  });

  it('never overrides a hook-reported status', () => {
    // Regression guard: Devin redraws its spinner constantly, and letting output
    // volume speak would clear a "waiting" badge the user still needs to act on.
    const waiting = applySignal(initialPaneState(t0), { kind: 'status', status: 'waiting' });
    expect(applyOutput(waiting, t0 + 5).status).toBe('waiting');
  });
});

describe('applyExit', () => {
  it('is terminal', () => {
    const running = applySignal(initialPaneState(t0), { kind: 'status', status: 'running' });
    expect(applyExit(running).status).toBe('exited');
  });
});

describe('workspaceNeedsAttention', () => {
  it('is true only when a pane is blocked on the user', () => {
    const idle = initialPaneState(t0);
    const running = applySignal(idle, { kind: 'status', status: 'running' });
    const waiting = applySignal(idle, { kind: 'status', status: 'waiting' });
    expect(workspaceNeedsAttention([idle, running])).toBe(false);
    expect(workspaceNeedsAttention([idle, waiting])).toBe(true);
  });
});
