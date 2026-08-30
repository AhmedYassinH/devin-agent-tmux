/**
 * Trace model — fold a replayed ACP session into the turn-by-turn record of
 * what the agent did.
 *
 * This replaces Chorus's 1135-line session-trace.ts, and the size difference is
 * the whole argument for the ACP route. That file had to do three jobs against
 * Claude Code's JSONL: classify noisy entries, merge the many entries that make
 * up one assistant reply, and pair each tool_use with a tool_result arriving
 * later in a different role's entry.
 *
 * ACP hands us all three for free:
 *   - classification  -> `sessionUpdate` is already a discriminant
 *   - tool taxonomy   -> `kind` is on the wire; no CATEGORY_BY_NAME table
 *   - pairing         -> `tool_call_update` carries the same `toolCallId`
 *
 * So this is a fold, not a parser. What remains is chunk coalescing: messages
 * stream as many chunks and a turn is the unit a human recognises.
 */
import {
  type AcpContentBlock,
  type AcpSessionUpdate,
  type AcpToolKind,
  type AcpToolStatus,
  blockText,
  updateTimestamp,
} from './acp.js';

export interface TraceToolCall {
  id: string;
  title: string;
  kind: AcpToolKind;
  status: AcpToolStatus;
  content: AcpContentBlock[];
  startedAt?: number;
  endedAt?: number;
  /** Wall-clock ms, once both ends are known. */
  durationMs?: number;
}

export type TraceTurn =
  | { kind: 'user'; text: string; at?: number }
  | { kind: 'agent'; text: string; thinking: string; tools: TraceToolCall[]; at?: number };

export interface Trace {
  sessionId: string;
  title?: string;
  turns: TraceTurn[];
}

/**
 * Fold updates into a trace.
 *
 * Coalescing rule: consecutive agent chunks and the tool calls between them
 * belong to ONE agent turn; a user chunk closes it. That mirrors how a reply
 * actually reads, rather than emitting a row per streamed fragment.
 */
export function buildTrace(sessionId: string, updates: AcpSessionUpdate[]): Trace {
  const turns: TraceTurn[] = [];
  let title: string | undefined;
  // Index tool calls by id so a later tool_call_update finds its call in O(1),
  // wherever in the stream it lands.
  const toolsById = new Map<string, TraceToolCall>();

  const currentAgentTurn = (at?: number): Extract<TraceTurn, { kind: 'agent' }> => {
    const last = turns[turns.length - 1];
    if (last && last.kind === 'agent') return last;
    const fresh: Extract<TraceTurn, { kind: 'agent' }> = { kind: 'agent', text: '', thinking: '', tools: [], at };
    turns.push(fresh);
    return fresh;
  };

  for (const update of updates) {
    const at = updateTimestamp(update);
    switch (update.sessionUpdate) {
      case 'user_message_chunk': {
        const text = blockText((update as { content?: AcpContentBlock }).content);
        const last = turns[turns.length - 1];
        if (last && last.kind === 'user') last.text += text;
        else turns.push({ kind: 'user', text, at });
        break;
      }
      case 'agent_message_chunk':
        currentAgentTurn(at).text += blockText((update as { content?: AcpContentBlock }).content);
        break;
      case 'agent_thought_chunk':
        currentAgentTurn(at).thinking += blockText((update as { content?: AcpContentBlock }).content);
        break;
      case 'tool_call': {
        const u = update as unknown as {
          toolCallId?: string;
          title?: string;
          kind?: AcpToolKind;
          status?: AcpToolStatus;
          content?: AcpContentBlock[];
        };
        if (!u.toolCallId) break;
        const call: TraceToolCall = {
          id: u.toolCallId,
          title: u.title ?? 'tool',
          kind: u.kind ?? 'other',
          status: u.status ?? 'pending',
          content: u.content ?? [],
          startedAt: at,
        };
        toolsById.set(call.id, call);
        currentAgentTurn(at).tools.push(call);
        break;
      }
      case 'tool_call_update': {
        const u = update as unknown as {
          toolCallId?: string;
          title?: string;
          kind?: AcpToolKind;
          status?: AcpToolStatus;
          content?: AcpContentBlock[];
        };
        const call = u.toolCallId ? toolsById.get(u.toolCallId) : undefined;
        // An update for a call we never saw start is dropped rather than
        // synthesised: a half-known row misreports duration.
        if (!call) break;
        if (u.status) call.status = u.status;
        if (u.title) call.title = u.title;
        if (u.kind) call.kind = u.kind;
        if (u.content?.length) call.content = u.content;
        if (at) {
          call.endedAt = at;
          if (call.startedAt) call.durationMs = at - call.startedAt;
        }
        break;
      }
      case 'session_info_update': {
        const t = (update as { title?: unknown }).title;
        if (typeof t === 'string') title = t;
        break;
      }
      default:
        // config_option_update, plan, available_commands_update, and anything a
        // future Devin adds: not part of the trace, and not an error.
        break;
    }
  }

  return { sessionId, title, turns };
}

/** Counts for the panel header. */
export function traceSummary(trace: Trace): { turns: number; tools: number; failed: number } {
  let tools = 0;
  let failed = 0;
  for (const turn of trace.turns) {
    if (turn.kind !== 'agent') continue;
    tools += turn.tools.length;
    failed += turn.tools.filter((t) => t.status === 'failed').length;
  }
  return { turns: trace.turns.length, tools, failed };
}
