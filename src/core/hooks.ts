/**
 * Devin hook config for pane status.
 *
 * Chorus injected Claude Code's status hooks with `claude --settings <path>`,
 * where the settings file was ADDITIVE. Devin's nearest equivalent, `--config
 * <path>`, is not: it REPLACES the user config at ~/.config/devin/config.json.
 * Pointing it at a hooks-only file would silently strip the user's org_id,
 * default model and permission allowlist — the pane would launch unauthenticated.
 *
 * So the per-pane config is the user's own config with our hooks merged in, and
 * the merge is careful: if the user already defines hooks for an event, ours are
 * APPENDED to theirs rather than replacing them.
 *
 * Events chosen (Devin's set is a superset of Claude Code's):
 *   SessionStart      -> report Devin's chosen session id AND settle the badge to
 *                        idle. Both, from one hook: a freshly launched pane that
 *                        is never prompted produces no Stop event, so without the
 *                        status half the badge stays stuck on its optimistic
 *                        "running" forever.
 *   UserPromptSubmit  -> running
 *   Stop              -> idle
 *   PermissionRequest -> waiting   (the badge the user actually acts on)
 *   PostToolUse       -> running   (return to running once a grant is answered)
 *   SessionEnd        -> exited
 */

export interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}
export interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}
export type HooksConfig = Record<string, HookMatcher[]>;

/**
 * Devin's tools that BLOCK on a human answer.
 *
 * `matcher` is a regex over the hook event's `tool_name`, so these are anchored
 * to avoid matching a longer name that merely contains one of them.
 *
 * This is the second, easily-missed half of "the agent needs you". A permission
 * request is not the only way an agent stops: it can also ask a question
 * (`ask_user_question` — "which colour theme?") or put a plan up for approval
 * (`exit_plan_mode`). Neither raises `PermissionRequest`, because neither is a
 * permission decision — they are ordinary tool calls that happen to wait on a
 * person. Binding only `PermissionRequest` left a card sitting in In Progress
 * with a question on screen and nothing signalling it.
 */
export const BLOCKING_TOOLS = ['ask_user_question', 'exit_plan_mode'] as const;
export const BLOCKING_TOOL_MATCHER = `^(${BLOCKING_TOOLS.join('|')})$`;

/**
 * Events we bind, the argument our hook script receives, and the tool-name
 * regex that scopes it. An empty matcher matches every tool name, which is what
 * Devin's docs specify and what all the non-tool events want.
 */
export const HOOK_EVENTS: { event: string; arg: string; matcher: string }[] = [
  { event: 'SessionStart', arg: 'session', matcher: '' },
  { event: 'UserPromptSubmit', arg: 'running', matcher: '' },
  { event: 'Stop', arg: 'idle', matcher: '' },
  { event: 'PermissionRequest', arg: 'waiting', matcher: '' },
  // The agent is about to block on a human. PostToolUse below returns it to
  // running once the answer lands, because the tool only completes when it does.
  { event: 'PreToolUse', arg: 'waiting', matcher: BLOCKING_TOOL_MATCHER },
  { event: 'PostToolUse', arg: 'running', matcher: '' },
  { event: 'SessionEnd', arg: 'exited', matcher: '' },
];

/**
 * Build the hooks block. `scriptPath` is our OSC emitter; it is invoked with the
 * signal name and reads the hook payload (which always carries `session_id`) on
 * stdin.
 *
 * The timeout is deliberately small: a hook sits on the agent's critical path,
 * and this one only writes a few bytes to /dev/tty. If it ever hangs, we would
 * rather lose a status update than stall the agent.
 */
export function devinStatusHooks(scriptPath: string): HooksConfig {
  const config: HooksConfig = {};
  for (const { event, arg, matcher } of HOOK_EVENTS) {
    const entry: HookMatcher = {
      matcher,
      hooks: [{ type: 'command', command: `node ${JSON.stringify(scriptPath)} ${arg}`, timeout: 5 }],
    };
    // Append rather than assign: two of our own bindings can share an event
    // (PreToolUse and PostToolUse are distinct, but this keeps the loop honest
    // if a future signal needs a second matcher on an event already bound).
    config[event] = [...(config[event] ?? []), entry];
  }
  return config;
}

/** Shallow-object guard — anything else means "the user config is unusable". */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The user's config with our hooks merged in, non-destructively.
 *
 * A corrupt or unreadable user config degrades to "our hooks only" rather than
 * throwing: a pane with no auth config fails loudly at the Devin prompt, which
 * is a better failure than a pane that never launches.
 */
export function composeSessionConfig(userConfig: unknown, hooks: HooksConfig): Record<string, unknown> {
  const base: Record<string, unknown> = isRecord(userConfig) ? { ...userConfig } : {};
  const existing = isRecord(base.hooks) ? (base.hooks as HooksConfig) : {};

  const merged: HooksConfig = { ...existing };
  for (const [event, matchers] of Object.entries(hooks)) {
    const prior = Array.isArray(existing[event]) ? existing[event] : [];
    // Ours go last so a user hook that blocks an action still runs first.
    merged[event] = [...prior, ...matchers];
  }

  base.hooks = merged;
  return base;
}

/**
 * Source of the Node script the hooks invoke. Written once per profile.
 *
 * It writes to /dev/tty rather than stdout: hook stdout is parsed by Devin as
 * structured hook output (a JSON object can inject context or block a tool), so
 * emitting escapes there would at best be swallowed and at worst be misread.
 * /dev/tty is the pane's PTY because the hook is a descendant of the `devin`
 * process we spawned into that PTY.
 */
export function hookScriptSource(): string {
  return `#!/usr/bin/env node
// Generated by devin-agent-tmux. Emits OSC-777 to the pane's PTY.
// Usage: node hook.mjs <session|running|idle|waiting|exited>
import { openSync, writeSync, closeSync } from 'node:fs';

const signal = process.argv[2];
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let seq;
  if (signal === 'session') {
    let id;
    try { id = JSON.parse(raw).session_id; } catch { /* unparseable payload */ }
    // The session has started and is sitting at its prompt: that is idle. Emit it
    // even when the id is unreadable, because the badge matters more than the id.
    seq = '\\x1b]777;pane;status;idle\\x07';
    if (id) seq += '\\x1b]777;pane;session;' + id + '\\x07';
  } else {
    seq = '\\x1b]777;pane;status;' + signal + '\\x07';
  }
  try {
    const fd = openSync('/dev/tty', 'w');
    writeSync(fd, seq);
    closeSync(fd);
  } catch { /* no controlling terminal (headless run) — status simply won't update */ }
  done();
});
// Never block the agent: exit 0 no matter what happened above.
function done() { process.exit(0); }
`;
}
