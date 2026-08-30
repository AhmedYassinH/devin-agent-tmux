/**
 * ACP client — a short-lived `devin acp` subprocess used to read history.
 *
 * Two calls only: `session/list` for the import picker and `session/load` to
 * replay one session into the trace panel. We never drive a live pane through
 * ACP: a pane is a real `devin` TUI holding the session lock, and the agent
 * reports `isLocked` for exactly that reason.
 *
 * The process is spawned per request rather than kept warm. It costs ~2s of
 * startup, but a long-lived sidecar would hold MCP servers open and keep a
 * stdio pipe alive for a feature the user touches occasionally — the wrong
 * trade for a background reader.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import {
  describeAcpError,
  parseSessionSummary,
  type AcpErrorKind,
  type AcpFailure,
  type AcpInitializeResult,
  type AcpSessionSummary,
  type AcpSessionUpdate,
} from '../core/acp.js';

/**
 * A failed ACP request, carrying the classified reason alongside the sentence.
 *
 * The kind travels to the browser so the trace panel can present a locked
 * session as the expected state it is, rather than as an error.
 */
export class AcpRequestError extends Error {
  readonly kind: AcpErrorKind;
  constructor(failure: AcpFailure) {
    super(failure.message);
    this.name = 'AcpRequestError';
    this.kind = failure.kind;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** Line-delimited JSON-RPC over the child's stdio. */
class AcpConnection {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = '';
  /** session/update notifications, in arrival order. */
  readonly updates: AcpSessionUpdate[] = [];

  constructor(cwd: string) {
    // A login shell, for the same PATH reason panes need one: devin lives in
    // ~/.local/bin, which a minimal server env does not have.
    this.child = spawn('/bin/sh', ['-lc', 'devin acp'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    // Devin logs to stderr at INFO; it is not an error channel here.
    this.child.stderr.resume();
    this.child.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('devin acp exited'));
      this.pending.clear();
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.onLine(line);
      nl = this.buffer.indexOf('\n');
    }
  }

  private onLine(line: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not our frame; devin also emits diagnostic lines
    }

    if (msg.method === 'session/update') {
      const params = msg.params as { update?: AcpSessionUpdate } | undefined;
      if (params?.update) this.updates.push(params.update);
      return;
    }

    // Requests FROM the agent (permission prompts, fs reads). We declared no
    // client capabilities, so refuse rather than hang the agent waiting.
    if (typeof msg.method === 'string' && msg.id !== undefined) {
      this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'client capability not offered' } });
      return;
    }

    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      // Never reject with the raw JSON-RPC object: it used to be stringified
      // straight into the trace panel, where a locked session — an expected
      // state, not a fault — appeared as a wall of red JSON.
      if (msg.error) p.reject(new AcpRequestError(describeAcpError(msg.error)));
      else p.resolve(msg.result);
    }
  }

  private send(payload: unknown) {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

/**
 * We advertise no fs/terminal capabilities: this connection only reads history,
 * and offering capabilities we don't implement invites the agent to block on us.
 */
const CLIENT_CAPABILITIES = { fs: { readTextFile: false, writeTextFile: false }, terminal: false };

async function connect(cwd: string): Promise<{ conn: AcpConnection; init: AcpInitializeResult }> {
  const conn = new AcpConnection(cwd);
  const init = (await conn.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: CLIENT_CAPABILITIES,
  })) as AcpInitializeResult;
  return { conn, init };
}

/** Past sessions, newest first. `cwd` scopes which project the agent starts in. */
export async function listSessions(cwd: string): Promise<AcpSessionSummary[]> {
  const { conn, init } = await connect(cwd);
  try {
    if (!init.agentCapabilities?.sessionCapabilities?.list) {
      throw new Error('this devin build does not advertise session/list');
    }
    const result = (await conn.request('session/list', {})) as { sessions?: unknown[] };
    const rows = (result.sessions ?? []).map(parseSessionSummary).filter((s): s is AcpSessionSummary => s !== null);
    rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return rows;
  } finally {
    conn.close();
  }
}

/**
 * Replay one session. The agent streams its history as session/update
 * notifications and then resolves the request; the notifications collected
 * during that window ARE the trace.
 */
export async function loadSession(sessionId: string, cwd: string): Promise<AcpSessionUpdate[]> {
  const { conn, init } = await connect(cwd);
  try {
    if (!init.agentCapabilities?.loadSession) throw new Error('this devin build cannot load sessions');
    await conn.request('session/load', { sessionId, cwd, mcpServers: [] }, 60_000);
    return [...conn.updates];
  } finally {
    conn.close();
  }
}
