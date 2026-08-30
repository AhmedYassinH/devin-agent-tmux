/**
 * Trace panel — the turn-by-turn record of a past session, replayed over ACP.
 *
 * v1 is history-only by design: a pane's own session is held by its PTY, and
 * Devin permits one holder, so the live session cannot be replayed while it
 * runs. The panel says so rather than showing a stale or empty trace.
 *
 * The round red award seal that used to head this panel is gone: the figures
 * now read as instrument metrics — a readout label over a `data`-type value —
 * which is both more informative (three numbers, not one) and the treatment
 * DESIGN.md prescribes for measurements.
 */
import { useEffect, useState } from 'react';
import type { AcpContentBlock, AcpErrorKind } from '../core/acp.js';
import { traceSummary, type Trace, type TraceToolCall } from '../core/trace.js';
import { BackendError, type Backend } from './backend.js';

/**
 * Engraved kind labels rather than emoji. The system's icon rules call for a
 * 24px stroke set with square terminals; emoji are none of those things, and a
 * four-character mono tag reads faster in a dense list anyway.
 */
const KIND_LABEL: Record<string, string> = {
  read: 'read',
  edit: 'edit',
  delete: 'del',
  move: 'move',
  search: 'find',
  execute: 'exec',
  think: 'think',
  fetch: 'fetch',
  switch_mode: 'mode',
  other: '—',
};

function Duration({ ms }: { ms: number | undefined }) {
  if (ms === undefined) return null;
  return <span className="duration">{ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}</span>;
}

function Block({ block }: { block: AcpContentBlock }) {
  // Diffs arrive structured from ACP — no patch parsing, unlike the Claude port.
  if (block.type === 'diff') {
    const d = block as { path: string; oldText?: string | null; newText?: string | null };
    return (
      <div className="diff">
        <div className="diff-path">{d.path}</div>
        {d.oldText && <pre className="del">{d.oldText}</pre>}
        {d.newText && <pre className="add">{d.newText}</pre>}
      </div>
    );
  }
  if (block.type === 'text') {
    return <pre className="block-text">{(block as { text: string }).text}</pre>;
  }
  return <div className="dim small">[{block.type}]</div>;
}

function ToolRow({ tool }: { tool: TraceToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool tool-${tool.status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-kind">{KIND_LABEL[tool.kind] ?? '—'}</span>
        <span className="tool-title">{tool.title}</span>
        <span className={`status tool-status s-${tool.status}`}>
          <i className="dot" aria-hidden="true" />
          <span className="status-label">{tool.status.replace('_', ' ')}</span>
        </span>
        <Duration ms={tool.durationMs} />
      </button>
      {open && tool.content.length > 0 && (
        <div className="tool-body">
          {tool.content.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TracePanel({
  backend,
  sessionId,
  cwd,
  onClose,
}: {
  backend: Backend;
  sessionId: string;
  cwd: string;
  onClose: () => void;
}) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [failure, setFailure] = useState<{ message: string; kind: AcpErrorKind } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTrace(null);
    setFailure(null);
    backend
      .loadTrace(sessionId, cwd)
      .then((t) => !cancelled && setTrace(t))
      .catch((err: Error) => {
        if (cancelled) return;
        setFailure({
          message: err.message,
          kind: err instanceof BackendError ? err.kind : 'unknown',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [backend, sessionId, cwd]);

  const summary = trace ? traceSummary(trace) : null;

  return (
    <aside className="trace">
      <header>
        <div className="readout-rule">
          <span className="rule-label">Session trace</span>
          <i className="rule-line" />
          <span className="rule-value">{sessionId}</span>
        </div>

        <div className="trace-title-row">
          <h3>{trace?.title || sessionId}</h3>
          <button className="ghost icon" onClick={onClose} aria-label="Close trace" title="Close">
            ✕
          </button>
        </div>

        {summary && (
          <div className="trace-metrics">
            <div className="metric">
              <span className="metric-label">Turns</span>
              <span className="metric-value">{summary.turns}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Tool calls</span>
              <span className="metric-value">{summary.tools}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Failed</span>
              <span className={summary.failed > 0 ? 'metric-value failed' : 'metric-value'}>
                {summary.failed}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* A locked session is the documented consequence of Devin's one-holder
          lock, not a fault — so it reads as an explanation with the action the
          user can actually take, and never as red JSON. */}
      {failure?.kind === 'locked' && (
        <div className="trace-status">
          <p className="t-subheading">This session is running</p>
          <p className="dim">
            {failure.message} Close its pane, then reopen this trace.
          </p>
        </div>
      )}
      {failure && failure.kind !== 'locked' && (
        <div className="trace-status">
          <p className="error">{failure.message}</p>
        </div>
      )}
      {!trace && !failure && (
        <div className="trace-status">
          <p className="dim">Replaying session over ACP…</p>
        </div>
      )}

      <div className="trace-body">
        {trace?.turns.map((turn, i) =>
          turn.kind === 'user' ? (
            <div key={i} className="turn turn-user">
              <div className="turn-role">you</div>
              <pre>{turn.text}</pre>
            </div>
          ) : (
            <div key={i} className="turn turn-agent">
              <div className="turn-role">devin</div>
              {turn.thinking && <pre className="thinking">{turn.thinking}</pre>}
              {turn.text && <pre>{turn.text}</pre>}
              {turn.tools.map((tool) => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
            </div>
          ),
        )}
      </div>
    </aside>
  );
}
