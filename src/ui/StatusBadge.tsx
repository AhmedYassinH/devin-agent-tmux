/**
 * Status dot plus readout label (DESIGN.md §4, "Status dot").
 *
 * 6px dot, `radius: full`, always followed by a readout label 8px to its right
 * — never the dot alone, because colour on its own is not a signal a
 * colour-blind or low-vision user can read. Running pulses; nothing else moves.
 */
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
    <span className={`status status-${status}`} title={`Devin session is ${LABEL[status]}`}>
      <i className="dot" aria-hidden="true" />
      <span className="status-label">{LABEL[status]}</span>
    </span>
  );
}

/**
 * Context occupancy. The tooltip states that the figure is an estimate and shows
 * the exact cumulative counters beside it — the derivation is explained in
 * core/context-health.ts, and a badge that implied precision it does not have
 * would be worse than no badge.
 *
 * The percentage is a measurement, so it is set in `data` with tabular
 * numerals; the tier drives the dot. The number is the label here — the dot is
 * the second channel, not the only one.
 */
export function ContextBadge({ health }: { health: ContextHealth | undefined }) {
  if (!health) return null;
  const pct = Math.round(health.pct * 100);
  const k = (n: number) => `${Math.round(n / 100) / 10}k`;
  return (
    <span
      className={`status ctx ctx-${health.tier}`}
      title={
        `~${pct}% of a ${k(health.windowMax)} window (estimated from per-turn export deltas)\n` +
        `model: ${health.model ?? 'unknown'}\n` +
        `cumulative: ${k(health.totalPromptTokens)} prompt / ${k(health.totalCompletionTokens)} completion`
      }
    >
      <i className="dot" aria-hidden="true" />
      <span className="status-label">{pct}%</span>
    </span>
  );
}
