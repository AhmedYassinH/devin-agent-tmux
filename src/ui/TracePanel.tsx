/**
 * Trace panel — the turn-by-turn record of a past session, replayed over ACP.
 *
 * v1 is history-only by design: a pane's own session is held by its PTY, and
 * Devin permits one holder, so the live session cannot be replayed while it
 * runs. The panel says so rather than showing a stale or empty trace.
 */
import { useEffect, useState } from 'react';
import type { AcpContentBlock } from '../core/acp.js';
import { traceSummary, type Trace, type TraceToolCall } from '../core/trace.js';
import type { Backend } from './backend.js';

const KIND_ICON: Record<string, string> = {
  read: '📖',
  edit: '✏️',
  delete: '🗑',
  move: '📦',
  search: '🔍',
  execute: '⚡',
  think: '💭',
  fetch: '🌐',
  switch_mode: '🔀',
  other: '•',
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
  return <div className="muted small">[{block.type}]</div>;
}

function ToolRow({ tool }: { tool: TraceToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool tool-${tool.status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-icon">{KIND_ICON[tool.kind] ?? '•'}</span>
        <span className="tool-title">{tool.title}</span>
        <span className={`tool-status s-${tool.status}`}>{tool.status}</span>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTrace(null);
    setError(null);
    backend
      .loadTrace(sessionId, cwd)
      .then((t) => !cancelled && setTrace(t))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [backend, sessionId, cwd]);

  const summary = trace ? traceSummary(trace) : null;

  return (
    <aside className="trace">
      <header>
        <div>
          <h3>{trace?.title || sessionId}</h3>
          {summary && (
            <p className="muted small">
              {summary.turns} turns · {summary.tools} tool calls
              {summary.failed > 0 && <span className="failed"> · {summary.failed} failed</span>}
            </p>
          )}
        </div>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {!trace && !error && <p className="muted">Replaying session over ACP…</p>}

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
