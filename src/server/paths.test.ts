import { describe, expect, it } from 'vitest';
import { resolveCwd } from './paths.js';

const HOME = '/Users/example';

describe('resolveCwd', () => {
  it('expands a bare tilde', () => {
    // Regression: a workspace stored cwd "~" spawned a pane that died instantly
    // with `exit code 1` and no output, because `~` is shell syntax, not a path.
    expect(resolveCwd('~', HOME)).toBe(HOME);
  });

  it('expands a tilde prefix', () => {
    expect(resolveCwd('~/projects/app', HOME)).toBe('/Users/example/projects/app');
  });

  it('leaves absolute paths alone', () => {
    expect(resolveCwd('/tmp/work', HOME)).toBe('/tmp/work');
  });

  it('does not rewrite a tilde that is not the leading segment', () => {
    // A directory genuinely named `~`.
    expect(resolveCwd('/tmp/~/x', HOME)).toBe('/tmp/~/x');
  });

  it('trims surrounding whitespace from a pasted path', () => {
    expect(resolveCwd('  /tmp/work  ', HOME)).toBe('/tmp/work');
  });
});
