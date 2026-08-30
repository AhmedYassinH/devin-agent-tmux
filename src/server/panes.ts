/**
 * Pane supervisor — the PTY half. One `devin` TUI per pane, exactly as the user
 * would run it in a terminal, with two additions the app needs:
 *
 *   --config <merged>   our status hooks, merged into the user's own config
 *   --export <path>     the live transcript context-health reads
 *
 * Everything else about the session is Devin's own UX: slash commands, the
 * permission dialog, /model. That is the whole point of keeping panes on a PTY
 * rather than driving them over ACP.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { IPty } from 'node-pty';
import { spawn as ptySpawn } from 'node-pty';
import { buildDevinLaunch, shellLaunchArgs } from '../core/launch.js';
import { composeSessionConfig, devinStatusHooks, hookScriptSource } from '../core/hooks.js';
import { OscScanner, type OscSignal } from '../core/osc.js';
import type { DevinPermissionMode } from '../core/models.js';
import { resolveContextApiKey } from '../core/mcp.js';
import { buildPaneConfigDir, readUserMcpConfig, userDevinDir } from './devin-config-dir.js';
import type { FileStore } from './store.js';
import { resolveCwd } from './paths.js';

const isWindows = platform() === 'win32';

export interface SpawnOptions {
  paneId: string;
  cwd: string;
  cols: number;
  rows: number;
  model?: string;
  permissionMode: DevinPermissionMode;
  prompt?: string;
  resumeSessionId?: string;
  /** Launch a plain shell instead of devin — the escape hatch pane. */
  shellOnly?: boolean;
  /** The owning workspace's context.dev key; falls back to CONTEXT_DEV_API_KEY. */
  contextApiKey?: string;
}

export interface PaneHandle {
  paneId: string;
  pty: IPty;
  exportPath?: string;
}

type OnData = (paneId: string, data: string) => void;
type OnSignal = (paneId: string, signal: OscSignal) => void;
type OnExit = (paneId: string, code: number) => void;

/** Where devin keeps the user's own config — the base we merge hooks into. */
function userConfigPath(): string {
  return process.env.DEVIN_CONFIG || join(userDevinDir(), 'config.json');
}

export class PaneSupervisor {
  private panes = new Map<string, PaneHandle>();
  private scanners = new Map<string, OscScanner>();

  constructor(
    private store: FileStore,
    private handlers: { onData: OnData; onSignal: OnSignal; onExit: OnExit },
  ) {}

  /**
   * Build the per-pane devin config directory.
   *
   * Two things have to be per-pane, and they need two different mechanisms:
   *
   *   hooks -> `--config`, which REPLACES the user config rather than layering
   *     onto it. So the merge must start from the user's own file or the pane
   *     launches without their org_id, model default and permission allowlist.
   *   MCP   -> `XDG_CONFIG_HOME`, because `--config` does not carry MCP servers
   *     at all. See devin-config-dir.ts and core/mcp.ts.
   *
   * A missing or corrupt user config degrades to hooks-only, which fails
   * visibly at the Devin prompt instead of silently.
   */
  private writePaneConfig(paneId: string, contextApiKey?: string) {
    const scriptPath = this.store.ensureHookScript(hookScriptSource());
    let userConfig: unknown = null;
    try {
      userConfig = JSON.parse(readFileSync(userConfigPath(), 'utf8'));
    } catch {
      console.warn('[panes] no readable devin user config; launching with hooks only');
    }
    const sessionConfig = composeSessionConfig(userConfig, devinStatusHooks(scriptPath));

    const dir = this.store.paneDir(paneId);
    mkdirSync(dir, { recursive: true });

    return buildPaneConfigDir(dir, {
      sessionConfig,
      // The workspace's key, or the .env default that makes context.dev a
      // default rather than something each workspace opts into.
      contextApiKey: resolveContextApiKey(contextApiKey, process.env.CONTEXT_DEV_API_KEY),
      userMcpConfig: readUserMcpConfig(),
    });
  }

  /**
   * Launch a pane. Returns null when the directory is unusable — the caller has
   * nothing to supervise, and the pane has already been told why.
   */
  spawn(opts: SpawnOptions): PaneHandle | null {
    this.kill(opts.paneId);

    // Validate BEFORE spawning. node-pty reports a bad cwd as a bare exit code 1
    // with no output, which is indistinguishable from `devin` itself crashing.
    const cwd = resolveCwd(opts.cwd, homedir());
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
      this.handlers.onData(
        opts.paneId,
        `\r\n\x1b[1;31mCannot start here.\x1b[0m\r\n` +
          `  \x1b[2mworking directory:\x1b[0m ${opts.cwd}\r\n` +
          `  \x1b[2mresolved to:\x1b[0m       ${cwd || '(empty)'}\r\n\r\n` +
          `  That is not an existing directory. Close this pane and relaunch with\r\n` +
          `  an absolute path (e.g. ${homedir()}/projects/my-repo).\r\n`,
      );
      this.handlers.onExit(opts.paneId, 1);
      return null;
    }

    let command: string | undefined;
    let exportPath: string | undefined;
    let xdgHome: string | undefined;

    if (!opts.shellOnly) {
      // Every session starts with context.dev, keyed by its workspace. This
      // cannot ride along in the --config file: devin reads MCP servers from
      // dedicated mcp_config.json files and ignores an mcpServers key in the
      // config it is handed. See devin-config-dir.ts.
      const paneConfig = this.writePaneConfig(opts.paneId, opts.contextApiKey);
      xdgHome = paneConfig.xdgHome;

      exportPath = join(this.store.paneDir(opts.paneId), 'export.json');
      command = buildDevinLaunch({
        configPath: paneConfig.configPath,
        exportPath,
        model: opts.model,
        permissionMode: opts.permissionMode,
        prompt: opts.prompt,
        resumeSessionId: opts.resumeSessionId,
      });
    }

    const shell = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
    const pty = ptySpawn(shell, shellLaunchArgs(command, isWindows), {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        // Points devin at the pane's own config directory, which is a shadow of
        // ~/.config with devin/mcp_config.json generated for this workspace's
        // key. Set for the pane rather than the server so two workspaces can run
        // side by side on different keys. Credentials live under XDG_DATA_HOME
        // and are untouched, so the session stays authenticated — verified.
        ...(xdgHome ? { XDG_CONFIG_HOME: xdgHome } : {}),
      } as Record<string, string>,
    });

    const scanner = new OscScanner();
    this.scanners.set(opts.paneId, scanner);

    pty.onData((data) => {
      // Strip our OSC-777 before the bytes reach xterm, so status signalling is
      // never visible in the pane.
      const { output, signals } = scanner.push(data);
      for (const signal of signals) this.handlers.onSignal(opts.paneId, signal);
      if (output) this.handlers.onData(opts.paneId, output);
    });
    pty.onExit(({ exitCode }) => {
      this.panes.delete(opts.paneId);
      this.scanners.delete(opts.paneId);
      this.handlers.onExit(opts.paneId, exitCode);
    });

    const handle: PaneHandle = { paneId: opts.paneId, pty, exportPath };
    this.panes.set(opts.paneId, handle);
    return handle;
  }

  write(paneId: string, data: string): void {
    this.panes.get(paneId)?.pty.write(data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    try {
      this.panes.get(paneId)?.pty.resize(cols, rows);
    } catch {
      // A resize racing an exit is expected, not an error worth surfacing.
    }
  }

  kill(paneId: string): void {
    const handle = this.panes.get(paneId);
    if (!handle) return;
    this.panes.delete(paneId);
    this.scanners.delete(paneId);
    try {
      handle.pty.kill();
    } catch {
      /* already gone */
    }
  }

  exportPathFor(paneId: string): string | undefined {
    return this.panes.get(paneId)?.exportPath;
  }

  has(paneId: string): boolean {
    return this.panes.has(paneId);
  }

  /** Kill every pane — the server is going away, no orphan devin processes. */
  killAll(): void {
    for (const id of [...this.panes.keys()]) this.kill(id);
  }
}
