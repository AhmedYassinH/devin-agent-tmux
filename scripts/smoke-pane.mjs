import { WebSocket } from 'ws';
const ws = new WebSocket('ws://127.0.0.1:5177/pty');
const seen = { data: 0, status: [], session: null, health: null, raw: '' };
const CWD = '/private/tmp/claude-501/-Users-ashoknaik-devin-agent-tmux/e245026c-530c-4619-b7a0-b4a043614679/scratchpad/devtest';
let trusted = false;

ws.on('open', () => {
  ws.send(JSON.stringify({
    t: 'pane:spawn', paneId: 'pane-e2e', cwd: CWD, cols: 100, rows: 30,
    permissionMode: 'auto', prompt: 'Reply with exactly: PONG',
  }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === 'pane:data') {
    seen.data += m.data.length;
    seen.raw += m.data;
    // Answer the workspace-trust prompt the way a user would.
    if (!trusted && seen.raw.includes('Do you trust the authors')) {
      trusted = true;
      setTimeout(() => ws.send(JSON.stringify({ t: 'pane:input', paneId: 'pane-e2e', data: '1\r' })), 400);
    }
  }
  if (m.t === 'pane:status') seen.status.push(m.status);
  if (m.t === 'pane:session') seen.session = m.devinSessionId;
  if (m.t === 'pane:health') seen.health = m.health;
});
setTimeout(() => {
  console.log('bytes of pty output :', seen.data);
  console.log('trust prompt answered:', trusted);
  console.log('status signals      :', JSON.stringify(seen.status));
  console.log('devin session id    :', seen.session);
  console.log('context health      :', seen.health
    ? `~${Math.round(seen.health.pct*100)}% of ${seen.health.windowMax} (${seen.health.model}) | cumulative ${seen.health.totalPromptTokens}p/${seen.health.totalCompletionTokens}c`
    : 'none yet');
  ws.send(JSON.stringify({ t: 'pane:kill', paneId: 'pane-e2e' }));
  setTimeout(() => process.exit(0), 500);
}, 70000);
