/**
 * The empty-slot launcher. This is the screen the whole port exists to change:
 * Chorus offered "Run Claude"; this offers Devin.
 *
 * Deliberately minimal. Model, first prompt and permission mode are NOT here
 * even though the CLI accepts all three, because the pane is the real `devin`
 * TUI: you pick a model with `/model`, type your first message at the prompt,
 * and cycle permissions with `Shift+Tab`. Duplicating those in a launch form
 * gives two ways to do one thing and two places to fall out of sync — and the
 * form's copy goes stale the moment Devin ships a new model or mode.
 *
 * What remains is what the TUI genuinely cannot change after the fact: the
 * working directory the process is spawned in, plus a label for our sidebar.
 */
import { useState } from 'react';

export interface LaunchRequest {
  name?: string;
  cwd: string;
  /** Launch a plain shell instead of devin — the escape hatch pane. */
  shellOnly?: boolean;
}

export function PaneLauncher({
  defaultCwd,
  onLaunch,
  onImport,
}: {
  defaultCwd: string;
  onLaunch: (req: LaunchRequest) => void;
  onImport: () => void;
}) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(defaultCwd);

  const launch = (shellOnly: boolean) =>
    onLaunch({ name: name.trim() || undefined, cwd: cwd.trim() || defaultCwd, shellOnly });

  return (
    <div className="launcher">
      <div className="launcher-grid">
        <label>
          <span>Session name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" />
        </label>
        <label>
          <span>Working directory</span>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
        </label>
      </div>

      <div className="launcher-actions">
        <button className="primary" onClick={() => launch(false)}>
          Run Devin
        </button>
        <button className="secondary" onClick={onImport}>
          Resume a session…
        </button>
        <button className="secondary" onClick={() => launch(true)}>
          Shell
        </button>
      </div>

      <small className="muted">
        Starts with edits auto-approved. Inside the pane, <code>Shift+Tab</code> cycles the
        permission mode and <code>/model</code> switches model.
      </small>
    </div>
  );
}
