/**
 * App shell. Owns AppState (mirrored to the server on every change), pane
 * runtime state (status / context health, deliberately NOT persisted — it is
 * about a live process), and which modal is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppState,
  type DevinPermissionMode,
  type PaneStatus,
  type SessionConfig,
  emptyState,
  makeId,
} from '../core/models.js';
import { templateForCount } from '../core/layout.js';
import {
  addSession,
  applyTemplate,
  createWorkspace,
  removeSession,
  removeWorkspace,
  renameWorkspace,
  setWorkspaceLayout,
  setWorkspaceView,
  updateSession,
} from '../core/workspace.js';
import { leafCount, resizeSplit, templateLayout } from '../core/layout.js';
import type { ContextHealth } from '../core/context-health.js';
import type { AcpSessionSummary } from '../core/acp.js';
import { Backend } from './backend.js';
import { LayoutView } from './LayoutView.js';
import { Sidebar } from './Sidebar.js';
import { TerminalPane } from './TerminalPane.js';
import { PaneLauncher, type LaunchRequest } from './PaneLauncher.js';
import { SessionPicker } from './SessionPicker.js';
import { TracePanel } from './TracePanel.js';
import { WorkspaceDialog, type WorkspaceDialogMode } from './WorkspaceDialog.js';
import { ContextBadge, StatusBadge } from './StatusBadge.js';

const backend = new Backend();

export function App() {
  const [state, setState] = useState<AppState>(emptyState());
  const [statuses, setStatuses] = useState<Record<string, PaneStatus>>({});
  const [healths, setHealths] = useState<Record<string, ContextHealth>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [picker, setPicker] = useState(false);
  const [trace, setTrace] = useState<{ sessionId: string; cwd: string } | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);
  // Real paths from the server: the browser cannot resolve `~` or know a cwd.
  const [env, setEnv] = useState<{ home: string; cwd: string } | null>(null);
  const [dialog, setDialog] = useState<WorkspaceDialogMode | null>(null);

  // Suppress the save that a server-pushed state would otherwise trigger,
  // which would bounce the same state back and forth between two open tabs.
  const applyingRemote = useRef(false);

  useEffect(() => {
    return backend.subscribe((msg) => {
      switch (msg.t) {
        case 'env':
          setEnv({ home: msg.home, cwd: msg.cwd });
          break;
        case 'state':
          applyingRemote.current = true;
          setState(msg.state);
          break;
        case 'pane:status':
          setStatuses((s) => ({ ...s, [msg.paneId]: msg.status }));
          break;
        case 'pane:exit':
          setStatuses((s) => ({ ...s, [msg.paneId]: 'exited' }));
          break;
        case 'pane:health':
          setHealths((h) => ({ ...h, [msg.paneId]: msg.health }));
          break;
        case 'pane:session':
          // Devin chose its session id and the SessionStart hook reported it.
          // Persist immediately: this id is what `devin -r` needs later, and a
          // pane that crashes before we store it is unresumable.
          setState((prev) => {
            const wsId = prev.workspaceOrder.find((id) => prev.workspaces[id]?.sessions[msg.paneId]);
            if (!wsId) return prev;
            return updateSession(prev, wsId, msg.paneId, { devinSessionId: msg.devinSessionId });
          });
          break;
      }
    });
  }, []);

  // Persist every change. The server writes the file tree and pushes to Convex.
  useEffect(() => {
    if (applyingRemote.current) {
      applyingRemote.current = false;
      return;
    }
    if (state.workspaceOrder.length === 0 && state.activeWorkspaceId === null) return;
    backend.send({ t: 'state:save', state });
  }, [state]);

  const active = state.activeWorkspaceId ? state.workspaces[state.activeWorkspaceId] : undefined;

  const spawn = useCallback(
    (wsId: string, session: SessionConfig, opts: { shellOnly?: boolean }) => {
      backend.send({
        t: 'pane:spawn',
        paneId: session.id,
        cwd: session.cwd,
        cols: 80,
        rows: 24,
        model: session.model,
        permissionMode: session.permissionMode,
        prompt: session.prompt,
        resumeSessionId: session.resumeSessionId,
        shellOnly: opts.shellOnly,
      });
      setStatuses((s) => ({ ...s, [session.id]: 'running' }));
    },
    [],
  );

  const launch = useCallback(
    (req: LaunchRequest) => {
      if (!active) return;
      const session: SessionConfig = {
        id: makeId('pane'),
        name: req.name,
        cwd: req.cwd,
        model: req.model,
        permissionMode: req.permissionMode,
        prompt: req.prompt,
        createdAt: Date.now(),
      };
      setState((prev) => addSession(prev, active.id, session));
      spawn(active.id, session, { shellOnly: req.shellOnly });
    },
    [active, spawn],
  );

  const resume = useCallback(
    (summary: AcpSessionSummary) => {
      if (!active) return;
      const session: SessionConfig = {
        id: makeId('pane'),
        name: summary.title?.slice(0, 40),
        // Resume must run from the session's ORIGINAL directory, not the
        // workspace default — Devin scopes sessions by working directory.
        cwd: summary.cwd,
        permissionMode: 'auto',
        resumeSessionId: summary.sessionId,
        devinSessionId: summary.sessionId,
        createdAt: Date.now(),
      };
      setState((prev) => addSession(prev, active.id, session));
      spawn(active.id, session, {});
      setPicker(false);
    },
    [active, spawn],
  );

  const closeSession = useCallback((wsId: string, sessionId: string) => {
    backend.send({ t: 'pane:kill', paneId: sessionId });
    setState((prev) => removeSession(prev, wsId, sessionId));
  }, []);

  // Default to a directory that actually exists: the server's cwd, else home.
  // `~` alone is shell syntax, and a process spawned into it dies before it runs.
  const newWorkspace = useCallback(() => {
    setDialog({ mode: 'create', defaultCwd: active?.cwd ?? env?.cwd ?? env?.home ?? '' });
  }, [active, env]);

  /** Pane capacity of the current layout — the Terminals dropdown's value. */
  const paneCount = useMemo(() => (active ? leafCount(active.layout) : 1), [active]);

  const renderPane = (sessionId: string | null, key: string) => {
    if (!active) return null;
    if (!sessionId) {
      return (
        <PaneLauncher key={key} defaultCwd={active.cwd} onLaunch={launch} onImport={() => setPicker(true)} />
      );
    }
    const session = active.sessions[sessionId];
    if (!session) return null;

    return (
      <div className={`pane ${maximized === sessionId ? 'maximized' : ''}`} key={sessionId}>
        <header className="pane-head">
          <span className="pane-name">{session.name || session.devinSessionId || 'devin'}</span>
          <StatusBadge status={statuses[sessionId] ?? 'idle'} />
          <ContextBadge health={healths[sessionId]} />
          <span className="spacer" />
          {session.devinSessionId && (
            <button
              className="ghost"
              title="Trace this session (available once the pane is closed — Devin allows one holder)"
              onClick={() => setTrace({ sessionId: session.devinSessionId!, cwd: session.cwd })}
            >
              ⟐
            </button>
          )}
          <button className="ghost" onClick={() => setMaximized((m) => (m === sessionId ? null : sessionId))}>
            {maximized === sessionId ? '⤡' : '⤢'}
          </button>
          <button className="ghost" onClick={() => closeSession(active.id, sessionId)}>
            ✕
          </button>
        </header>
        <TerminalPane paneId={sessionId} backend={backend} />
      </div>
    );
  };

  return (
    <div className="app">
      <Sidebar
        state={state}
        statuses={statuses}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onSelectWorkspace={(id) => setState((p) => ({ ...p, activeWorkspaceId: id }))}
        onNewWorkspace={newWorkspace}
        onRequestRename={(id) => {
          const ws = state.workspaces[id];
          if (ws) setDialog({ mode: 'rename', id, name: ws.name });
        }}
        onCloseWorkspace={(id) => {
          const ws = state.workspaces[id];
          ws?.sessionOrder.forEach((sid) => backend.send({ t: 'pane:kill', paneId: sid }));
          setState((p) => removeWorkspace(p, id));
        }}
        onSelectSession={(wsId, sid) => {
          setState((p) => ({ ...p, activeWorkspaceId: wsId }));
          setMaximized(null);
          document.getElementById(`pane-${sid}`)?.scrollIntoView({ block: 'nearest' });
        }}
        onCloseSession={closeSession}
      />

      <main className="main">
        {!active ? (
          <div className="empty-state">
            <h1>devin-agent-tmux</h1>
            <p>Run several Devin CLI sessions side by side, in the browser.</p>
            <button className="primary" onClick={newWorkspace}>
              Create a workspace
            </button>
          </div>
        ) : (
          <>
            <header className="toolbar">
              <strong className="ws-title" title={active.cwd}>
                {active.name}
              </strong>

              <div className="segmented" role="group" aria-label="View">
                <button
                  className={active.view === 'grid' ? 'on' : ''}
                  aria-pressed={active.view === 'grid'}
                  onClick={() => setState((p) => setWorkspaceView(p, active.id, 'grid'))}
                >
                  ⊞ Grid
                </button>
                <button
                  className={active.view === 'tabs' ? 'on' : ''}
                  aria-pressed={active.view === 'tabs'}
                  onClick={() => setState((p) => setWorkspaceView(p, active.id, 'tabs'))}
                >
                  ▯ Tabs
                </button>
              </div>

              <label className="terminals">
                <span>Terminals</span>
                <select
                  value={paneCount}
                  onChange={(e) =>
                    setState((p) => applyTemplate(p, active.id, templateForCount(Number(e.target.value))))
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <button
                title="Reset the split sizes for this pane count. Running panes keep their processes."
                onClick={() => setState((p) => applyTemplate(p, active.id, templateForCount(paneCount)))}
              >
                ↺ Reset
              </button>

              <span className="spacer" />
              <button onClick={() => setPicker(true)}>Sessions…</button>
            </header>

            <section className={`stage ${maximized ? 'has-max' : ''}`}>
              {active.view === 'grid' ? (
                <LayoutView
                  node={active.layout}
                  renderPane={renderPane}
                  onResize={(path, sizes) =>
                    setState((p) => setWorkspaceLayout(p, active.id, resizeSplit(active.layout, path, sizes)))
                  }
                />
              ) : (
                <div className="tabs-view">
                  <div className="tab-strip">
                    {active.sessionOrder.map((sid) => (
                      <button
                        key={sid}
                        className={maximized === sid ? 'tab active' : 'tab'}
                        onClick={() => setMaximized(sid)}
                      >
                        {active.sessions[sid]?.name || sid}
                        <StatusBadge status={statuses[sid] ?? 'idle'} />
                      </button>
                    ))}
                  </div>
                  <div className="tab-body">
                    {/* Every pane stays mounted; only visibility changes, so
                        switching tabs never restarts a PTY. */}
                    {active.sessionOrder.map((sid) => (
                      <div key={sid} hidden={maximized !== null && maximized !== sid} className="tab-pane">
                        {renderPane(sid, sid)}
                      </div>
                    ))}
                    {active.sessionOrder.length === 0 && renderPane(null, 'empty')}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {trace && (
        <TracePanel
          backend={backend}
          sessionId={trace.sessionId}
          cwd={trace.cwd}
          onClose={() => setTrace(null)}
        />
      )}

      {dialog && (
        <WorkspaceDialog
          spec={dialog}
          onCancel={() => setDialog(null)}
          onCreate={(name, cwd) => {
            setState((p) => createWorkspace(p, name, cwd));
            setDialog(null);
          }}
          onRename={(id, name) => {
            setState((p) => renameWorkspace(p, id, name));
            setDialog(null);
          }}
        />
      )}

      {picker && active && (
        <SessionPicker
          backend={backend}
          cwd={active.cwd}
          onResume={resume}
          onTrace={(s) => {
            setTrace({ sessionId: s.sessionId, cwd: s.cwd });
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}
