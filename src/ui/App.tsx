/**
 * App shell. Owns AppState (mirrored to the server on every change), pane
 * runtime state (status / context health, deliberately NOT persisted — it is
 * about a live process), and which modal is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppState,
  type Card,
  type CardColumn,
  type PaneStatus,
  type SessionConfig,
  DEFAULT_PERMISSION_MODE,
  emptyState,
  makeId,
} from '../core/models.js';
import {
  applyCardSession,
  applyCardStatus,
  createCard,
  markStarted,
  moveCard,
  removeCard,
  updateCard,
} from '../core/board.js';
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
import { BoardView } from './BoardView.js';
import type { CardDraft } from './CardDialog.js';
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
  /**
   * Which pane the tab strip is showing. Separate from `maximized`: maximizing
   * in Grid and selecting in Tabs are different intents, and conflating them
   * meant Tabs rendered every pane at once until you happened to click one.
   */
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // Real paths from the server: the browser cannot resolve `~` or know a cwd.
  const [env, setEnv] = useState<{ home: string; cwd: string; hasDefaultContextKey: boolean } | null>(
    null,
  );
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

  // Latest state, for event handlers that must read it without being rebuilt on
  // every change (e.g. deleting a card needs its paneId to kill the process).
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    return backend.subscribe((msg) => {
      switch (msg.t) {
        case 'env':
          setEnv({ home: msg.home, cwd: msg.cwd, hasDefaultContextKey: msg.hasDefaultContextKey });
          break;
        case 'state':
          applyingRemote.current = true;
          setState(msg.state);
          break;
        case 'pane:status':
          setStatuses((s) => ({ ...s, [msg.paneId]: msg.status }));
          // A ticket's column follows its agent: this is what lets the board run
          // itself. applyCardStatus is a no-op for a terminal-grid pane, so this
          // is safe to run for every status regardless of where the pane lives.
          setState((prev) => applyCardStatus(prev, msg.paneId, msg.status));
          break;
        case 'pane:exit':
          setStatuses((s) => ({ ...s, [msg.paneId]: 'exited' }));
          setState((prev) => applyCardStatus(prev, msg.paneId, 'exited'));
          break;
        case 'pane:health':
          setHealths((h) => ({ ...h, [msg.paneId]: msg.health }));
          break;
        case 'pane:session':
          // Devin chose its session id and the SessionStart hook reported it.
          // Persist immediately: this id is what `devin -r` needs later, and a
          // pane that crashes before we store it is unresumable. A pane belongs
          // either to a workspace session or to a board card — record on whichever
          // owns it.
          setState((prev) => {
            const wsId = prev.workspaceOrder.find((id) => prev.workspaces[id]?.sessions[msg.paneId]);
            const next = wsId
              ? updateSession(prev, wsId, msg.paneId, { devinSessionId: msg.devinSessionId })
              : prev;
            return applyCardSession(next, msg.paneId, msg.devinSessionId);
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
    (session: SessionConfig, opts: { shellOnly?: boolean; contextApiKey?: string }) => {
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
        // The owning workspace's context.dev key. Undefined is meaningful: the
        // server falls back to its own default rather than skipping the server.
        contextApiKey: opts.contextApiKey,
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
      spawn(session, { shellOnly: req.shellOnly, contextApiKey: active.contextApiKey });
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

  // ---- Kanban board handlers -------------------------------------------------

  /**
   * Start (or restart) a ticket: spawn a Devin session whose first-turn prompt
   * IS the ticket description. The pane reuses the card's own id space, so
   * status, context health and the embedded terminal all key off it. A restart
   * reuses the same paneId, so the server kills the old process and the card's
   * terminal stays bound to the one live session. The context.dev key comes from
   * the ticket's own field, else the owning workspace's — either falls back to
   * the server's .env default (undefined is meaningful; see core/mcp.ts).
   */
  const startCard = useCallback((wsId: string, card: Card) => {
    const paneId = card.paneId ?? makeId('pane');
    setState((prev) => markStarted(prev, wsId, card.id, paneId));
    backend.send({
      t: 'pane:spawn',
      paneId,
      cwd: card.cwd,
      cols: 80,
      rows: 24,
      model: card.model,
      permissionMode: card.permissionMode,
      prompt: card.description,
      contextApiKey: card.contextApiKey ?? stateRef.current.workspaces[wsId]?.contextApiKey,
    });
    setStatuses((s) => ({ ...s, [paneId]: 'running' }));
  }, []);

  const stopCard = useCallback((_wsId: string, card: Card) => {
    if (card.paneId) backend.send({ t: 'pane:kill', paneId: card.paneId });
  }, []);

  const createCardHandler = useCallback((wsId: string, draft: CardDraft) => {
    setState((prev) => createCard(prev, wsId, draft).state);
  }, []);

  const updateCardHandler = useCallback((wsId: string, id: string, fields: Partial<Card>) => {
    setState((prev) => updateCard(prev, wsId, id, fields));
  }, []);

  const deleteCardHandler = useCallback((wsId: string, id: string) => {
    // Kill a running agent before dropping its card, so we don't orphan a
    // process holding a session lock (which would make that session unloadable).
    const card = stateRef.current.workspaces[wsId]?.cards[id];
    if (card?.paneId) backend.send({ t: 'pane:kill', paneId: card.paneId });
    setState((prev) => removeCard(prev, wsId, id));
  }, []);

  const moveCardHandler = useCallback((wsId: string, id: string, column: CardColumn) => {
    setState((prev) => moveCard(prev, wsId, id, column));
  }, []);

  // Default to a directory that actually exists: the server's cwd, else home.
  // `~` alone is shell syntax, and a process spawned into it dies before it runs.
  const newWorkspace = useCallback(() => {
    setDialog({
      mode: 'create-workspace',
      defaultCwd: active?.cwd ?? env?.cwd ?? env?.home ?? '',
      hasDefaultContextKey: env?.hasDefaultContextKey ?? false,
    });
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
   * Agents blocked on a human, across every workspace. This drives the tag in
   * the nav bar — the one thing on screen that is genuinely waiting on the
   * user, so it earns a warning colour when it is non-zero and reads as plain
   * neutral text when it is not.
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

    const status = statuses[sessionId] ?? 'idle';

    // Panes are told apart by the surface system, not by a per-pane colour: the
    // brass left edge marks the one you are typing into (CSS :focus-within),
    // and a blocked agent tints its own header. Both are states worth seeing;
    // "third pane you opened" was not.
    return (
      <div
        className={`pane ${status === 'waiting' ? 'needs-you' : ''} ${maximized === sessionId ? 'maximized' : ''}`}
        key={sessionId}
      >
        <header className="pane-head">
          <span className="pane-name">{session.name || session.devinSessionId || 'devin'}</span>
          <StatusBadge status={status} />
          <ContextBadge health={healths[sessionId]} />
          <span className="spacer" />
          {session.devinSessionId && (
            <button
              className="ghost icon"
              aria-label="Trace this session"
              title="Trace this session (available once the pane is closed — Devin allows one holder)"
              onClick={() => setTrace({ sessionId: session.devinSessionId!, cwd: session.cwd })}
            >
              ⟐
            </button>
          )}
          <button
            className="ghost icon"
            aria-label={maximized === sessionId ? 'Restore pane' : 'Maximize pane'}
            title={maximized === sessionId ? 'Restore' : 'Maximize'}
            onClick={() => setMaximized((m) => (m === sessionId ? null : sessionId))}
          >
            {maximized === sessionId ? '⤡' : '⤢'}
          </button>
          <button
            className="ghost icon"
            aria-label="Close pane"
            title="Close pane"
            onClick={() => closeSession(active.id, sessionId)}
          >
            ✕
          </button>
        </header>
        <TerminalPane paneId={sessionId} backend={backend} />
      </div>
    );
  };

  return (
    <div className="app">
      {/* The nav bar. The wordmark glyph is the only brass here; the waiting
          count earns the second appearance only when it is non-zero. */}
      <header className="banner">
        <span className="wordmark">
          {/* Four panes on a grid — engraved, square caps, never filled. */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="square" strokeLinejoin="miter" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />
          </svg>
          <span className="wordmark-name">Devin Agent Tmux</span>
        </span>
        <span className="banner-tag">Run many agents. In parallel.</span>
        <span className="spacer" />
        {/* Status is carried by the word, not only the colour. */}
        <span
          className={waitingCount > 0 ? 'tag tag-warning' : 'tag tag-neutral'}
          title="Agents blocked on your input"
        >
          {waitingCount > 0 ? `${waitingCount} waiting` : 'none waiting'}
        </span>
        <button className="ghost" onClick={() => setGuide(true)} title="How this works">
          Guide
        </button>
        <button className="primary" onClick={newWorkspace}>
          New workspace
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
            <div className="readout-rule">
              <span className="rule-label">No workspace</span>
              <i className="rule-line" />
            </div>
            <h1>Agent workspaces</h1>
            <p>
              A workspace is a named group of Devin sessions with its own layout and a default
              working directory. Point one at a project, pick how many terminals you want, and run
              several agents side by side &mdash; each with its own status, context budget and
              transcript.
            </p>
            {/* One primary action per region: only the first is brass. */}
            <div className="empty-actions">
              <button className="primary" onClick={newWorkspace}>
                Create a workspace
              </button>
              <button className="secondary" onClick={() => setPicker(true)}>
                Resume a past session
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="toolbar">
              <span className="ws-heading">
                <strong className="ws-title">{active.name}</strong>
                {/* The path is a measured thing: mono, and truncated from the
                    root so the leaf stays readable. */}
                <span className="ws-cwd" title={active.cwd}>
                  {active.cwd}
                </span>
              </span>

              {/* A workspace's kind is fixed at creation (see NameDialog): a
                  board has no terminal grid and a terminal never becomes a
                  board, so there is no cross-kind switch to break a running
                  workspace. A terminal workspace still toggles Grid<->Tabs; a
                  board shows a static kind indicator instead. */}
              {active.view === 'board' ? (
                <span className="tag" title="This is a Kanban board workspace">
                  ▤ Board
                </span>
              ) : (
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
              )}

              {/* Pane-count controls belong to the terminal views only; the
                  board manages its own tickets. */}
              {active.view !== 'board' && (
                <>
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
                </>
              )}

              <span className="spacer" />
              <button onClick={() => setPicker(true)}>Sessions…</button>
            </header>

            {active.view === 'board' ? (
              <BoardView
                workspace={active}
                statuses={statuses}
                healths={healths}
                hasDefaultContextKey={env?.hasDefaultContextKey ?? false}
                backend={backend}
                onCreateCard={(draft) => createCardHandler(active.id, draft)}
                onUpdateCard={(id, fields) => updateCardHandler(active.id, id, fields)}
                onDeleteCard={(id) => deleteCardHandler(active.id, id)}
                onStartCard={(card) => startCard(active.id, card)}
                onStopCard={(card) => stopCard(active.id, card)}
                onMoveCard={(id, column) => moveCardHandler(active.id, id, column)}
              />
            ) : (
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
            )}
          </>
        )}
      </main>
      </div>

      <footer className="footer-band">
        <span>Local-first. Your agents run on this machine &mdash; nothing is uploaded.</span>
        <span className="spacer" />
        {/* A version is a measurement: `data` type, tabular numerals. */}
        <span className="data">v0.1.0</span>
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
          onSubmit={(name, cwd, contextApiKey, asBoard) => {
            setState((p) => {
              switch (dialog.mode) {
                case 'create-workspace': {
                  const next = createWorkspace(p, name, cwd, undefined, contextApiKey);
                  // The kind is chosen once, here — a board workspace has no
                  // terminal grid and never gains one.
                  const id = next.activeWorkspaceId;
                  return asBoard && id ? setWorkspaceView(next, id, 'board') : next;
                }
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
