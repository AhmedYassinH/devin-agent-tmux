/**
 * Ticket editor — create a new Kanban card or edit a backlog one.
 *
 * A card is the board's whole unit of work: a title, the working directory the
 * agent runs in, and a description that becomes Devin's first-turn prompt when
 * the card is Started. The autonomy field maps straight to `--permission-mode`,
 * because on the board there is no TUI to cycle it in — the user picks how much
 * the agent may do unattended up front. Modelled on NameDialog so create,
 * rename and this all share one focus/Esc/validation shape.
 */
import { useEffect, useRef, useState } from 'react';
import { type Card, type DevinPermissionMode, DEFAULT_PERMISSION_MODE } from '../core/models.js';

export interface CardDraft {
  title: string;
  description: string;
  cwd: string;
  permissionMode: DevinPermissionMode;
  contextApiKey: string;
}

export type CardDialogSpec =
  | { mode: 'create'; defaultCwd: string; hasDefaultContextKey: boolean }
  | { mode: 'edit'; card: Card; hasDefaultContextKey: boolean };

/**
 * Devin's permission ladder, in ASCENDING autonomy — the order the list must be
 * read in for the choice to make sense.
 *
 * Taken verbatim from `devin --permission-mode`: "auto auto-approves read-only
 * tools, accept-edits also auto-approves workspace edits, smart additionally
 * auto-runs actions a fast model judges safe, dangerous auto-approves all
 * tools." `auto` is therefore the LEAST permissive of the four, not the most —
 * this list previously sat it between smart and dangerous and described it as
 * "runs most things without asking", which is backwards, and pointed anyone
 * looking for an unattended ticket at the mode that interrupts most.
 *
 * Each hint says what the mode ASKS about, not just what it allows, because on
 * the board that is the consequential half: a mode that never asks never raises
 * a PermissionRequest hook, so its card can never reach Attention.
 */
const AUTONOMY: { value: DevinPermissionMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Auto-approves read-only tools. Asks before edits and commands — the most interruptive.' },
  { value: 'accept-edits', label: 'Accept edits', hint: 'Also writes files freely. Still asks before running commands.' },
  { value: 'smart', label: 'Smart', hint: 'Additionally auto-runs actions a fast model judges safe.' },
  { value: 'dangerous', label: 'Bypass', hint: 'Approves everything, so it never stops for you — this card will never reach Attention. Trusted, disposable checkouts only.' },
];

export function CardDialog({
  spec,
  onCancel,
  onSubmit,
}: {
  spec: CardDialogSpec;
  onCancel: () => void;
  onSubmit: (draft: CardDraft) => void;
}) {
  const creating = spec.mode === 'create';
  const [title, setTitle] = useState(creating ? '' : spec.card.title);
  const [description, setDescription] = useState(creating ? '' : spec.card.description);
  const [cwd, setCwd] = useState(creating ? spec.defaultCwd : spec.card.cwd);
  const [permissionMode, setPermissionMode] = useState<DevinPermissionMode>(
    creating ? DEFAULT_PERMISSION_MODE : spec.card.permissionMode,
  );
  const [contextKey, setContextKey] = useState('');
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const valid = title.trim().length > 0 && cwd.trim().length > 0 && description.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit({ title, description, cwd, permissionMode, contextApiKey: contextKey });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal card card-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header>
          <h2>{creating ? 'New ticket' : 'Edit ticket'}</h2>
          <button type="button" className="ghost icon" onClick={onCancel} aria-label="Close" title="Close">
            ✕
          </button>
        </header>

        <label className="field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a logout button to the navbar"
          />
        </label>

        <label className="field">
          <span>Description</span>
          {/* This is the prompt handed to Devin. Written like a task, not a
              chat — the agent reads it as its opening instruction. */}
          <textarea
            className="card-prompt"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder="Describe the change you want. Be specific: which files, what behaviour, any constraints. Devin reads this as its first instruction."
          />
          <small>Handed to Devin as its first-turn prompt when you press Start.</small>
        </label>

        <label className="field">
          <span>Working directory</span>
          <input
            className="mono"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            spellCheck={false}
            placeholder="/Users/you/projects/my-repo"
          />
          <small>
            An absolute path, or <code>~/…</code>. The agent for this ticket runs here — a project,
            not your home folder.
          </small>
        </label>

        <label className="field">
          <span>Autonomy</span>
          <select
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value as DevinPermissionMode)}
          >
            {AUTONOMY.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <small>{AUTONOMY.find((a) => a.value === permissionMode)?.hint}</small>
        </label>

        {creating && (
          <label className="field">
            <span>context.dev API key</span>
            <input
              className="mono"
              type="password"
              value={contextKey}
              onChange={(e) => setContextKey(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={spec.hasDefaultContextKey ? 'optional — using the server default' : 'ctxt_secret_…'}
            />
            <small>
              {spec.hasDefaultContextKey
                ? 'This ticket’s agent gets the context.dev MCP server. Leave blank to use the server’s .env key, or paste one to bill it separately.'
                : 'No default key on the server. Paste one to give this ticket’s agent context.dev — web search, scraping and document parsing.'}
            </small>
          </label>
        )}

        <footer className="card-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            {creating ? 'Add to backlog' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  );
}
