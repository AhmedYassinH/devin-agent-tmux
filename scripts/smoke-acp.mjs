#!/usr/bin/env node
/**
 * Smoke test for the ACP history path. Requires the server to be running.
 *
 *   node scripts/smoke-acp.mjs                       # list sessions
 *   node scripts/smoke-acp.mjs <sessionId> <cwd>     # replay one into a trace
 */
import { WebSocket } from 'ws';

const [id, cwd] = process.argv.slice(2);
const ws = new WebSocket('ws://127.0.0.1:5177/pty');

ws.on('open', () => {
  if (id && cwd) ws.send(JSON.stringify({ t: 'trace:load', sessionId: id, cwd, reqId: 'r' }));
  else ws.send(JSON.stringify({ t: 'sessions:list', cwd: process.cwd(), reqId: 'r' }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));

  if (m.t === 'sessions:result') {
    if (m.error) return fail(m.error);
    console.log(`session/list -> ${m.sessions.length} sessions`);
    for (const s of m.sessions.slice(0, 10)) {
      console.log(`  ${s.sessionId}${s.isLocked ? ' [LOCKED]' : ''}  ${(s.title || '').slice(0, 50)}`);
    }
    process.exit(0);
  }

  if (m.t === 'trace:result') {
    if (m.error) return fail(m.error);
    const t = m.trace;
    const tools = t.turns.flatMap((x) => (x.kind === 'agent' ? x.tools : []));
    const byKind = {};
    for (const x of tools) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
    console.log(`trace "${t.title}"`);
    console.log(`  turns           : ${t.turns.length}`);
    console.log(`  tool calls      : ${tools.length}`);
    console.log(`  by kind         : ${JSON.stringify(byKind)}`);
    console.log(`  paired w/ timing: ${tools.filter((x) => x.durationMs !== undefined).length}`);
    console.log(`  structured diffs: ${tools.filter((x) => x.content.some((c) => c.type === 'diff')).length}`);
    process.exit(0);
  }
});

function fail(msg) {
  console.error('error:', msg);
  process.exit(1);
}
setTimeout(() => fail('timed out'), 150000);
