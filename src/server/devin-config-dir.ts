/**
 * The per-pane Devin config directory.
 *
 * Devin resolves MCP servers from dedicated `mcp_config.json` files and NOT
 * from the file `--config` points at — see core/mcp.ts for the three probes
 * that establish this. So the trick that gives each pane its own status hooks
 * cannot also give each pane its own MCP servers, and a per-workspace
 * context.dev key needs exactly that.
 *
 * What does work is `XDG_CONFIG_HOME`: it relocates Devin's whole config
 * directory, `mcp_config.json` included. Verified end-to-end against the real
 * binary — a session launched this way stays authenticated (credentials live
 * under XDG_DATA_HOME, which we leave alone) and connects to context.dev.
 *
 * The catch is that XDG_CONFIG_HOME is not Devin's variable, it is everyone's.
 * A bare redirect would also move `git`, `gh`, `nvim` and anything else the
 * agent shells out to. So this builds a SHADOW of `~/.config`: every entry
 * symlinked through to the real one, with a real `devin/` directory whose
 * `config.json` and `mcp_config.json` we generate and whose other entries
 * (skills, rules, plugins) are symlinked as well. Nothing the user has is
 * hidden, and symlinks mean a skill added mid-session is picked up live.
 *
 * Rebuilt from scratch on each spawn: it is a few dozen symlinks, and stale
 * entries pointing at deleted config would be a silent, confusing failure.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { composeMcpConfig } from '../core/mcp.js';

/** The real `~/.config` this shadows. */
function realConfigHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return xdg || join(homedir(), '.config');
}

/** Where devin keeps the user's own config — the base we merge into. */
export function userDevinDir(): string {
  return join(realConfigHome(), 'devin');
}

/** Generated per pane; everything else in `devin/` is symlinked through. */
const GENERATED = new Set(['config.json', 'mcp_config.json']);

function linkThrough(from: string, into: string, skip: Set<string> = new Set()): void {
  if (!existsSync(from)) return;
  for (const entry of readdirSync(from)) {
    if (skip.has(entry)) continue;
    try {
      symlinkSync(join(from, entry), join(into, entry));
    } catch {
      // A name we already generated, or an unreadable entry. Skipping one link
      // costs that one piece of config; failing the build costs the pane.
    }
  }
}

export interface PaneConfigDir {
  /** Value for the spawned process's XDG_CONFIG_HOME. */
  xdgHome: string;
  /** The generated config.json, for `--config`. */
  configPath: string;
  /** False when no context.dev key was available — the pane runs without it. */
  contextRegistered: boolean;
}

export interface BuildOptions {
  /** The merged hooks config from composeSessionConfig. */
  sessionConfig: Record<string, unknown>;
  /** The workspace's context.dev key, already resolved against the default. */
  contextApiKey?: string;
  /** The user's own mcp_config.json contents, if any. */
  userMcpConfig?: unknown;
}

/**
 * Build `<paneDir>/xdg` and return what the spawn needs.
 *
 * `--config` is still passed explicitly even though the generated config.json
 * also sits at the XDG path. Belt and braces: `--config` is the mechanism this
 * app has always used and the one the HANDOFF documents, and the two agree by
 * construction because they are the same file.
 */
export function buildPaneConfigDir(paneDir: string, opts: BuildOptions): PaneConfigDir {
  const xdgHome = join(paneDir, 'xdg');
  rmSync(xdgHome, { recursive: true, force: true });
  mkdirSync(xdgHome, { recursive: true });

  const devinDir = join(xdgHome, 'devin');
  mkdirSync(devinDir, { recursive: true });

  // Shadow ~/.config for every OTHER tool, so redirecting XDG_CONFIG_HOME does
  // not quietly change how git or gh resolve their config inside the pane.
  linkThrough(realConfigHome(), xdgHome, new Set(['devin']));
  // Then devin's own directory, minus the two files we generate.
  linkThrough(userDevinDir(), devinDir, GENERATED);

  const configPath = join(devinDir, 'config.json');
  writeFileSync(configPath, `${JSON.stringify(opts.sessionConfig, null, 2)}\n`, 'utf8');

  let contextRegistered = false;
  const key = opts.contextApiKey?.trim();
  if (key) {
    const merged = composeMcpConfig(opts.userMcpConfig, key);
    contextRegistered = merged.action !== 'skipped';
    // 0600: this file holds the API key.
    writeFileSync(join(devinDir, 'mcp_config.json'), `${JSON.stringify(merged.config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } else if (existsSync(join(userDevinDir(), 'mcp_config.json'))) {
    // No key of our own, but the user has servers — link theirs through
    // untouched rather than leaving the pane with no MCP at all.
    try {
      symlinkSync(join(userDevinDir(), 'mcp_config.json'), join(devinDir, 'mcp_config.json'));
    } catch {
      /* best effort */
    }
  }

  return { xdgHome, configPath, contextRegistered };
}

/** Read the user's own mcp_config.json. Null when absent or unparseable. */
export function readUserMcpConfig(): unknown {
  const path = join(userDevinDir(), 'mcp_config.json');
  try {
    if (!lstatSync(path).isFile()) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
