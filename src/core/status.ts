/**
 * Status reducer. Hook signals are authoritative; a coarse stream heuristic
 * covers the window before the first hook fires (a pane launched into a repo
 * Devin has not yet trusted, say, sits at a prompt having emitted nothing).
 *
 * Precedence matters: once a hook has spoken for a pane we stop trusting the
 * heuristic entirely, because output volume says nothing about whether the agent
 * is waiting on the user.
 */
import type { PaneStatus } from './models.js';
import type { OscSignal } from './osc.js';

export interface PaneState {
  status: PaneStatus;
  devinSessionId?: string;
  /** Set once any hook signal has been seen; disables the heuristic. */
  hooked: boolean;
  lastOutputAt: number;
}

export function initialPaneState(now: number): PaneState {
  return { status: 'idle', hooked: false, lastOutputAt: now };
}

/** Fold one OSC signal into pane state. */
export function applySignal(state: PaneState, signal: OscSignal): PaneState {
  if (signal.kind === 'session') {
    // Identity, not status — an id arriving must never move the badge.
    return { ...state, devinSessionId: signal.devinSessionId, hooked: true };
  }
  return { ...state, status: signal.status, hooked: true };
}

/**
 * Fold a chunk of PTY output in. Only ever promotes idle -> running, and only
 * before the first hook: it cannot detect `waiting`, so letting it run later
 * would clear a "needs your approval" badge the moment Devin redrew its spinner.
 */
export function applyOutput(state: PaneState, now: number): PaneState {
  const next = { ...state, lastOutputAt: now };
  if (state.hooked) return next;
  return state.status === 'idle' ? { ...next, status: 'running' } : next;
}

/** The process exited — terminal, and outranks anything a late hook says. */
export function applyExit(state: PaneState): PaneState {
  return { ...state, status: 'exited' };
}

/** A workspace wants attention when any pane is blocked on the user. */
export function workspaceNeedsAttention(states: PaneState[]): boolean {
  return states.some((s) => s.status === 'waiting');
}
