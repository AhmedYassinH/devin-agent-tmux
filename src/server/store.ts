/**
 * The local profile store — the source of truth.
 *
 * One JSON file per entity, human-readable and `cat`-able, the way Claude Code
 * and Devin both store their own state. Convex mirrors this (see convex-mirror.ts);
 * it does not replace it, so the app runs fully offline and a Convex outage costs
 * sync, not your workspaces.
 *
 *   ~/.devin-agent-tmux/
 *     state.json                       storeVersion, active workspace, order
 *     workspaces/<ws>/workspace.json   name, cwd, view, layout, session order
 *     workspaces/<ws>/sessions/<s>.json  one SessionConfig
 *     hooks/hook.mjs                   the OSC emitter the hooks invoke
 *     panes/<pane>/config.json         per-pane devin config (user config + hooks)
 *     panes/<pane>/export.json         --export target, read by context-health
 *
 * Writes are atomic (tmp + rename) and diffed — a rename touches one file, not
 * the world. Loading is tolerant: each file is validated on its own, so a corrupt
 * session file loses that session, never the profile.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type AppState, type SessionConfig, type Workspace, STORE_VERSION, emptyState } from '../core/models.js';

export function profileRoot(): string {
  return process.env.DEVIN_MUX_HOME || join(homedir(), '.devin-agent-tmux');
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomic, and a no-op when the content is byte-identical to what's on disk. */
function writeJson(path: string, value: unknown): boolean {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (readFileSync(path, 'utf8') === next) return false;
  } catch {
    /* not present yet */
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, next, 'utf8');
  renameSync(tmp, path);
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class FileStore {
  readonly root: string;

  constructor(root = profileRoot()) {
    this.root = root;
    mkdirSync(this.root, { recursive: true });
  }

  private statePath() {
    return join(this.root, 'state.json');
  }
  private wsDir(id: string) {
    return join(this.root, 'workspaces', id);
  }
  paneDir(paneId: string) {
    return join(this.root, 'panes', paneId);
  }
  hookScriptPath() {
    return join(this.root, 'hooks', 'hook.mjs');
  }

  /** Ensure the hook emitter exists on disk, rewriting it only when it changed. */
  ensureHookScript(source: string): string {
    const path = this.hookScriptPath();
    mkdirSync(dirname(path), { recursive: true });
    let current: string | null = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* first run */
    }
    if (current !== source) writeFileSync(path, source, { encoding: 'utf8', mode: 0o755 });
    return path;
  }

  load(): AppState {
    const raw = readJson(this.statePath());
    if (!isRecord(raw)) return emptyState();

    // A profile written by a NEWER build is left strictly untouched: we return an
    // empty in-memory state rather than risk downgrading files we don't understand.
    const version = typeof raw.storeVersion === 'number' ? raw.storeVersion : 0;
    if (version > STORE_VERSION) {
      console.warn(`[store] profile at ${this.root} is version ${version} (we speak ${STORE_VERSION}); not touching it`);
      return emptyState();
    }

    const order = Array.isArray(raw.workspaceOrder) ? raw.workspaceOrder.filter((x): x is string => typeof x === 'string') : [];
    const workspaces: Record<string, Workspace> = {};
    for (const id of order) {
      const ws = readJson(join(this.wsDir(id), 'workspace.json'));
      if (!isRecord(ws)) continue;

      const sessions: Record<string, SessionConfig> = {};
      const sessDir = join(this.wsDir(id), 'sessions');
      if (existsSync(sessDir)) {
        for (const file of readdirSync(sessDir)) {
          if (!file.endsWith('.json')) continue;
          const s = readJson(join(sessDir, file));
          // Validated individually: one bad file loses one pane.
          if (isRecord(s) && typeof s.id === 'string' && typeof s.cwd === 'string') {
            sessions[s.id] = s as unknown as SessionConfig;
          }
        }
      }

      workspaces[id] = {
        id,
        name: typeof ws.name === 'string' ? ws.name : id,
        cwd: typeof ws.cwd === 'string' ? ws.cwd : homedir(),
        view: ws.view === 'tabs' ? 'tabs' : 'grid',
        layout: (ws.layout ?? { type: 'leaf', sessionId: null }) as Workspace['layout'],
        sessionOrder: Array.isArray(ws.sessionOrder)
          ? ws.sessionOrder.filter((x): x is string => typeof x === 'string' && x in sessions)
          : Object.keys(sessions),
        sessions,
        contextApiKey: typeof ws.contextApiKey === 'string' ? ws.contextApiKey : undefined,
        updatedAt: typeof ws.updatedAt === 'number' ? ws.updatedAt : 0,
      };
    }

    const active = typeof raw.activeWorkspaceId === 'string' ? raw.activeWorkspaceId : null;
    return {
      storeVersion: STORE_VERSION,
      activeWorkspaceId: active && workspaces[active] ? active : (order.find((i) => workspaces[i]) ?? null),
      workspaceOrder: order.filter((i) => workspaces[i]),
      workspaces,
    };
  }

  /** Persist, rewriting only files whose content actually changed. */
  save(state: AppState): void {
    writeJson(this.statePath(), {
      storeVersion: STORE_VERSION,
      activeWorkspaceId: state.activeWorkspaceId,
      workspaceOrder: state.workspaceOrder,
    });

    for (const id of state.workspaceOrder) {
      const ws = state.workspaces[id];
      if (!ws) continue;
      const { sessions, ...rest } = ws;
      writeJson(join(this.wsDir(id), 'workspace.json'), rest);

      const sessDir = join(this.wsDir(id), 'sessions');
      mkdirSync(sessDir, { recursive: true });
      const live = new Set(Object.keys(sessions));
      for (const session of Object.values(sessions)) {
        writeJson(join(sessDir, `${session.id}.json`), session);
      }
      // Only remove files we manage; anything else in the tree is left alone.
      for (const file of readdirSync(sessDir)) {
        if (file.endsWith('.json') && !live.has(file.slice(0, -5))) {
          rmSync(join(sessDir, file), { force: true });
        }
      }
    }

    // Drop workspace directories no longer in the order.
    const wsRoot = join(this.root, 'workspaces');
    if (existsSync(wsRoot)) {
      const keep = new Set(state.workspaceOrder);
      for (const dir of readdirSync(wsRoot)) {
        if (!keep.has(dir)) rmSync(join(wsRoot, dir), { recursive: true, force: true });
      }
    }
  }
}
