/**
 * Session import — past Devin conversations, listed over ACP `session/list`.
 *
 * A session a live pane is holding comes back with `isLocked`. We show it,
 * disabled, rather than filtering it out: "my running session is missing" reads
 * as a bug, where a greyed row with a reason does not.
 */
import { useEffect, useState } from 'react';
import type { AcpSessionSummary } from '../core/acp.js';
import type { Backend } from './backend.js';

export function SessionPicker({
  backend,
  cwd,
  onResume,
  onTrace,
  onClose,
}: {
  backend: Backend;
  cwd: string;
  onResume: (session: AcpSessionSummary) => void;
  onTrace: (session: AcpSessionSummary) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<AcpSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    backend
      .listSessions(cwd)
      .then((rows) => !cancelled && setSessions(rows))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [backend, cwd]);

  const needle = filter.trim().toLowerCase();
  const rows = (sessions ?? []).filter(
    (s) => !needle || s.title?.toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle) || s.sessionId.includes(needle),
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal session-picker" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Resume a Devin session</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close" title="Close">
            ✕
          </button>
        </header>

        <label className="field">
          <span>Filter</span>
          <input
            className="mono"
            autoFocus
            placeholder="title, directory or id…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>

        {error && <p className="error">Could not reach `devin acp`: {error}</p>}
        {!sessions && !error && <p className="dim">Reading sessions from devin…</p>}

        {/* The readout rule doubles as the table group header and carries the
            row count — "it names the thing, groups it, and carries a number". */}
        <div>
          <div className="readout-rule">
            <span className="rule-label">On this machine</span>
            <i className="rule-line" />
            <span className="rule-value">{sessions ? `${rows.length}` : '—'}</span>
          </div>

          {sessions && rows.length === 0 ? (
            <p className="dim">No sessions match.</p>
          ) : (
            <ul className="session-list">
              {rows.map((s) => (
                <li key={s.sessionId} className={s.isLocked ? 'locked' : ''}>
                  <div className="session-main">
                    <span className="session-title">{s.title || s.sessionId}</span>
                    <span className="session-meta">
                      <code>{s.sessionId}</code>
                      <span className="path">{s.cwd}</span>
                      {s.updatedAt && <span>{new Date(s.updatedAt).toLocaleString()}</span>}
                    </span>
                  </div>
                  {/* Locked is a state, so it gets a status dot and a word — the
                      greyed row alone would be colour carrying the meaning. */}
                  {s.isLocked && (
                    <span className="status status-waiting" title="Open in a running process">
                      <i className="dot" aria-hidden="true" />
                      <span className="status-label">locked</span>
                    </span>
                  )}
                  <div className="session-actions">
                    <button
                      className="ghost"
                      onClick={() => onTrace(s)}
                      disabled={s.isLocked}
                      title={
                        s.isLocked
                          ? 'Open in a live pane — close it to read the trace'
                          : 'View the turn-by-turn trace'
                      }
                    >
                      Trace
                    </button>
                    {/* Secondary, not brass: a screen carries six brass
                        appearances at most and this list can run to forty. */}
                    <button
                      className="secondary"
                      onClick={() => onResume(s)}
                      title="Launch a pane with `devin -r`"
                    >
                      Resume
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer>
          Resuming opens the session in its <strong>own new workspace</strong>, at the directory it
          originally ran in — <code>devin -r</code> only works from there. Locked sessions are open
          in a running process; Devin allows one holder at a time, so their transcript can be read
          once that pane is closed.
        </footer>
      </div>
    </div>
  );
}
