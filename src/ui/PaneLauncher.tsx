/**
 * The empty-slot launcher. This is the screen the whole port exists to change:
 * Chorus offered "Run Claude"; this offers Devin, with Devin's own four-rung
 * permission ladder rather than Claude's binary skip-or-not.
 */
import { useState } from 'react';
import { PERMISSION_MODES, type DevinPermissionMode } from '../core/models.js';

export interface LaunchRequest {
  name?: string;
  cwd: string;
  model?: string;
  permissionMode: DevinPermissionMode;
  prompt?: string;
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
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState<DevinPermissionMode>('auto');

  const launch = (shellOnly: boolean) =>
    onLaunch({
      name: name.trim() || undefined,
      cwd: cwd.trim() || defaultCwd,
      model: model.trim() || undefined,
      prompt: prompt.trim() || undefined,
      permissionMode,
      shellOnly,
    });

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
        <label>
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default (e.g. opus, codex)" />
        </label>
        <label>
          <span>Permissions</span>
          <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as DevinPermissionMode)}>
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value} title={m.hint}>
                {m.label} — {m.hint}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>First prompt</span>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="optional — auto-submits, session stays interactive"
          />
        </label>
      </div>

      <div className="launcher-actions">
        <button className="primary" onClick={() => launch(false)}>
          Run Devin
        </button>
        <button onClick={onImport}>Resume a session…</button>
        <button className="ghost" onClick={() => launch(true)}>
          Shell
        </button>
      </div>
    </div>
  );
}
