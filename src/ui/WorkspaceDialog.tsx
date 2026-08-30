/**
 * Workspace create / rename card.
 *
 * Replaces the browser `prompt()` chain, which was not only ugly but actively
 * misleading: it asked for a name and a directory in two sequential modals with
 * no way to see or correct the first once the second appeared, and it offered no
 * room to say that the directory must be a real absolute path — the exact
 * mistake that produced a pane dying with `exit code 1`.
 */
import { useEffect, useRef, useState } from 'react';

export type WorkspaceDialogMode =
  | { mode: 'create'; defaultCwd: string }
  | { mode: 'rename'; id: string; name: string };

export function WorkspaceDialog({
  spec,
  onCancel,
  onCreate,
  onRename,
}: {
  spec: WorkspaceDialogMode;
  onCancel: () => void;
  onCreate: (name: string, cwd: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const creating = spec.mode === 'create';
  const [name, setName] = useState(creating ? '' : spec.name);
  const [cwd, setCwd] = useState(creating ? spec.defaultCwd : '');
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  // Esc closes from anywhere in the card, matching the modal convention the
  // session picker already follows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const trimmedName = name.trim();
  const trimmedCwd = cwd.trim();
  const valid = trimmedName.length > 0 && (!creating || trimmedCwd.length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (creating) onCreate(trimmedName, trimmedCwd);
    else onRename(spec.id, trimmedName);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header>
          <h2>{creating ? 'New workspace' : 'Rename workspace'}</h2>
          <button type="button" className="ghost" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </header>

        <label className="field">
          <span>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="api-fix"
          />
        </label>

        {creating && (
          <label className="field">
            <span>Working directory</span>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              placeholder="/Users/you/projects/my-repo"
            />
            <small className="muted">
              An absolute path, or <code>~/…</code>. New panes in this workspace start here — Devin
              scopes its sessions by directory, and works best in a project rather than your home
              folder.
            </small>
          </label>
        )}

        <footer className="card-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            {creating ? 'Create workspace' : 'Rename'}
          </button>
        </footer>
      </form>
    </div>
  );
}
