/**
 * ACP (Agent Client Protocol) types — the read-only history channel.
 *
 * Devin ships `devin acp`, a JSON-RPC-over-stdio server that Zed, JetBrains,
 * Xcode and Windsurf drive. We use it for exactly two things: listing past
 * sessions (the import picker) and replaying one (the trace panel). We do NOT
 * drive live panes with it — panes are real `devin` TUIs in a PTY, and ACP
 * cannot attach to a session another process holds (see `isLocked` below).
 *
 * These shapes were captured from the running server (v3000.6.7), not copied
 * from the spec, so the Cognition `_meta` extensions are represented as they
 * actually arrive. Everything is optional: an agent that stops sending a field
 * should cost us a column, never a throw.
 */

/** Capabilities from `initialize`. We check these instead of assuming. */
export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: { list?: unknown; delete?: unknown };
  };
  authMethods?: { id: string; name: string; description?: string }[];
  agentInfo?: { name?: string; title?: string; version?: string };
}

/** One row from `session/list`. */
export interface AcpSessionSummary {
  sessionId: string;
  cwd: string;
  title?: string;
  /** ISO-8601. */
  updatedAt?: string;
  /**
   * True while a live process holds the session lock. Such a session cannot be
   * loaded — the picker shows it, disabled, rather than hiding it, because "my
   * running session is missing from the list" is a worse experience than
   * "greyed out because it's open".
   */
  isLocked?: boolean;
}

/** Normalise the wire row (Cognition puts isLocked under a namespaced _meta). */
export function parseSessionSummary(raw: unknown): AcpSessionSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionId !== 'string' || typeof r.cwd !== 'string') return null;
  const meta = (r._meta ?? {}) as Record<string, unknown>;
  return {
    sessionId: r.sessionId,
    cwd: r.cwd,
    title: typeof r.title === 'string' ? r.title : undefined,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined,
    isLocked: meta['cognition.ai/isLocked'] === true,
  };
}

// ---- session/update notifications ----

/** ACP tool kinds. `kind` is why we need no hand-maintained tool taxonomy. */
export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Content block inside a tool call. Diffs arrive structured — no parsing. */
export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText?: string | null; newText?: string | null }
  | { type: 'terminal'; terminalId: string }
  | { type: string; [k: string]: unknown };

export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: AcpToolKind;
  status?: AcpToolStatus;
  content?: AcpContentBlock[];
  rawInput?: unknown;
}

/** The discriminated union carried in `params.update`. */
export type AcpSessionUpdate =
  | { sessionUpdate: 'user_message_chunk'; content: AcpContentBlock; _meta?: Record<string, unknown> }
  | { sessionUpdate: 'agent_message_chunk'; content: AcpContentBlock; _meta?: Record<string, unknown> }
  | { sessionUpdate: 'agent_thought_chunk'; content: AcpContentBlock; _meta?: Record<string, unknown> }
  | ({ sessionUpdate: 'tool_call' } & AcpToolCall)
  | ({ sessionUpdate: 'tool_call_update' } & AcpToolCall)
  | { sessionUpdate: 'session_info_update'; title?: string }
  | { sessionUpdate: 'plan'; entries?: unknown[] }
  | { sessionUpdate: string; [k: string]: unknown };

/** Per-chunk timestamp, which Cognition namespaces under _meta. */
export function updateTimestamp(update: AcpSessionUpdate): number | undefined {
  const meta = (update as { _meta?: Record<string, unknown> })._meta;
  const ts = meta?.['cognition.ai/timestamp'];
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Flatten a content block to display text. */
export function blockText(block: AcpContentBlock | undefined): string {
  if (!block) return '';
  if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
    return (block as { text: string }).text;
  }
  return '';
}
