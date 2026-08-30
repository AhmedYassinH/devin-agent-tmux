import { describe, expect, it } from 'vitest';
import { buildDevinLaunch, shellEscape, shellLaunchArgs } from './launch.js';

describe('buildDevinLaunch', () => {
  it('is a bare interactive devin with no config', () => {
    expect(buildDevinLaunch()).toBe('devin');
  });

  it('puts the prompt after `--`', () => {
    // Not stylistic: a bare positional is a PATH that opens Devin Desktop.
    expect(buildDevinLaunch({ prompt: 'fix the build' })).toBe("devin -- 'fix the build'");
  });

  it('maps permission mode to devin vocabulary', () => {
    expect(buildDevinLaunch({ permissionMode: 'dangerous' })).toContain('--permission-mode dangerous');
  });

  it('resumes with -r', () => {
    expect(buildDevinLaunch({ resumeSessionId: 'lofty-utahraptor' })).toBe("devin -r 'lofty-utahraptor'");
  });

  it('orders flags before the prompt separator', () => {
    const cmd = buildDevinLaunch({
      configPath: '/tmp/c.json',
      exportPath: '/tmp/e.json',
      model: 'opus',
      permissionMode: 'smart',
      prompt: 'go',
    });
    expect(cmd).toBe(
      "devin --config '/tmp/c.json' --permission-mode smart --model 'opus' --export '/tmp/e.json' -- 'go'",
    );
    expect(cmd.indexOf('--')).toBeLessThan(cmd.indexOf("'go'"));
  });

  it('escapes quotes in the prompt', () => {
    expect(buildDevinLaunch({ prompt: "it's fine" })).toBe("devin -- 'it'\\''s fine'");
  });
});

describe('shellEscape', () => {
  it('wraps and escapes', () => {
    expect(shellEscape("a'b")).toBe("'a'\\''b'");
  });
});

describe('shellLaunchArgs', () => {
  it('uses a login+interactive shell so ~/.local/bin/devin is on PATH', () => {
    expect(shellLaunchArgs('devin', false)).toEqual(['-l', '-i', '-c', 'devin']);
  });
  it('is empty with no command', () => {
    expect(shellLaunchArgs(undefined, false)).toEqual([]);
  });
});
