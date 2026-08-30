import { describe, expect, it } from 'vitest';
import { OscScanner, formatSessionOsc, formatStatusOsc, parseOscPayload } from './osc.js';

describe('parseOscPayload', () => {
  it('reads a status', () => {
    expect(parseOscPayload('pane;status;waiting')).toEqual({ kind: 'status', status: 'waiting' });
  });
  it('reads a devin session id', () => {
    expect(parseOscPayload('pane;session;lofty-utahraptor')).toEqual({
      kind: 'session',
      devinSessionId: 'lofty-utahraptor',
    });
  });
  it('rejects an unknown status and a wrong namespace', () => {
    expect(parseOscPayload('pane;status;bogus')).toBeNull();
    expect(parseOscPayload('other;status;idle')).toBeNull();
  });
});

describe('OscScanner', () => {
  it('strips sequences and passes other bytes through', () => {
    const s = new OscScanner();
    const r = s.push(`before${formatStatusOsc('running')}after`);
    expect(r.output).toBe('beforeafter');
    expect(r.signals).toEqual([{ kind: 'status', status: 'running' }]);
  });

  it('reassembles a sequence split across chunks', () => {
    const s = new OscScanner();
    const seq = formatSessionOsc('lofty-utahraptor');
    const a = s.push(`x${seq.slice(0, 10)}`);
    expect(a.output).toBe('x');
    expect(a.signals).toEqual([]);
    const b = s.push(`${seq.slice(10)}y`);
    expect(b.output).toBe('y');
    expect(b.signals).toEqual([{ kind: 'session', devinSessionId: 'lofty-utahraptor' }]);
  });

  it('leaves unrelated OSC sequences intact', () => {
    const s = new OscScanner();
    const r = s.push('\x1b]0;window title\x07hello');
    expect(r.output).toBe('\x1b]0;window title\x07hello');
    expect(r.signals).toEqual([]);
  });
});
