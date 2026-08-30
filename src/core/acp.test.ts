import { describe, expect, it } from 'vitest';
import { describeAcpError } from './acp.js';

/** The exact payload that used to be dumped into the trace panel as red JSON. */
const LOCKED = {
  code: -32015,
  message: "Session 'lofty-utahraptor' is already open in another process. Close the other instance before opening it here.",
  data: { 'cognition.ai/errorKind': 'session_locked', 'cognition.ai/retryable': true },
};

describe('describeAcpError', () => {
  it('classifies a locked session by its namespaced errorKind', () => {
    expect(describeAcpError(LOCKED).kind).toBe('locked');
  });

  it('never leaks raw JSON into the message', () => {
    const { message } = describeAcpError(LOCKED);
    expect(message).not.toContain('cognition.ai/errorKind');
    expect(message).not.toContain('{');
    expect(message).not.toContain('-32015');
  });

  it('explains the one-holder lock rather than restating the code', () => {
    expect(describeAcpError(LOCKED).message).toMatch(/one holder at a time/i);
  });

  it('falls back to the numeric code when data is absent', () => {
    expect(describeAcpError({ code: -32015, message: 'locked' }).kind).toBe('locked');
  });

  it('recognises a missing session', () => {
    expect(describeAcpError({ code: -32602, message: 'Session not found' }).kind).toBe('not-found');
  });

  it("keeps the server's own sentence for anything unrecognised", () => {
    const f = describeAcpError({ code: -1, message: 'disk on fire' });
    expect(f.kind).toBe('unknown');
    expect(f.message).toBe('disk on fire');
  });

  it('degrades to a sentence when handed nothing usable', () => {
    for (const input of [null, undefined, 'nope', {}]) {
      const f = describeAcpError(input);
      expect(f.kind).toBe('unknown');
      expect(f.message.length).toBeGreaterThan(0);
    }
  });
});
