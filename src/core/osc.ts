/**
 * Status + identity signalling over a custom OSC escape sequence.
 *
 * Ported from Chorus essentially intact — the mechanism is agent-agnostic, and
 * Devin's hook system emits to the controlling terminal exactly as Claude Code's
 * did, so the bytes travel the same PTY stream as normal output.
 *
 *   OSC code : 777  (namespaced; will not collide with normal output)
 *   status   : ESC ] 777 ; pane ; status  ; <idle|running|waiting|exited> BEL
 *   identity : ESC ] 777 ; pane ; session ; <devin-session-slug>          BEL
 *
 * The `session` payload is the port's addition and it is what closes Devin's
 * missing `--session-id`: we cannot tell Devin which id to use, so the
 * SessionStart hook tells US the id it chose. Same channel, same scanner.
 *
 * Kept as a pure scanner (not an xterm handler) so it is unit-testable against
 * captured byte streams, including sequences split across reads.
 */
import type { PaneStatus } from './models.js';

export const OSC_CODE = 777;
const START = '\x1b]777;';
const BEL = '\x07';
/** One COMPLETE sequence, terminated by BEL or ST (ESC \). */
const OSC_RE = /\x1b\]777;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export type OscSignal =
  | { kind: 'status'; status: PaneStatus }
  | { kind: 'session'; devinSessionId: string };

/** The raw escape a hook prints for a given state. */
export function formatStatusOsc(state: PaneStatus): string {
  return `${START}pane;status;${state}${BEL}`;
}

/** The raw escape the SessionStart hook prints to report Devin's session id. */
export function formatSessionOsc(id: string): string {
  return `${START}pane;session;${id}${BEL}`;
}

/** Parse a payload ("pane;<key>;<value>") into a signal, or null. */
export function parseOscPayload(payload: string): OscSignal | null {
  // Split into exactly 3 — a session slug never contains ';', but being strict
  // about the count is what keeps unrelated OSC-777 traffic from being misread.
  const parts = payload.split(';');
  if (parts.length !== 3) return null;
  const [ns, key, value] = parts;
  if (ns !== 'pane' || !value) return null;
  if (key === 'status') {
    if (value === 'idle' || value === 'running' || value === 'waiting' || value === 'exited') {
      return { kind: 'status', status: value };
    }
    return null;
  }
  if (key === 'session') return { kind: 'session', devinSessionId: value };
  return null;
}

/** Is `tail` (from the last ESC) the start of an as-yet-incomplete OSC-777? */
function isPartialOsc777(tail: string): boolean {
  if (tail.startsWith(START)) return true; // started, no terminator yet
  return START.startsWith(tail); // a prefix of the start marker
}

/**
 * Stateful, surgical scanner. Feed it raw PTY chunks; it returns the chunk with
 * OSC-777 sequences removed plus the signals found. It buffers a trailing
 * partial sequence across chunks and passes ALL other bytes through verbatim —
 * including other OSC sequences, which the terminal still needs.
 */
export class OscScanner {
  private pending = '';

  push(chunk: string): { output: string; signals: OscSignal[] } {
    const buf = this.pending + chunk;
    this.pending = '';

    const signals: OscSignal[] = [];
    let output = '';
    let last = 0;
    OSC_RE.lastIndex = 0;
    for (let m = OSC_RE.exec(buf); m; m = OSC_RE.exec(buf)) {
      output += buf.slice(last, m.index);
      const signal = parseOscPayload(m[1] ?? '');
      if (signal) signals.push(signal);
      last = m.index + m[0].length;
    }

    let rest = buf.slice(last);
    // Hold back a trailing partial sequence so it can complete on the next chunk.
    const esc = rest.lastIndexOf('\x1b');
    if (esc !== -1 && isPartialOsc777(rest.slice(esc))) {
      this.pending = rest.slice(esc);
      rest = rest.slice(0, esc);
    }
    output += rest;
    return { output, signals };
  }
}
