/**
 * Path resolution for user-typed directories.
 *
 * Kept out of panes.ts so it can be unit-tested without loading node-pty, and
 * takes `home` as a parameter so the test does not depend on whose machine it
 * runs on.
 */

/**
 * Resolve a user-typed directory to a real path.
 *
 * `~` is shell syntax, not a path: a process spawned with cwd `~` fails before
 * it runs, and node-pty reports that as a bare exit code 1 with no output. Users
 * type it anyway, so expand it here rather than making every caller remember.
 *
 * Only a LEADING `~` is special. A path like `/tmp/~/x` names a directory that
 * is genuinely called `~`, and rewriting it would be wrong.
 */
export function resolveCwd(input: string, home: string): string {
  const p = input.trim();
  if (p === '~') return home;
  if (p.startsWith('~/')) return `${home}/${p.slice(2)}`;
  return p;
}
