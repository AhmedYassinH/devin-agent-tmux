import { describe, expect, it } from 'vitest';
import {
  CONTEXT_MCP_NAME,
  CONTEXT_MCP_URL,
  composeMcpConfig,
  contextMcpServer,
} from './mcp.js';

const KEY = 'ctxt_secret_test';

describe('contextMcpServer', () => {
  it('carries the key in an Authorization header, never in the URL', () => {
    // context.dev's own server instructions call this out: an API key in a URL
    // ends up in logs, referrers and shell history; a header does not.
    const entry = contextMcpServer(KEY);
    expect(entry.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(entry.url).toBe(CONTEXT_MCP_URL);
    expect(entry.url).not.toContain(KEY);
  });

  it('declares the http transport devin parses', () => {
    expect(contextMcpServer(KEY).type).toBe('http');
  });
});

describe('composeMcpConfig', () => {
  it('adds context to an empty or missing config', () => {
    const result = composeMcpConfig(null, KEY);
    expect(result.action).toBe('added');
    expect(result.config.mcpServers[CONTEXT_MCP_NAME]).toEqual(contextMcpServer(KEY));
  });

  it("leaves the user's own servers alone", () => {
    const existing = {
      mcpServers: {
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp'] },
      },
    };
    const result = composeMcpConfig(existing, KEY);
    expect(result.config.mcpServers.playwright).toEqual(existing.mcpServers.playwright);
    expect(result.config.mcpServers[CONTEXT_MCP_NAME]).toBeDefined();
  });

  it('carries through unrelated top-level keys', () => {
    const result = composeMcpConfig({ mcpServers: {}, somethingElse: 1 }, KEY);
    expect(result.config.somethingElse).toBe(1);
  });

  it('reports unchanged when our entry is already exactly right', () => {
    // This is the common case — it runs before every spawn, and rewriting a
    // file containing a credential for no reason is worth avoiding.
    const first = composeMcpConfig(null, KEY);
    const second = composeMcpConfig(first.config, KEY);
    expect(second.action).toBe('unchanged');
  });

  it('updates our own entry when the key rotates', () => {
    const first = composeMcpConfig(null, 'old_key');
    const second = composeMcpConfig(first.config, 'new_key');
    expect(second.action).toBe('updated');
    expect(second.config.mcpServers[CONTEXT_MCP_NAME]).toEqual(contextMcpServer('new_key'));
  });

  it('refuses to clobber a hand-configured OAuth entry', () => {
    // Same URL, but no Authorization header: the user ran `devin mcp login
    // context` and holds an OAuth token. Overwriting it with an API key would
    // swap a working credential for a different one, silently.
    const existing = { mcpServers: { [CONTEXT_MCP_NAME]: { url: CONTEXT_MCP_URL } } };
    const result = composeMcpConfig(existing, KEY);
    expect(result.action).toBe('skipped');
    expect(result.reason).toBeTruthy();
    expect(result.config.mcpServers[CONTEXT_MCP_NAME]).toEqual(existing.mcpServers[CONTEXT_MCP_NAME]);
  });

  it('refuses to clobber an unrelated server that happens to be named context', () => {
    const existing = { mcpServers: { [CONTEXT_MCP_NAME]: { command: 'my-own-server' } } };
    const result = composeMcpConfig(existing, KEY);
    expect(result.action).toBe('skipped');
    expect(result.config.mcpServers[CONTEXT_MCP_NAME]).toEqual({ command: 'my-own-server' });
  });

  it('does not mutate the config it was given', () => {
    const existing = { mcpServers: { playwright: { command: 'npx' } } };
    composeMcpConfig(existing, KEY);
    expect(Object.keys(existing.mcpServers)).toEqual(['playwright']);
  });
});
