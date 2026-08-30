/**
 * Ticket detail — a right-side sheet, the same treatment as the trace panel.
 *
 * This is what makes "ditch the terminal" real: a started ticket's Devin
 * session runs in an embedded terminal here, so the user watches it work and
 * answers it when it is waiting, all without ever opening the terminal grid. The
 * prompt the ticket was Started with sits above it, collapsible, because the
 * terminal is what earns the space once the agent is running.
 */
import { useState } from 'react';
import type { Card, PaneStatus } from '../core/models.js';
import type { ContextHealth } from '../core/context-health.js';
import type { Backend } from './backend.js';
import { TerminalPane } from './TerminalPane.js';
import { ContextBadge, StatusBadge } from './StatusBadge.js';

export function CardDetail({
  card,
  status,
  health,
  backend,
  onClose,
  onStart,
  onStop,
  onEdit,
}: {
  card: Card;
  status: PaneStatus | undefined;
  health: ContextHealth | undefined;
  backend: Backend;
  onClose: () => void;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const started = Boolean(card.paneId);
  const exited = status === 'exited';
  const [promptOpen, setPromptOpen] = useState(!started);

  return (
    <aside className="card-detail">
      <header>
        <div className="readout-rule">
          <span className="rule-label">Ticket</span>
          <i className="rule-line" />
          {card.devinSessionId && <span className="rule-value">{card.devinSessionId}</span>}
        </div>

        <div className="card-detail-title-row">
          <h3>{card.title}</h3>
          <button className="ghost icon" onClick={onClose} aria-label="Close ticket" title="Close">
            ✕
          </button>
        </div>

        <div className="card-detail-meta">
          {started && <StatusBadge status={status ?? 'idle'} />}
          <ContextBadge health={health} />
          <span className="card-detail-cwd mono" title={card.cwd}>
            {card.cwd}
          </span>
        </div>
      </header>

      <section className={`card-prompt-panel ${promptOpen ? 'open' : ''}`}>
        <button className="card-prompt-toggle" onClick={() => setPromptOpen((o) => !o)}>
          <span className="rule-label">Prompt</span>
          <span className="spacer" />
          <span className="dim small">{promptOpen ? 'hide' : 'show'}</span>
        </button>
        {promptOpen && <pre className="card-prompt-text">{card.description}</pre>}
      </section>

      <div className="card-detail-body">
        {started && card.paneId ? (
          <div className="card-term">
            <TerminalPane paneId={card.paneId} backend={backend} />
          </div>
        ) : (
          <div className="card-detail-empty">
            <p>
              This ticket hasn’t been started. Press <strong>Start</strong> to spawn a Devin session
              with the prompt above — it will appear here as a live terminal you can watch and reply
              to.
            </p>
          </div>
        )}
      </div>

      <footer className="card-detail-actions">
        {!started && (
          <button className="ghost" onClick={onEdit}>
            Edit
          </button>
        )}
        <span className="spacer" />
        {!started && (
          <button className="primary" onClick={onStart}>
            Start
          </button>
        )}
        {started && !exited && (
          <button className="secondary" onClick={onStop}>
            Stop agent
          </button>
        )}
        {started && exited && (
          <button className="primary" onClick={onStart}>
            Restart
          </button>
        )}
      </footer>
    </aside>
  );
}
