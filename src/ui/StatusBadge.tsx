import type { PaneStatus } from '../core/models.js';
import type { ContextHealth } from '../core/context-health.js';

const LABEL: Record<PaneStatus, string> = {
  idle: 'idle',
  running: 'running',
  waiting: 'waiting',
  exited: 'exited',
};

export function StatusBadge({ status }: { status: PaneStatus }) {
  return (
    <span className={`badge badge-${status}`} title={`Devin session is ${LABEL[status]}`}>
      <i className="dot" />
      {LABEL[status]}
    </span>
  );
}

/**
 * Context occupancy. The tooltip states that the figure is an estimate and shows
 * the exact cumulative counters beside it — the derivation is explained in
 * core/context-health.ts, and a badge that implied precision it does not have
 * would be worse than no badge.
 */
export function ContextBadge({ health }: { health: ContextHealth | undefined }) {
  if (!health) return null;
  const pct = Math.round(health.pct * 100);
  const k = (n: number) => `${Math.round(n / 100) / 10}k`;
  return (
    <span
      className={`badge ctx ctx-${health.tier}`}
      title={
        `~${pct}% of a ${k(health.windowMax)} window (estimated from per-turn export deltas)\n` +
        `model: ${health.model ?? 'unknown'}\n` +
        `cumulative: ${k(health.totalPromptTokens)} prompt / ${k(health.totalCompletionTokens)} completion`
      }
    >
      {pct}%
    </span>
  );
}
