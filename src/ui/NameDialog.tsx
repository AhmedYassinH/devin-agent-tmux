/**
 * Naming card — create a workspace, rename a workspace, or rename a session.
 *
 * Replaces the browser `prompt()` chain, which was not only ugly but actively
 * misleading: it asked for a name and a directory in two sequential modals with
 * no way to see or correct the first once the second appeared, and it offered no
 * room to say that the directory must be a real absolute path — the exact
 * mistake that produced a pane dying with `exit code 1`.
 *
 * One component for all three cases because they differ only in title, in
 * whether a directory field appears, and in what the caller does with the
 * result. Splitting them would triplicate the focus, Esc and validation logic.
 */
import { useEffect, useRef, useState } from 'react';

export type NameDialogSpec =
  | { mode: 'create-workspace'; defaultCwd: string; hasDefaultContextKey: boolean }
  | { mode: 'rename-workspace'; id: string; name: string }
  | { mode: 'rename-session'; wsId: string; id: string; name: string };

const TITLE: Record<NameDialogSpec['mode'], string> = {
  'create-workspace': 'New workspace',
  'rename-workspace': 'Rename workspace',
  'rename-session': 'Rename session',
};

export function NameDialog({
  spec,
  onCancel,
  onSubmit,
}: {
  spec: NameDialogSpec;
  onCancel: () => void;
  /** `cwd` and `contextApiKey` are only meaningful for create-workspace. */
  onSubmit: (name: string, cwd: string, contextApiKey: string) => void;
}) {
  const creating = spec.mode === 'create-workspace';
  const [name, setName] = useState(creating ? '' : spec.name);
  const [cwd, setCwd] = useState(creating ? spec.defaultCwd : '');
  const [contextKey, setContextKey] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  // Esc closes from anywhere in the card, matching the session picker.
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
    onSubmit(trimmedName, trimmedCwd, contextKey.trim());
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header>
          <h2>{TITLE[spec.mode]}</h2>
          <button
            type="button"
            className="ghost icon"
            onClick={onCancel}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </header>

        <label className="field">
          <span>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={spec.mode === 'rename-session' ? 'auth-refactor' : 'api-fix'}
          />
          {spec.mode === 'rename-session' && (
            <small>
              A label for you. Devin&rsquo;s own session id is unchanged, so resuming this
              conversation later still works.
            </small>
          )}
        </label>

        {creating && (
          <label className="field">
            <span>Working directory</span>
            {/* A path is measured, not narrated: mono, per the type rules. */}
            <input
              className="mono"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              placeholder="/Users/you/projects/my-repo"
            />
            <small>
              An absolute path, or <code>~/…</code>. New panes in this workspace start here — Devin
              scopes its sessions by directory, and works best in a project rather than your home
              folder.
            </small>
          </label>
        )}

        {creating && (
          <label className="field">
            <span>context.dev API key</span>
            {/* type=password so the key is not shoulder-read or captured in a
                screenshot; a key is measured text, so it keeps the mono face. */}
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
                ? 'Every pane here gets the context.dev MCP server. Leave blank to use the key from the server’s .env, or paste one to bill this workspace separately.'
                : 'No default key is configured on the server. Paste one to give this workspace’s panes the context.dev MCP server — web search, scraping and document parsing.'}
            </small>
          </label>
        )}

        <footer className="card-actions">
          <button type="button" className="secondary" onClick={onCancel}>
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
