/**
 * The default MCP server every session gets: context.dev.
 *
 * Devin resolves MCP servers from a set of DEDICATED files — it does not read
 * them from the main config. Three facts were established by probing the real
 * binary (3000.6.7), and each one closes off an approach that looks obvious:
 *
 *   1. `--config <path>` does NOT carry MCP servers. An `mcpServers` key inside
 *      the file we pass is ignored, and so is an `mcp_config.json` sitting next
 *      to it. `--config` overrides the main config only. This is why panes.ts
 *      cannot register context.dev the same way it registers our status hooks.
 *   2. `XDG_CONFIG_HOME` DOES relocate the whole devin config directory,
 *      mcp_config.json included — but it relocates the user's skills and their
 *      own servers with it, so pointing panes at a private directory would
 *      silently take away config the user has and we never see.
 *   3. Project scope (`.devin/mcp_config.json`) is found by walking up from the
 *      cwd, and panes launch in the user's own repos. Writing there would mean
 *      dropping files into directories the app does not own.
 *
 * What is left is user scope — `~/.config/devin/mcp_config.json` — which is
 * exactly what `devin mcp add -s user` writes and applies to every session the
 * user starts, in this app or in a plain terminal. That is the guarantee we
 * want, so we take it, and we take it CAREFULLY: the merge below is additive,
 * touches one named key, and refuses to overwrite an entry it did not write.
 *
 * The entry shape is the `.mcp.json` form (`type: "http"`) rather than Devin's
 * native `transport: "http"`. Both parse — verified against `devin mcp get` —
 * and this is the form the key was issued against.
 */

/**
 * Where the key comes from.
 *
 * A workspace carries its own key, collected when it is created, so two
 * workspaces can bill to two different context.dev accounts. `.env` supplies
 * the fallback that makes the server a DEFAULT rather than an opt-in: a user
 * who never fills the field still gets context.dev in every pane.
 *
 * Blank-but-present is treated as absent — an empty field in the create dialog
 * means "use the default", not "register a server with an empty Bearer token",
 * which would fail at the first tool call with an opaque auth error.
 */
export function resolveContextApiKey(workspaceKey?: string, fallback?: string): string | undefined {
  return workspaceKey?.trim() || fallback?.trim() || undefined;
}

/** A remote MCP server over Streamable HTTP. */
export interface McpHttpServer {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

/** Any server entry — ours is HTTP, the user's may be stdio or anything else. */
export type McpServerEntry = McpHttpServer | Record<string, unknown>;

export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
  /** Anything else in the user's file is carried through untouched. */
  [key: string]: unknown;
}

export const CONTEXT_MCP_NAME = 'context';
export const CONTEXT_MCP_URL = 'https://mcp.context.dev/mcp';

/**
 * The context.dev entry.
 *
 * The key travels in an `Authorization: Bearer` header, never in the URL —
 * context.dev's own server instructions call that out explicitly, and a URL is
 * logged in far more places than a header is.
 */
export function contextMcpServer(apiKey: string): McpHttpServer {
  return {
    type: 'http',
    url: CONTEXT_MCP_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

/**
 * What a merge did, so the caller can decide whether to write and what to log.
 *
 * `unchanged` exists so the common case is a no-op: this runs before every
 * pane spawn, and rewriting a file in the user's home on every launch — with a
 * credential in it — is not something to do for no reason.
 */
export type McpMergeAction = 'added' | 'updated' | 'unchanged' | 'skipped';

export interface McpMergeResult {
  action: McpMergeAction;
  config: McpConfigFile;
  /** Set when action is 'skipped' — why we left the user's entry alone. */
  reason?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * True when an existing `context` entry is one WE could have written: an HTTP
 * server pointed at context.dev that authenticates with a static header.
 *
 * The header check is the part that matters. A user who configured context.dev
 * through OAuth (`devin mcp login context`) has no Authorization header, and
 * overwriting that entry with an API key would silently swap out a working
 * credential for a different one. Same URL is not enough to claim ownership.
 */
function isOurEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (entry.url !== CONTEXT_MCP_URL) return false;
  const headers = entry.headers;
  return isRecord(headers) && typeof headers.Authorization === 'string';
}

/**
 * The user's MCP config with context.dev merged in, non-destructively.
 *
 * A corrupt or unreadable file degrades to "our server only" rather than
 * throwing — but note the asymmetry with composeSessionConfig in hooks.ts,
 * which merges into a file we then hand to ONE pane. This one writes back to
 * the user's own config, so an unparseable file is reported by the caller
 * rather than quietly replaced.
 */
export function composeMcpConfig(existing: unknown, apiKey: string): McpMergeResult {
  const base: McpConfigFile = isRecord(existing)
    ? ({ ...existing } as McpConfigFile)
    : { mcpServers: {} };

  const servers = isRecord(base.mcpServers) ? { ...base.mcpServers } : {};
  const prior = servers[CONTEXT_MCP_NAME];
  const next = contextMcpServer(apiKey);

  if (prior !== undefined && !isOurEntry(prior)) {
    return {
      action: 'skipped',
      config: { ...base, mcpServers: servers },
      reason: `an MCP server named "${CONTEXT_MCP_NAME}" is already configured by hand`,
    };
  }

  if (prior !== undefined && JSON.stringify(prior) === JSON.stringify(next)) {
    return { action: 'unchanged', config: { ...base, mcpServers: servers } };
  }

  servers[CONTEXT_MCP_NAME] = next;
  return {
    action: prior === undefined ? 'added' : 'updated',
    config: { ...base, mcpServers: servers },
  };
}
