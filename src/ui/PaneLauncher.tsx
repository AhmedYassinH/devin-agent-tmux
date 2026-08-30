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
 *
 * Styled as the instrument's front panel (DESIGN.md §9): a readout rule names
 * the slot, the two controls sit under `label`-styled engravings, and exactly
 * one of the three actions is brass. The panel sheds its prose — and then its
 * heading — via container queries, because a six-way split leaves a pane barely
 * 300px wide and the fields have to survive that.
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
      <div className="launcher-inner">
        <div className="launcher-head">
          <div className="readout-rule">
            <span className="rule-label">Empty slot</span>
            <i className="rule-line" />
            <span className="rule-value">devin</span>
          </div>
          <h2 className="launcher-title">Start an agent</h2>
          <p className="launcher-lede">
            The pane becomes a real <code>devin</code> terminal. Everything else is set inside it.
          </p>
        </div>

        <div className="launcher-fields">
          <label className="field">
            <span>Session name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="optional — a label for the sidebar"
            />
          </label>
          <label className="field">
            <span>Working directory</span>
            {/* A path is a measured thing, not prose: it gets the mono face. */}
            <input
              className="mono"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
            />
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

        <p className="launcher-hint">
          Starts with edits auto-approved. Inside the pane, <code>Shift+Tab</code> cycles the
          permission mode and <code>/model</code> switches model.
        </p>
      </div>
    </div>
  );
}
