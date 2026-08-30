/**
 * The Kanban board — a third way to look at one workspace, alongside the grid
 * and the tab strip.
 *
 * A user writes tickets, presses Start on one, and a Devin session picks it up
 * with the ticket's description as its prompt, running in the workspace's own
 * directory. From then on the ticket's column tracks that session's live status
 * (see core/board.columnForStatus), so the board is a true readout of what every
 * agent is doing, not a manual to-do list.
 *
 * Columns are fixed and meaningful rather than user-defined: Backlog is work not
 * yet handed to an agent; Attention is the one column that earns a warning
 * colour, because a card there is blocked on the human. Drag-and-drop is allowed
 * but a started card's status will reclaim it on the next transition — the agent
 * is the source of truth for where its work sits.
 */
import { useState } from 'react';
import {
  type Card,
  type CardColumn,
  type PaneStatus,
  type Workspace,
  CARD_COLUMNS,
} from '../core/models.js';
import { cardsInColumn } from '../core/board.js';
import type { ContextHealth } from '../core/context-health.js';
import type { Backend } from './backend.js';
import { CardDialog, type CardDialogSpec, type CardDraft } from './CardDialog.js';
import { CardDetail } from './CardDetail.js';
import { ContextBadge, StatusBadge } from './StatusBadge.js';

const COLUMN_META: Record<CardColumn, { label: string; hint: string }> = {
  backlog: { label: 'Backlog', hint: 'Tickets waiting to be started' },
  'in-progress': { label: 'In Progress', hint: 'Agents actively working' },
  attention: { label: 'Attention', hint: 'Blocked on your input' },
  done: { label: 'Done', hint: 'Session ended' },
};

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

function CardTile({
  card,
  status,
  health,
  onOpen,
  onStart,
  onEdit,
  onDelete,
  onDragStart,
}: {
  card: Card;
  status: PaneStatus | undefined;
  health: ContextHealth | undefined;
  onOpen: () => void;
  onStart: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const started = Boolean(card.paneId);
  return (
    <article
      className={`kard ${status === 'waiting' ? 'needs-you' : ''}`}
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
    >
      <div className="kard-head">
        {started ? (
          <StatusBadge status={status ?? 'idle'} />
        ) : (
          <span className="tag tag-neutral">Task</span>
        )}
        <span className="spacer" />
        <ContextBadge health={health} />
      </div>

      <h4 className="kard-title">{card.title}</h4>
      {card.description.trim() && <p className="kard-desc">{card.description.trim()}</p>}

      <div className="kard-foot">
        <span className="kard-cwd mono" title={card.cwd}>
          {basename(card.cwd)}
        </span>
        <span className="spacer" />
        {/* Row actions stop propagation so they don't also open the detail. */}
        {!started && (
          <button
            className="primary tiny"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
          >
            Start
          </button>
        )}
        {!started && (
          <button
            className="ghost icon tiny"
            aria-label="Edit ticket"
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            ✎
          </button>
        )}
        <button
          className="ghost icon tiny"
          aria-label="Delete ticket"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ✕
        </button>
      </div>
    </article>
  );
}

export function BoardView({
  workspace,
  statuses,
  healths,
  hasDefaultContextKey,
  backend,
  onCreateCard,
  onUpdateCard,
  onDeleteCard,
  onStartCard,
  onStopCard,
  onMoveCard,
}: {
  workspace: Workspace;
  statuses: Record<string, PaneStatus>;
  healths: Record<string, ContextHealth>;
  hasDefaultContextKey: boolean;
  backend: Backend;
  onCreateCard: (draft: CardDraft) => void;
  onUpdateCard: (id: string, fields: Partial<Card>) => void;
  onDeleteCard: (id: string) => void;
  onStartCard: (card: Card) => void;
  onStopCard: (card: Card) => void;
  onMoveCard: (id: string, column: CardColumn) => void;
}) {
  const [dialog, setDialog] = useState<CardDialogSpec | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<CardColumn | null>(null);

  // Detail always reflects the freshest card (its column/status change live).
  const selected = selectedId ? workspace.cards[selectedId] : null;

  const statusOf = (card: Card) => (card.paneId ? statuses[card.paneId] : undefined);
  const healthOf = (card: Card) => (card.paneId ? healths[card.paneId] : undefined);

  const openNew = () =>
    setDialog({ mode: 'create', defaultCwd: workspace.cwd, hasDefaultContextKey });

  const total = workspace.cardOrder.length;

  return (
    <div className="board-wrap">
      <div className="board-bar">
        <span className={total === 0 ? 'tag tag-neutral' : 'tag'} title="Tickets on the board">
          {total} {total === 1 ? 'ticket' : 'tickets'}
        </span>
        <span className="dim small">Write tickets; Devin picks them up and builds them.</span>
        <span className="spacer" />
        <button className="primary" onClick={openNew}>
          New ticket
        </button>
      </div>

      <section className="board">
        {CARD_COLUMNS.map((col) => {
          const cards = cardsInColumn(workspace, col);
          return (
            <div
              key={col}
              className={`board-col ${col === 'attention' ? 'col-attention' : ''} ${dragOver === col ? 'drop-target' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col);
              }}
              onDragLeave={() => setDragOver((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData('text/card-id');
                if (id) onMoveCard(id, col);
              }}
            >
              <div className="board-col-head">
                <div className="readout-rule">
                  <span className="rule-label">{COLUMN_META[col].label}</span>
                  <i className="rule-line" />
                  <span className="rule-value">{cards.length}</span>
                </div>
              </div>

              <div className="board-col-body">
                {cards.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    status={statusOf(card)}
                    health={healthOf(card)}
                    onOpen={() => setSelectedId(card.id)}
                    onStart={() => onStartCard(card)}
                    onEdit={() => setDialog({ mode: 'edit', card, hasDefaultContextKey })}
                    onDelete={() => onDeleteCard(card.id)}
                    onDragStart={(e) => e.dataTransfer.setData('text/card-id', card.id)}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="board-col-empty">
                    {col === 'backlog' ? (
                      <button className="secondary" onClick={openNew}>
                        + New ticket
                      </button>
                    ) : (
                      <span className="dim small">{COLUMN_META[col].hint}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {selected && (
        <CardDetail
          card={selected}
          status={statusOf(selected)}
          health={healthOf(selected)}
          backend={backend}
          onClose={() => setSelectedId(null)}
          onStart={() => onStartCard(selected)}
          onStop={() => onStopCard(selected)}
          onEdit={() => setDialog({ mode: 'edit', card: selected, hasDefaultContextKey })}
        />
      )}

      {dialog && (
        <CardDialog
          spec={dialog}
          onCancel={() => setDialog(null)}
          onSubmit={(draft) => {
            if (dialog.mode === 'create') onCreateCard(draft);
            else
              onUpdateCard(dialog.card.id, {
                title: draft.title.trim(),
                description: draft.description,
                cwd: draft.cwd.trim(),
                permissionMode: draft.permissionMode,
              });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
