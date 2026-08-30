/**
 * Context health — "how full is this pane's context window", derived from the
 * `--export` transcript Devin rewrites after every turn.
 *
 * WHY THIS IS AN ESTIMATE, AND WHAT KIND
 * --------------------------------------
 * Chorus read Claude Code's transcript, which records per-turn `usage`
 * (input/cache_read/cache_creation), so occupancy was a direct reading of the
 * latest turn. Devin's export carries only CUMULATIVE totals:
 *
 *   final_metrics: { total_prompt_tokens, total_completion_tokens,
 *                    total_cached_tokens, total_steps }
 *
 * Those sum every request the session ever made. Using the total directly would
 * report a long session as wildly over 100% full, which is worse than useless.
 *
 * So we differentiate instead. Between two readings of the file:
 *
 *   occupancy ~= (delta total_prompt_tokens) / (delta inference count)
 *
 * i.e. the mean prompt size of the requests made since we last looked. Because
 * every request re-sends the conversation prefix, that mean tracks the real
 * window occupancy closely. Two known biases, both acceptable:
 *
 *   - It slightly UNDER-reports, being a mean over a turn whose last request is
 *     the largest. Under-reporting is the safe direction for a "you're running
 *     out of room" warning only if we compensate, so the thresholds sit low.
 *   - It is a per-turn resolution reading, not per-request.
 *
 * Deliberately NOT a running maximum: `/compact` genuinely shrinks the context,
 * and a max would pin the badge red forever after one compaction.
 */

/** Cumulative counters as they appear in the export's `final_metrics`. */
export interface ExportMetrics {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  totalSteps: number;
  /** Count of steps that ran an inference — the divisor for the mean. */
  inferenceSteps: number;
  /** e.g. "claude-opus-4-8-high-fast". */
  model?: string;
}

export type ContextTier = 'healthy' | 'watch' | 'handoff';

export interface ContextThresholds {
  /** At/above this fraction, warn (amber). */
  watch: number;
  /** At/above this fraction, recommend handing off (red). */
  handoff: number;
}

export const DEFAULT_THRESHOLDS: ContextThresholds = { watch: 0.5, handoff: 0.7 };

export interface ContextHealth {
  /** Estimated tokens currently occupying the window. */
  occupied: number;
  windowMax: number;
  /** occupied / windowMax, clamped to [0, 1]. */
  pct: number;
  tier: ContextTier;
  model?: string;
  /** Cumulative spend — exact, unlike `occupied`. Shown on hover. */
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

const K = 1000;

/**
 * Effective input window by model family.
 *
 * Devin is multi-provider — its model list includes Claude, GPT-5.3-Codex,
 * Gemini 3.x, Kimi K2, DeepSeek V4, Nemotron 3 and SWE-1.6 — so unlike Chorus
 * this cannot assume an Anthropic id. Matching is by family substring so that
 * priority/effort suffixes (`-high-fast`, `-xhigh`, `-low-priority`) all resolve
 * to the same window.
 *
 * An unknown id assumes the conservative 200K: that can only over-report
 * fullness, never hide it, which is the right way to be wrong here.
 */
const WINDOWS: { match: RegExp; window: number }[] = [
  { match: /gemini-3/, window: 1000 * K },
  { match: /claude-(opus|sonnet)-4/, window: 1000 * K },
  { match: /claude-haiku-4/, window: 200 * K },
  { match: /gpt-5/, window: 400 * K },
  { match: /kimi-k2/, window: 256 * K },
  { match: /deepseek-v4/, window: 256 * K },
  { match: /nemotron-3/, window: 256 * K },
  { match: /swe-1/, window: 256 * K },
];

const DEFAULT_WINDOW = 200 * K;

export function contextWindowFor(model: string | undefined): number {
  if (!model) return DEFAULT_WINDOW;
  const id = model.toLowerCase();
  for (const { match, window } of WINDOWS) if (match.test(id)) return window;
  return DEFAULT_WINDOW;
}

export function tierFor(pct: number, t: ContextThresholds = DEFAULT_THRESHOLDS): ContextTier {
  if (pct >= t.handoff) return 'handoff';
  if (pct >= t.watch) return 'watch';
  return 'healthy';
}

/**
 * Estimate occupancy from the current reading and the one before it.
 *
 * `previous` is undefined on the first read of a pane; we then fall back to
 * total/inferences, which is exact for a single-turn session and a mean
 * otherwise — the best available with no baseline.
 */
export function estimateOccupancy(current: ExportMetrics, previous?: ExportMetrics): number {
  const deltaPrompt = previous ? current.totalPromptTokens - previous.totalPromptTokens : current.totalPromptTokens;
  const deltaInfer = previous ? current.inferenceSteps - previous.inferenceSteps : current.inferenceSteps;

  // No new inference since last look: the window is unchanged, so re-derive from
  // the cumulative figures rather than reporting a spurious zero.
  if (deltaInfer <= 0 || deltaPrompt <= 0) {
    return current.inferenceSteps > 0 ? Math.round(current.totalPromptTokens / current.inferenceSteps) : 0;
  }
  return Math.round(deltaPrompt / deltaInfer);
}

export function computeHealth(
  current: ExportMetrics,
  previous?: ExportMetrics,
  thresholds: ContextThresholds = DEFAULT_THRESHOLDS,
): ContextHealth {
  const occupied = estimateOccupancy(current, previous);
  const windowMax = contextWindowFor(current.model);
  const pct = Math.min(1, Math.max(0, occupied / windowMax));
  return {
    occupied,
    windowMax,
    pct,
    tier: tierFor(pct, thresholds),
    model: current.model,
    totalPromptTokens: current.totalPromptTokens,
    totalCompletionTokens: current.totalCompletionTokens,
  };
}

/**
 * Parse an export file's JSON into metrics. Every field is optional — the export
 * schema is versioned (`schema_version`) and will move; a shape we can't read
 * costs the badge, not the pane.
 */
export function parseExport(json: unknown): ExportMetrics | null {
  if (typeof json !== 'object' || json === null) return null;
  const d = json as Record<string, unknown>;
  const fm = (d.final_metrics ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const steps = Array.isArray(d.steps) ? d.steps : [];
  // An "inference" is an agent step that names the model that generated it —
  // the same marker Devin writes for its own telemetry.
  let inferenceSteps = 0;
  let model: string | undefined;
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const extra = ((s as Record<string, unknown>).extra ?? {}) as Record<string, unknown>;
    if (typeof extra.generation_model === 'string') {
      inferenceSteps += 1;
      model = extra.generation_model;
    }
  }
  if (!model) {
    const agent = (d.agent ?? {}) as Record<string, unknown>;
    if (typeof agent.model_name === 'string') model = agent.model_name;
  }

  return {
    totalPromptTokens: num(fm.total_prompt_tokens),
    totalCompletionTokens: num(fm.total_completion_tokens),
    totalCachedTokens: num(fm.total_cached_tokens),
    totalSteps: num(fm.total_steps),
    inferenceSteps,
    model,
  };
}
