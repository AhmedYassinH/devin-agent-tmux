import { describe, expect, it } from 'vitest';
import { buildTrace, traceSummary } from './trace.js';
import type { AcpSessionUpdate } from './acp.js';

const ts = (iso: string) => ({ 'cognition.ai/timestamp': iso });

describe('buildTrace', () => {
  it('coalesces streamed chunks into turns', () => {
    // Captured shape: chunks arrive one content block at a time.
    const updates: AcpSessionUpdate[] = [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'fix ' }, _meta: ts('2026-08-30T07:51:01Z') },
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'the build' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'On ' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'it.' } },
    ];
    const trace = buildTrace('s1', updates);
    expect(trace.turns).toHaveLength(2);
    expect(trace.turns[0]).toMatchObject({ kind: 'user', text: 'fix the build' });
    expect(trace.turns[1]).toMatchObject({ kind: 'agent', text: 'On it.' });
  });

  it('pairs a tool_call with its later update and times it', () => {
    const updates: AcpSessionUpdate[] = [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'toolu_1',
        title: 'Edit file',
        kind: 'edit',
        status: 'pending',
        _meta: ts('2026-08-30T07:51:00.000Z'),
      } as AcpSessionUpdate,
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'toolu_1',
        status: 'completed',
        content: [{ type: 'diff', path: '/a/README.md', oldText: 'a', newText: 'b' }],
        _meta: ts('2026-08-30T07:51:02.500Z'),
      } as AcpSessionUpdate,
    ];
    const trace = buildTrace('s1', updates);
    const turn = trace.turns[0];
    expect(turn?.kind).toBe('agent');
    if (turn?.kind !== 'agent') throw new Error('expected agent turn');
    expect(turn.tools[0]).toMatchObject({ id: 'toolu_1', kind: 'edit', status: 'completed', durationMs: 2500 });
    expect(turn.tools[0]?.content[0]).toMatchObject({ type: 'diff', path: '/a/README.md' });
  });

  it('drops an update for a call it never saw start', () => {
    const trace = buildTrace('s1', [
      { sessionUpdate: 'tool_call_update', toolCallId: 'ghost', status: 'completed' } as AcpSessionUpdate,
    ]);
    expect(traceSummary(trace).tools).toBe(0);
  });

  it('ignores update kinds that are not part of the trace', () => {
    const trace = buildTrace('s1', [
      { sessionUpdate: 'config_option_update', configOptions: [] } as unknown as AcpSessionUpdate,
      { sessionUpdate: 'session_info_update', title: 'Greeting' },
    ]);
    expect(trace.title).toBe('Greeting');
    expect(trace.turns).toHaveLength(0);
  });
});
