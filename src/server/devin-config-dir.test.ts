/**
 * The per-pane config directory is the riskiest piece of the MCP wiring: it
 * redirects XDG_CONFIG_HOME, which is a variable every tool reads, so the tests
 * below are mostly about what it must NOT hide from the pane.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTEXT_MCP_NAME, CONTEXT_MCP_URL } from '../core/mcp.js';
import { buildPaneConfigDir } from './devin-config-dir.js';

let root: string;
let fakeConfigHome: string;
let paneDir: string;
const realXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dat-cfg-'));
  fakeConfigHome = join(root, 'config');
  paneDir = join(root, 'pane');
  mkdirSync(join(fakeConfigHome, 'devin', 'skills'), { recursive: true });
  mkdirSync(join(fakeConfigHome, 'git'), { recursive: true });
  writeFileSync(join(fakeConfigHome, 'git', 'config'), '[user]\n');
  mkdirSync(paneDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = fakeConfigHome;
});

afterEach(() => {
  if (realXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = realXdg;
  rmSync(root, { recursive: true, force: true });
});

const build = (contextApiKey?: string, userMcpConfig?: unknown) =>
  buildPaneConfigDir(paneDir, { sessionConfig: { hooks: {} }, contextApiKey, userMcpConfig });

describe('buildPaneConfigDir', () => {
  it('writes context.dev into the pane mcp_config', () => {
    const { xdgHome, contextRegistered } = build('k1');
    expect(contextRegistered).toBe(true);
    const cfg = JSON.parse(readFileSync(join(xdgHome, 'devin', 'mcp_config.json'), 'utf8'));
    expect(cfg.mcpServers[CONTEXT_MCP_NAME].url).toBe(CONTEXT_MCP_URL);
    expect(cfg.mcpServers[CONTEXT_MCP_NAME].headers.Authorization).toBe('Bearer k1');
  });

  it('gives two panes two different keys', () => {
    // The whole reason this exists rather than one global mcp_config.json:
    // per-workspace keys have to be able to run side by side.
    const a = build('key-a');
    const otherPane = join(root, 'pane-b');
    mkdirSync(otherPane, { recursive: true });
    const b = buildPaneConfigDir(otherPane, { sessionConfig: {}, contextApiKey: 'key-b' });

    const read = (x: string) =>
      JSON.parse(readFileSync(join(x, 'devin', 'mcp_config.json'), 'utf8')).mcpServers[CONTEXT_MCP_NAME]
        .headers.Authorization;
    expect(read(a.xdgHome)).toBe('Bearer key-a');
    expect(read(b.xdgHome)).toBe('Bearer key-b');
  });

  it("keeps the user's own MCP servers", () => {
    const { xdgHome } = build('k1', { mcpServers: { playwright: { command: 'npx' } } });
    const cfg = JSON.parse(readFileSync(join(xdgHome, 'devin', 'mcp_config.json'), 'utf8'));
    expect(cfg.mcpServers.playwright).toEqual({ command: 'npx' });
    expect(cfg.mcpServers[CONTEXT_MCP_NAME]).toBeDefined();
  });

  it("does not hide other tools' config behind the redirect", () => {
    // XDG_CONFIG_HOME is not devin's variable. Anything the agent shells out to
    // reads it too, so the pane's dir has to shadow the whole of ~/.config.
    const { xdgHome } = build('k1');
    expect(existsSync(join(xdgHome, 'git', 'config'))).toBe(true);
  });

  it("does not hide the user's devin skills", () => {
    const { xdgHome } = build('k1');
    expect(existsSync(join(xdgHome, 'devin', 'skills'))).toBe(true);
  });

  it('links skills rather than copying them, so edits are picked up live', () => {
    const { xdgHome } = build('k1');
    expect(readlinkSync(join(xdgHome, 'devin', 'skills'))).toBe(join(fakeConfigHome, 'devin', 'skills'));
  });

  it('writes the hooks config where --config will find it', () => {
    const { configPath } = build('k1');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ hooks: {} });
  });

  it('runs without a key rather than registering an empty Bearer token', () => {
    const { xdgHome, contextRegistered } = build(undefined);
    expect(contextRegistered).toBe(false);
    expect(existsSync(join(xdgHome, 'devin', 'mcp_config.json'))).toBe(false);
  });

  it('passes the user mcp config through untouched when we have no key', () => {
    writeFileSync(join(fakeConfigHome, 'devin', 'mcp_config.json'), '{"mcpServers":{"x":{}}}');
    const { xdgHome } = build(undefined);
    const cfg = JSON.parse(readFileSync(join(xdgHome, 'devin', 'mcp_config.json'), 'utf8'));
    expect(cfg.mcpServers.x).toBeDefined();
  });

  it('rebuilds cleanly, leaving no stale entry from a previous spawn', () => {
    build('k1');
    rmSync(join(fakeConfigHome, 'devin', 'skills'), { recursive: true, force: true });
    const { xdgHome } = build('k1');
    expect(existsSync(join(xdgHome, 'devin', 'skills'))).toBe(false);
  });
});
