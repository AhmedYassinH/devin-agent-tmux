import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS, composeSessionConfig, devinStatusHooks, hookScriptSource } from './hooks.js';

describe('devinStatusHooks', () => {
  it('binds every lifecycle event we rely on', () => {
    const hooks = devinStatusHooks('/tmp/hook.mjs');
    for (const { event } of HOOK_EVENTS) expect(hooks[event]).toBeDefined();
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.Stop).toBeDefined();
  });

  it('quotes the script path so a spaced path still runs', () => {
    const hooks = devinStatusHooks('/Users/a b/hook.mjs');
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toBe('node "/Users/a b/hook.mjs" idle');
  });
});

describe('hookScriptSource', () => {
  const src = hookScriptSource();

  it('settles a freshly started session to idle', () => {
    // Regression: a pane that is launched and never prompted emits no Stop
    // event, so without a status here its badge stayed stuck on the optimistic
    // "running" forever.
    expect(src).toContain('pane;status;idle');
  });

  it('still reports the session id, which closes the missing --session-id', () => {
    expect(src).toContain('pane;session;');
    expect(src).toContain('session_id');
  });

  it('writes to /dev/tty, never stdout', () => {
    // Devin parses hook stdout as structured hook output; escapes there would be
    // swallowed or misread as a directive.
    expect(src).toContain('/dev/tty');
  });

  it('always exits 0 so a hook can never block the agent', () => {
    expect(src).toContain('process.exit(0)');
  });
});

describe('composeSessionConfig', () => {
  it('preserves the user config, because --config REPLACES it', () => {
    // Losing org_id here would launch the pane unauthenticated.
    const user = { devin: { org_id: 'org-123' }, agent: { model: 'opus' } };
    const merged = composeSessionConfig(user, devinStatusHooks('/tmp/h.mjs'));
    expect(merged.devin).toEqual({ org_id: 'org-123' });
    expect(merged.agent).toEqual({ model: 'opus' });
  });

  it('appends to the user’s own hooks rather than replacing them', () => {
    const user = { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'mine.sh' }] }] } };
    const merged = composeSessionConfig(user, devinStatusHooks('/tmp/h.mjs'));
    const stop = (merged.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
    // Theirs runs first: a user hook that blocks an action must not be preempted.
    expect(JSON.stringify(stop?.[0])).toContain('mine.sh');
  });

  it('degrades to hooks-only on an unreadable user config', () => {
    const merged = composeSessionConfig('not json', devinStatusHooks('/tmp/h.mjs'));
    expect(merged.hooks).toBeDefined();
  });
});
