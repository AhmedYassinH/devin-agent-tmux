/**
 * Context-health watcher.
 *
 * Devin re-exports after every turn, so a write to the pane's `--export` file is
 * a turn boundary. We poll rather than fs.watch: the file is rewritten via
 * replace on some platforms, which drops a watch silently, and a 4s poll of one
 * small JSON per live pane is cheap next to a pane full of xterm traffic.
 *
 * The previous reading is retained per pane because occupancy is a DERIVATIVE of
 * the cumulative counters — see the long note in core/context-health.ts.
 */
import { readFileSync } from 'node:fs';
import { computeHealth, parseExport, type ContextHealth, type ContextThresholds, type ExportMetrics, DEFAULT_THRESHOLDS } from '../core/context-health.js';

function thresholdsFromEnv(): ContextThresholds {
  const num = (v: string | undefined, fallback: number) => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
  };
  const watch = num(process.env.DEVIN_MUX_WATCH_PCT, DEFAULT_THRESHOLDS.watch);
  const handoff = num(process.env.DEVIN_MUX_HANDOFF_PCT, DEFAULT_THRESHOLDS.handoff);
  // Keep watch <= handoff even if the env says otherwise, or the amber tier
  // becomes unreachable.
  return { watch: Math.min(watch, handoff), handoff };
}

export class HealthWatcher {
  private previous = new Map<string, ExportMetrics>();
  private paths = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private thresholds = thresholdsFromEnv();

  constructor(
    private onHealth: (paneId: string, health: ContextHealth) => void,
    private intervalMs = 4000,
  ) {}

  track(paneId: string, exportPath: string | undefined): void {
    if (!exportPath) return;
    this.paths.set(paneId, exportPath);
    // A new pane starts with no baseline; the first reading uses the cumulative
    // fallback rather than a stale predecessor's numbers.
    this.previous.delete(paneId);
  }

  untrack(paneId: string): void {
    this.paths.delete(paneId);
    this.previous.delete(paneId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    for (const [paneId, path] of this.paths) {
      let metrics: ExportMetrics | null = null;
      try {
        metrics = parseExport(JSON.parse(readFileSync(path, 'utf8')));
      } catch {
        // Absent until the first turn completes, and momentarily unreadable
        // mid-rewrite. Both are normal; skip this tick.
        continue;
      }
      if (!metrics) continue;
      const health = computeHealth(metrics, this.previous.get(paneId), this.thresholds);
      this.previous.set(paneId, metrics);
      this.onHealth(paneId, health);
    }
  }
}
