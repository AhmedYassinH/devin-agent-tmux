/**
 * Two-tier sidebar: workspaces as collapsible groups with their panes nested
 * underneath. Collapses to a rail to reclaim width for the terminals.
 */
import { useState } from 'react';
import type { AppState, PaneStatus } from '../core/models.js';
import { StatusBadge } from './StatusBadge.js';

export function Sidebar({
  state,
  statuses,
  collapsed,
  onToggleCollapsed,
  onSelectWorkspace,
  onNewWorkspace,
  onRequestRename,
  onCloseWorkspace,
  onSelectSession,
  onCloseSession,
}: {
  state: AppState;
  statuses: Record<string, PaneStatus>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onRequestRename: (id: string) => void;
  onCloseWorkspace: (id: string) => void;
  onSelectSession: (wsId: string, sessionId: string) => void;
  onCloseSession: (wsId: string, sessionId: string) => void;
}) {
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  if (collapsed) {
    return (
      <nav className="sidebar rail">
        <button className="ghost" onClick={onToggleCollapsed} title="Expand sidebar">
          »
        </button>
        {state.workspaceOrder.map((id) => {
          const ws = state.workspaces[id];
          if (!ws) return null;
          const attention = ws.sessionOrder.some((s) => statuses[s] === 'waiting');
          return (
            <button
              key={id}
              className={`rail-ws ${id === state.activeWorkspaceId ? 'active' : ''}`}
              onClick={() => onSelectWorkspace(id)}
              title={ws.name}
            >
              {ws.name.slice(0, 2).toUpperCase()}
              {attention && <i className="attention" />}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="sidebar">
      <header>
        <span className="brand">devin-agent-tmux</span>
        <button className="ghost" onClick={onToggleCollapsed} title="Collapse sidebar">
          «
        </button>
      </header>

      <button className="new-ws" onClick={onNewWorkspace}>
        + new workspace
      </button>

      <ul className="ws-list">
        {state.workspaceOrder.map((id) => {
          const ws = state.workspaces[id];
          if (!ws) return null;
          const isFolded = folded[id] ?? false;
          const attention = ws.sessionOrder.some((s) => statuses[s] === 'waiting');

          return (
            <li key={id} className={id === state.activeWorkspaceId ? 'ws active' : 'ws'}>
              <div className="ws-head">
                <button className="fold" onClick={() => setFolded((f) => ({ ...f, [id]: !isFolded }))}>
                  {isFolded ? '▸' : '▾'}
                </button>
                <button
                  className="ws-name"
                  onClick={() => onSelectWorkspace(id)}
                  onDoubleClick={() => onRequestRename(id)}
                  title={ws.cwd}
                >
                  {ws.name}
                  {attention && <i className="attention" />}
                </button>
                <button className="ghost" onClick={() => onCloseWorkspace(id)} title="Close workspace">
                  ✕
                </button>
              </div>

              {!isFolded && (
                <ul className="session-rows">
                  {ws.sessionOrder.map((sid) => {
                    const session = ws.sessions[sid];
                    if (!session) return null;
                    return (
                      <li key={sid}>
                        <button className="session-row" onClick={() => onSelectSession(id, sid)}>
                          <span className="name">{session.name || session.devinSessionId || sid}</span>
                          <StatusBadge status={statuses[sid] ?? 'idle'} />
                        </button>
                        <button className="ghost" onClick={() => onCloseSession(id, sid)} title="Close pane">
                          ✕
                        </button>
                      </li>
                    );
                  })}
                  {ws.sessionOrder.length === 0 && <li className="muted small empty">no panes yet</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
