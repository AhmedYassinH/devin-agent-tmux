/**
 * A minimal `.env` reader.
 *
 * Vite loads `.env` for the browser half, but the server half runs under `tsx`
 * and gets nothing — so `CONTEXT_DEV_API_KEY` would be undefined in the one
 * process that actually needs it. Node's own `--env-file` would work, but it
 * would have to be threaded through every way this server can be started (npm
 * script, smoke test, someone running tsx by hand), and each of those is a
 * place to forget it.
 *
 * Twenty lines here instead of a dependency and four launch-script edits.
 *
 * The file is resolved relative to THIS module rather than to cwd: the smoke
 * tests in scripts/ run from wherever the user happens to be, and a `.env` that
 * loads only when you start the server from the repo root is a trap.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The repo-root `.env`, resolved from this file's location. */
export function defaultEnvPath(): string {
  return fileURLToPath(new URL('../../.env', import.meta.url));
}

/**
 * Load `path` into process.env.
 *
 * A variable already present in the real environment WINS — that is what makes
 * `CONTEXT_DEV_API_KEY=... npm run dev` and CI secrets work, and it matches how
 * every other dotenv loader behaves. A missing file is not an error: running
 * without a key is a supported state (the app just registers no MCP server).
 */
export function loadEnvFile(path = defaultEnvPath()): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes — a Bearer token has no
    // spaces, but a path or a prompt might, and people quote those.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
