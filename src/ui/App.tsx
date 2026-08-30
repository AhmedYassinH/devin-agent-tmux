/**
 * App shell. Owns AppState (mirrored to the server on every change), pane
 * runtime state (status / context health, deliberately NOT persisted — it is
 * about a live process), and which modal is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppState,
  type PaneStatus,
  type SessionConfig,
  DEFAULT_PERMISSION_MODE,
  emptyState,
  makeId,
} from '../core/models.js';
import { templateForCount } from '../core/layout.js';
import {
  addSession,
  applyTemplate,
  createWorkspace,
  dirBasename,
  uniqueWorkspaceName,
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
import { NameDialog, type NameDialogSpec } from './NameDialog.js';
import { Guide } from './Guide.js';
import { ContextBadge, StatusBadge } from './StatusBadge.js';
import { tintForIndex } from './theme.js';

const backend = new Backend();

export function App() {
  const [state, setState] = useState<AppState>(emptyState());
  const [statuses, setStatuses] = useState<Record<string, PaneStatus>>({});
  const [healths, setHealths] = useState<Record<string, ContextHealth>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [picker, setPicker] = useState(false);
  const [trace, setTrace] = useState<{ sessionId: string; cwd: string } | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);
  /**
   * Which pane the tab strip is showing. Separate from `maximized`: maximizing
   * in Grid and selecting in Tabs are different intents, and conflating them
   * meant Tabs rendered every pane at once until you happened to click one.
   */
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // Real paths from the server: the browser cannot resolve `~` or know a cwd.
  const [env, setEnv] = useState<{ home: string; cwd: string } | null>(null);
  const [dialog, setDialog] = useState<NameDialogSpec | null>(null);
  /**
   * Show the guide unprompted on a first visit, then never again.
   *
   * localStorage is the right home for this: it is a per-viewer convenience, not
   * state anything else needs to read. Wrapped because the accessor itself
   * throws in a private window or with site data blocked — in which case we show
   * the guide, which is the harmless direction to be wrong in.
   */
  const [guide, setGuide] = useState<boolean>(() => {
    try {
      return localStorage.getItem('devin-mux.guide-seen') !== '1';
    } catch {
      return true;
    }
  });

  const closeGuide = useCallback(() => {
    setGuide(false);
    try {
      localStorage.setItem('devin-mux.guide-seen', '1');
    } catch {
      // Nothing to do: the guide simply reappears next time.
    }
  }, []);

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
    (session: SessionConfig, opts: { shellOnly?: boolean }) => {
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
      // No model, prompt or permission mode: the pane is the real TUI, so those
      // are set there. buildDevinLaunch still supports every flag.
      const session: SessionConfig = {
        id: makeId('pane'),
        name: req.name,
        cwd: req.cwd,
        permissionMode: DEFAULT_PERMISSION_MODE,
        createdAt: Date.now(),
      };
      setState((prev) => addSession(prev, active.id, session));
      spawn(session, { shellOnly: req.shellOnly });
      setActiveTab(session.id);
    },
    [active, spawn],
  );

  /**
   * Import a past session into a workspace of its OWN.
   *
   * Not the active workspace: `devin -r` must run in the session's original
   * working directory, so an imported pane's cwd is almost never the current
   * workspace's. Dropping it there would produce a workspace whose panes do not
   * share its directory — the cwd in the toolbar would be a lie, and the next
   * pane launched from it would start somewhere else entirely.
   */
  const resume = useCallback(
    (summary: AcpSessionSummary) => {
      const session: SessionConfig = {
        id: makeId('pane'),
        name: summary.title?.slice(0, 40),
        cwd: summary.cwd,
        permissionMode: DEFAULT_PERMISSION_MODE,
        resumeSessionId: summary.sessionId,
        devinSessionId: summary.sessionId,
        createdAt: Date.now(),
      };

      setState((prev) => {
        // createWorkspace makes the new workspace active, which is how we learn
        // the id it generated.
        const named = uniqueWorkspaceName(prev, dirBasename(summary.cwd));
        const withWorkspace = createWorkspace(prev, named, summary.cwd);
        const wsId = withWorkspace.activeWorkspaceId;
        return wsId ? addSession(withWorkspace, wsId, session) : withWorkspace;
      });

      spawn(session, {});
      setActiveTab(session.id);
      setMaximized(null);
      setPicker(false);
    },
    [spawn],
  );

  const closeSession = useCallback((wsId: string, sessionId: string) => {
    backend.send({ t: 'pane:kill', paneId: sessionId });
    setState((prev) => removeSession(prev, wsId, sessionId));
  }, []);

  // Default to a directory that actually exists: the server's cwd, else home.
  // `~` alone is shell syntax, and a process spawned into it dies before it runs.
  const newWorkspace = useCallback(() => {
    setDialog({ mode: 'create-workspace', defaultCwd: active?.cwd ?? env?.cwd ?? env?.home ?? '' });
  }, [active, env]);

  /**
   * The tab actually on screen. Falls back to the first pane so the strip always
   * has exactly one selection, including right after a workspace switch or when
   * the selected pane was closed.
   */
  const currentTab = useMemo(() => {
    if (!active) return null;
    if (activeTab && active.sessions[activeTab]) return activeTab;
    return active.sessionOrder[0] ?? null;
  }, [active, activeTab]);

  /**
   * Agents blocked on a human, across every workspace. This drives the red
   * banner callout: in 1996 the phone number sat top-right because calling was
   * the action the page existed to provoke. Here, the thing demanding action is
   * an agent waiting on you.
   */
  const waitingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === 'waiting').length,
    [statuses],
  );

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

    // Each pane owns a catalog tint the way each Dell product line did. Keyed on
    // position so neighbouring panes always differ.
    const tint = tintForIndex(active.sessionOrder.indexOf(sessionId));
    const status = statuses[sessionId] ?? 'idle';

    return (
      <div
        className={`pane tint-${tint} ${maximized === sessionId ? 'maximized' : ''}`}
        key={sessionId}
      >
        {/* new-burst-sticker: taped on at an angle when the agent is blocked */}
        {status === 'waiting' && <span className="burst">Needs you!</span>}
        <header className="pane-head">
          <span className="pane-name">{session.name || session.devinSessionId || 'devin'}</span>
          <StatusBadge status={status} />
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
      {/* top-banner: black strip, Helvetica caps, red callout + yellow sticker */}
      <header className="banner">
        <span className="banner-brand">Devin&middot;Agent&middot;Tmux</span>
        <span className="banner-tag">Run many agents. In parallel.</span>
        <span className="spacer" />
        <span
          className={waitingCount > 0 ? 'callout' : 'callout quiet'}
          title="Agents blocked on your input"
        >
          {waitingCount > 0 ? `${waitingCount} agent${waitingCount === 1 ? '' : 's'} waiting` : 'No agents waiting'}
        </span>
        <button className="banner-link" onClick={() => setGuide(true)} title="How this works">
          Guide
        </button>
        {/* buy-a-dell-sticker slot: the page's primary entry action */}
        <button className="sticker" onClick={newWorkspace}>
          + New workspace
        </button>
      </header>

      <div className="body-row">
      <Sidebar
        state={state}
        statuses={statuses}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onSelectWorkspace={(id) => setState((p) => ({ ...p, activeWorkspaceId: id }))}
        onNewWorkspace={newWorkspace}
        onRequestRename={(id) => {
          const ws = state.workspaces[id];
          if (ws) setDialog({ mode: 'rename-workspace', id, name: ws.name });
        }}
        onRequestRenameSession={(wsId, sessionId) => {
          const session = state.workspaces[wsId]?.sessions[sessionId];
          if (session) {
            setDialog({
              mode: 'rename-session',
              wsId,
              id: sessionId,
              // Seed with whatever the row already shows, so a rename edits the
              // visible label rather than starting from an empty field.
              name: session.name || session.devinSessionId || '',
            });
          }
        }}
        onCloseWorkspace={(id) => {
          const ws = state.workspaces[id];
          ws?.sessionOrder.forEach((sid) => backend.send({ t: 'pane:kill', paneId: sid }));
          setState((p) => removeWorkspace(p, id));
        }}
        onSelectSession={(wsId, sid) => {
          setState((p) => ({ ...p, activeWorkspaceId: wsId }));
          setMaximized(null);
          setActiveTab(sid);
        }}
        onCloseSession={closeSession}
      />

      <main className="main">
        {!active ? (
          <div className="empty-state">
            <h1>Agent Workspaces</h1>
            {/* cta-block-red: one per page, maximum. The singular attention pole. */}
            <div className="cta-red">
              <p>
                A workspace is a named group of Devin sessions with its own layout and a default
                working directory. Point one at a project, pick how many terminals you want, and run
                several agents side by side &mdash; each with its own status, context budget and
                transcript.
              </p>
              <button onClick={newWorkspace}>Create a workspace</button>
              <button onClick={() => setPicker(true)}>Resume a past session</button>
            </div>
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
                        className={currentTab === sid ? 'tab active' : 'tab'}
                        aria-selected={currentTab === sid}
                        onClick={() => setActiveTab(sid)}
                      >
                        {active.sessions[sid]?.name || sid}
                        <StatusBadge status={statuses[sid] ?? 'idle'} />
                      </button>
                    ))}
                  </div>
                  <div className="tab-body">
                    {/* Every pane stays mounted; only visibility changes, so
                        switching tabs never restarts a PTY or loses scrollback. */}
                    {active.sessionOrder.map((sid) => (
                      <div key={sid} hidden={sid !== currentTab} className="tab-pane">
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
      </div>

      {/* footer-band: classic-blue anchors and small print, as every 1996 page had */}
      <footer className="footer-band">
        <span>
          Local-first. Your agents run on this machine &mdash; nothing is uploaded.
        </span>
        <span className="spacer" />
        <span className="muted small">
          Best viewed with browser versions 3.0 and higher.
        </span>
      </footer>

      {trace && (
        <TracePanel
          backend={backend}
          sessionId={trace.sessionId}
          cwd={trace.cwd}
          onClose={() => setTrace(null)}
        />
      )}

      {guide && <Guide onClose={closeGuide} />}

      {dialog && (
        <NameDialog
          spec={dialog}
          onCancel={() => setDialog(null)}
          onSubmit={(name, cwd) => {
            setState((p) => {
              switch (dialog.mode) {
                case 'create-workspace':
                  return createWorkspace(p, name, cwd);
                case 'rename-workspace':
                  return renameWorkspace(p, dialog.id, name);
                case 'rename-session':
                  return updateSession(p, dialog.wsId, dialog.id, { name });
              }
            });
            setDialog(null);
          }}
        />
      )}

      {picker && (
        <SessionPicker
          backend={backend}
          cwd={active?.cwd ?? env?.cwd ?? env?.home ?? '.'}
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
