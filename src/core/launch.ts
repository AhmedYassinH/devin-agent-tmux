/**
 * Build the `devin …` command line for a pane.
 *
 * This is the file the whole port turns on: Chorus built `claude …`, we build
 * `devin …`. The flag sets are close but not congruent, and the gaps are
 * load-bearing:
 *
 *   claude --dangerously-skip-permissions  ->  devin --permission-mode dangerous
 *   claude --model <m>                     ->  devin --model <m>          (same)
 *   claude --resume <uuid>                 ->  devin -r <slug>
 *   claude --settings <path>               ->  devin --config <path>      (see hooks.ts)
 *   claude --session-id <uuid>             ->  NOTHING. See SessionConfig.devinSessionId.
 *   claude --append-system-prompt <s>      ->  NOTHING. Devin uses rules/skills instead.
 *   claude --fork-session                  ->  NOTHING.
 *
 * One Devin-specific trap: bare positional arguments are PATHs that open Devin
 * Desktop (`devin [PATH]... [-- <PROMPT>...]`). A prompt passed positionally
 * without `--` would launch the desktop app instead of prompting the agent, so
 * the `--` separator here is not stylistic — it is required for correctness.
 *
 * Pure and host-agnostic: the caller resolves paths and platform.
 */
import type { DevinPermissionMode } from './models.js';

/** POSIX single-quote escaping (wrap in '…', escape embedded quotes). */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface DevinLaunchConfig {
  /** First-turn prompt. Auto-submits and stays interactive — never `-p`. */
  prompt?: string;
  model?: string;
  permissionMode?: DevinPermissionMode;
  /** `devin -r <id>` — resume an existing session by its slug id. */
  resumeSessionId?: string;
  /** Path to the per-pane config carrying our status hooks (see hooks.ts). */
  configPath?: string;
  /**
   * Path for `--export`. Devin re-exports after every turn, so this file is a
   * live, documented-schema view of the conversation — which is what feeds
   * context-health without touching Devin's internal SQLite store.
   */
  exportPath?: string;
  /**
   * Devin refuses to run non-interactively in an untrusted directory. Panes are
   * interactive so the prompt CAN render, but a fresh clone would block the pane
   * on a trust dialog the user may not expect; callers that have already
   * established trust pass false to skip it.
   */
  respectWorkspaceTrust?: boolean;
}

/** Build the `devin …` command string. */
export function buildDevinLaunch(config: DevinLaunchConfig = {}): string {
  const parts: string[] = ['devin'];

  // --config must precede everything it influences; keep it first for clarity.
  if (config.configPath) parts.push('--config', shellEscape(config.configPath));
  if (config.permissionMode) parts.push('--permission-mode', config.permissionMode);
  if (config.model) parts.push('--model', shellEscape(config.model));
  if (config.exportPath) parts.push('--export', shellEscape(config.exportPath));
  if (config.respectWorkspaceTrust === false) parts.push('--respect-workspace-trust', 'false');
  if (config.resumeSessionId) parts.push('-r', shellEscape(config.resumeSessionId));

  // MUST be last, and MUST be separated by `--`: see the header note on PATHs.
  if (config.prompt) parts.push('--', shellEscape(config.prompt));

  return parts.join(' ');
}

/**
 * argv for running a command through the user's login+interactive shell.
 *
 * The login shell matters more for Devin than it did for Claude: `devin` installs
 * to ~/.local/bin, which is on PATH only via the user's profile. A GUI-spawned
 * or minimal-env server would not find it otherwise. `exec`-style `-c` means no
 * leftover prompt and no echoed command in the pane.
 */
export function shellLaunchArgs(command: string | undefined, isWindows: boolean): string[] {
  if (!command) return [];
  return isWindows ? ['-NoLogo', '-Command', command] : ['-l', '-i', '-c', command];
}
