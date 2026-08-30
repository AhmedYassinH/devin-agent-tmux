# Handoff — devin-agent-tmux

Read this first. It records **why** things are the way they are, and the
empirically-verified facts about the Devin CLI that were expensive to discover.
Re-deriving them costs real time; contradicting them will break the app.

**Status:** working v1. 94 tests pass, typecheck clean, production build succeeds,
both halves verified end-to-end against real Devin CLI `3000.6.7`.

**If you are a new agent picking this up: read §10 and §11 first.** They cover the
context.dev MCP integration and the exact state the last session left behind,
including one unresolved risk (§11) that will bite inside this repo specifically.

---

## 1. What this is

A local-first **agent multiplexer for the Devin CLI**, in the browser. Real
`devin` TUIs in resizable xterm panes, with live status badges, session
import/resume, a turn-by-turn trace panel, and context-health estimates.

**Ported from** `/Users/ashoknaik/claude-experiments/tui-bridgespaceclone`
("Chorus") — a Claude-Code multiplexer, npm+turbo monorepo, ~13.4k LOC. That repo
is still on disk and is the reference for anything not yet ported.

**This repo:** ~4k LOC, single package, web-only.

---

## 2. Decisions already made — do not relitigate

These came out of a structured interview. Each was chosen deliberately over
named alternatives.

| Decision | Chosen | Why |
|---|---|---|
| Where agents run | **Local-first web** | `devin`, its auth, your repos and worktrees are all on this machine. Hosted needs per-user containers — bigger than the app. |
| Persistence | **Local file tree + Convex mirror** | Local `~/.devin-agent-tmux/` is the source of truth; Convex is best-effort sync. Offline works; a Convex outage costs sync, not workspaces. |
| v1 scope | Base + import + trace + context health | Swarms/worktrees/voice/bundles deferred. |
| Trace source | **ACP** (`devin acp`), not SQLite | `session/list` + `session/load` are supported API. `sessions.db` is richer but internal and unversioned. |
| Pane model | **Real TUI over PTY**; ACP read-only | ACP is a *driver* protocol — it cannot attach to a session a PTY holds. Driving panes over ACP means reimplementing Devin's client. |
| Live trace | **History-only in v1** | Same lock constraint. Options were designed and deferred, not half-built. |
| Repo shape | **Single package** | The monorepo existed to share UI between web and Electron. Web-only removed its reason to exist. |
| Default MCP | **context.dev, per workspace** | Every pane gets it without being asked. The key is collected when a workspace is created and falls back to `CONTEXT_DEV_API_KEY` in `.env`, so a blank field still gets the server. Per-workspace rather than global because two workspaces may bill to two accounts — and because writing one key into the user's global `mcp_config.json` would change sessions this app did not start. |

**Design language:** **Instrument** — a precision-instrument system, specified in
full in `DESIGN.md` at the repo root, which is authoritative for every colour,
type step, spacing, radius and motion value. Cold graphite surfaces
(`canvas → surface-1 → surface-2 → surface-3`) with depth built from surface
steps and two hairline weights, never from shadow, gradient or glow. One accent —
machined brass `#C8A15A` — used roughly six times per screen and never as
decoration. Three faces, three jobs: Cabinet Grotesk display, IBM Plex Sans body,
IBM Plex Mono for anything measured (readouts, ids, paths, timings). The
signature element is the **readout rule**: a hairline with a mono micro-label
interrupting it flush left and an optional value flush right, used as the section
eyebrow and card header. Dark-first with a designed cold-paper light mode via
`prefers-color-scheme`. Status is carried by a 6px dot **plus a word**, never by
colour alone. Read `DESIGN.md` before editing any UI and use only tokens defined
there.

---

## 3. Verified facts about Devin CLI — the expensive knowledge

All confirmed by probing the real binary, not from docs alone.

### Flag mapping (Claude Code → Devin)

```
--dangerously-skip-permissions  ->  --permission-mode auto|accept-edits|smart|dangerous
--model <m>                     ->  --model <m>            (same)
--resume <uuid>                 ->  -r <slug>
--settings <path>               ->  --config <path>        (SEE WARNING BELOW)
--session-id <uuid>             ->  NOTHING — see §4
--append-system-prompt          ->  NOTHING (Devin uses rules/skills)
--fork-session                  ->  NOTHING
```

### Traps that cost real debugging time

1. **`--config` REPLACES the user config**, it does not layer onto it. Pointing
   it at a hooks-only file strips `org_id`, default model and permissions — the
   pane launches unauthenticated. `composeSessionConfig()` merges our hooks into
   a copy of `~/.config/devin/config.json`. **Do not "simplify" this.**

2. **Bare positional args are PATHs that open Devin Desktop**
   (`devin [PATH]... [-- <PROMPT>...]`). The `--` before a prompt is required for
   correctness, not style.

3. **Transcripts are NOT auto-written.** `~/.local/share/devin/cli/transcripts/`
   only gets a file when `--export` was passed. Verified: session count stayed at
   39 across a real run. We pass `--export` per pane, which is why context-health
   works at all.

4. **`final_metrics` in the export is CUMULATIVE**, not current occupancy. Using
   it directly reports a long session as >100% full. `context-health.ts`
   differentiates across readings instead — read the long comment there before
   touching it.

5. **Sessions are PID-locked, one holder at a time.**
   `session_locks/<id>.lock` holds a PID; stale locks persist after exit (97 locks
   for 47 sessions). ACP reports this as `_meta["cognition.ai/isLocked"]`. A live
   pane's session **cannot** be replayed — this is why trace is history-only.

6. **A fresh/untrusted directory shows a trust prompt** and no hooks fire until
   it is answered. Pre-trust demo repos or the first badge looks broken.

7. **`~` is shell syntax, not a path.** A process spawned with `cwd: '~'` dies
   instantly with a bare `exit code 1` and no output. `src/server/paths.ts`
   expands it; bad dirs are caught before spawn and reported into the pane.

8. **node-pty's `spawn-helper` ships at 644** — npm strips the exec bit, and every
   PTY spawn fails with `posix_spawnp failed`. `scripts/fix-node-pty.mjs` runs on
   postinstall. Do not remove it.

9. **`--config` does NOT carry MCP servers.** This one closes off the obvious
   approach, so it is worth stating flatly. All three probed against 3000.6.7:

   - an `mcpServers` key **inside** the file `--config` points at → ignored
   - an `mcp_config.json` sitting **next to** that file → ignored
   - `XDG_CONFIG_HOME` → **works**, relocates `mcp_config.json` lookup

   Devin reads MCP servers from dedicated files (`~/.config/devin/mcp_config.json`,
   `.devin/mcp_config.json`, `.devin/mcp_config.local.json`) and `--config`
   overrides only the *main* config. So per-pane hooks and per-pane MCP need two
   different mechanisms — see `server/devin-config-dir.ts`.

   `XDG_CONFIG_HOME` is not Devin's variable, it is everyone's: a bare redirect
   would also move `git`, `gh` and anything else the agent shells out to. The
   pane's dir is therefore a **shadow** of `~/.config` — every entry symlinked
   through, with a real `devin/` whose `config.json` and `mcp_config.json` we
   generate. Credentials live under `XDG_DATA_HOME` and are untouched, which is
   why a redirected session stays authenticated. Verified end-to-end: a pane
   built this way runs as the logged-in user and completes a real context.dev
   tool call.

   Both `{"type":"http"}` (the `.mcp.json` form) and `{"transport":"http"}`
   (Devin's native form) parse. We write the former.

10. **A locked session's ACP error is a wire object, not a message.** Rejecting
    with `JSON.stringify(error)` put raw JSON-RPC in front of the user for what
    is an *expected* state (trap 5). `core/acp.ts:describeAcpError` classifies it;
    the trace panel renders `locked` as an explanation, never as an error.

### ACP capabilities (from a live `initialize` handshake)

```
loadSession: true
sessionCapabilities: { list: {}, delete: {}, additionalDirectories: {} }
promptCapabilities: { image: true, embeddedContext: true }
authMethods: [ devin-browser ]
_meta: multiRootWorkspace, sessionRename, sessionShare, terminalLifecycle,
       userEdits, documentLifecycle, chains, megaplan, editableCommands, ...
```

`session/update` discriminator `update.sessionUpdate` ∈
`user_message_chunk | agent_message_chunk | agent_thought_chunk | tool_call |
tool_call_update | session_info_update | config_option_update`.
Timestamps are in `_meta["cognition.ai/timestamp"]`.

Tool calls arrive as ACP JSON with `kind` (read/edit/execute/search/…) and
structured `{type:"diff", path, oldText, newText}` content — which is why
`trace.ts` is ~170 lines where the Claude-JSONL equivalent was 1135.

### In-pane controls (verified in Devin's own docs)

`Shift+Tab` cycles Normal → Accept Edits → Smart → Bypass → Autonomous.
`/model` switches model. These are why the launcher has no model/prompt/permission
fields — the pane is the real TUI, and duplicating its controls creates two places
to fall out of sync.

---

## 4. The clever bit: closing the missing `--session-id`

Devin generates its own session slug and offers no flag to pin one, so a pane
could launch an agent and never learn which session it created.

**Every Devin hook payload carries a stable `session_id`**, so we invert it: the
`SessionStart` hook echoes the id back over the same OSC-777 channel the status
hooks use. The pane *learns* its id.

```
spawn → devin --config <merged> --export <path>
      → SessionStart hook fires with {"session_id": "..."}
      → hook.mjs writes ESC]777;pane;session;<id>BEL to /dev/tty
      → OscScanner strips the bytes, emits the id → persisted → `devin -r` later
```

`SessionStart` also emits `status;idle` — **this is load-bearing**. A pane that is
launched and never prompted produces no `Stop` event, so without it the badge
stays stuck on its optimistic "running" forever. There is a regression test.

Hooks write to `/dev/tty`, never stdout: Devin parses hook stdout as structured
hook output, so escapes there would be swallowed or misread.

---

## 5. Architecture

```
src/core/     pure logic — no React, no Node, no transport. All unit-tested.
  launch.ts          build `devin …`  (the file the whole port turns on)
  hooks.ts           lifecycle hooks + non-destructive user-config merge
  osc.ts             OSC-777 scanner (status + session identity)
  status.ts          status reducer; hooks outrank the output heuristic
  trace.ts           fold ACP session/update into turns + tool calls
  context-health.ts  occupancy from per-turn export deltas (READ THE COMMENT)
  layout.ts          split tree, templates 1-6, layoutForSessions
  workspace.ts       workspace/session CRUD, dirBasename, uniqueWorkspaceName
  acp.ts             ACP wire types + describeAcpError (classify a failure)
  mcp.ts             context.dev entry + non-destructive mcp_config merge
  models.ts          domain types + DEFAULT_PERMISSION_MODE

src/server/   the local host (Node)
  index.ts           ws + http, message routing
  panes.ts           node-pty supervisor, per-pane config, OSC extraction
  devin-config-dir.ts  per-pane XDG config dir (READ THE HEADER)
  env.ts             minimal .env reader; the server gets none from Vite
  acp-client.ts      short-lived `devin acp` JSON-RPC subprocess
  health.ts          polls each pane's --export transcript (4s)
  store.ts           ~/.devin-agent-tmux, atomic + diffed writes
  paths.ts           tilde expansion (tested separately from node-pty)
  convex-mirror.ts   best-effort sync, never blocks
  protocol.ts        ws message types, shared with the browser

src/ui/       React + xterm.js
  App.tsx            shell, state, banner, panes
  Guide.tsx          the guide popup (first-run + banner button)
  theme.ts           Instrument token literals + the xterm palette
  ... LayoutView, Sidebar, TerminalPane, PaneLauncher,
      SessionPicker, TracePanel, NameDialog, StatusBadge, backend

convex/       mirror schema + push/pull (thin projection, opaque JSON blobs)
scripts/      node-pty fix + two smoke tests
```

**Three seams:** PTY (bidirectional, the live agent) · Hooks→OSC (agent→app,
status + identity) · ACP (app→agent, read-only history).

**Two config channels, and they are not interchangeable** — `--config` carries
the hooks, `XDG_CONFIG_HOME` carries the MCP servers. See §3 trap 9.

---

## 6. Run & verify

```bash
npm install          # postinstall fixes node-pty's spawn-helper exec bit
npm run dev          # Vite :5173 + PTY/ACP server :5177
npm test             # 94 tests
npm run typecheck
```

Smoke tests (server must be running):

```bash
node scripts/smoke-pane.mjs                    # spawn → hooks → OSC → id → health
node scripts/smoke-acp.mjs                     # session/list
node scripts/smoke-acp.mjs <sessionId> <cwd>   # replay one into a trace
```

Throwaway profile: `DEVIN_MUX_HOME=/tmp/p npm run dev`

**Last verified results:**

```
bytes of pty output  : 5190
status signals       : ["running","idle"]
devin session id     : trail-aardwolf
context health       : ~2% of 1000000 (claude-opus-4-8-high-fast)

session/list -> 49 sessions  (live ones flagged [LOCKED])
trace "Implement plan-b03afdaeb5d4e16d"
  tool calls      : 135
  paired w/ timing: 135        ← every call matched to its result
  structured diffs: 49
```

---

## 7. Known gaps

- **UI has never been driven by an automated test.** Server, core, ACP and PTY
  paths are covered by scripts + unit tests; the React layer is typechecked and
  build-verified only. It has been *looked at* in a browser under Playwright
  (renders correctly, light mode) but nothing asserts on it, so any React change
  is still unguarded.
- **Convex is unconfigured.** Schema and mirror code exist; needs `npx convex dev`
  once. Server logs `[convex] no CONVEX_URL set — running local-only`.
- **Not ported from Chorus:** agent swarms with per-agent git-worktree isolation,
  Review/Merge/Discard, voice dictation, portable `.chorus` bundles.
  Swarms should be *designed*, not transliterated — Devin has a native
  `run_subagent` tool, so an external swarm may be the wrong abstraction.
- **No live trace** of a running pane (see lock constraint). Two viable routes
  were designed: hook event-stream to the server, or tailing `sessions.db`.

---

## 8. Git & attribution

Repo: `https://github.com/AshokNaik009/devin-agent-tmux` — **shared**, another
contributor (Venkatasairam G) commits here.

History was rewritten once to remove Claude Code attribution and add Devin's.
All SHAs changed; the force-push is done and remote is in sync.

**Convention for future commits — no Claude attribution. Use:**

```
Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <devin-ai-integration[bot]@users.noreply.github.com>
```

Never add that trailer to another contributor's commit.

`pull.rebase true` is set locally for this repo.

A local `backup-pre-rewrite` branch holds the pre-rewrite SHAs; delete it once
you're satisfied (`git branch -D backup-pre-rewrite`).

---

## 9. Suggested next steps

1. **Resolve the `.mcp.json` precedence risk in §11.** Highest value: it is the
   one open question about a feature that is otherwise finished and verified.
2. `npx convex dev` and confirm the mirror actually writes.
3. Decide on swarms: native `run_subagent` vs. Chorus-style external fan-out.
4. Consider live trace via the hook event-stream route.
5. Give the React layer at least a smoke render test — it is the only layer with
   no automated coverage at all.

---

## 10. context.dev — the default MCP server

Every pane starts with the [context.dev](https://context.dev) MCP server already
connected: web search, scraping, crawling, structured extraction, document
parsing. No per-session setup, and no user action required.

### Where the key comes from

Two levels, resolved by `resolveContextApiKey()` in `core/mcp.ts`:

```
workspace.contextApiKey          collected in the New workspace dialog; wins
  ↓ falls back to
CONTEXT_DEV_API_KEY  (.env)      the default that makes this a DEFAULT
  ↓ neither set
pane runs with no context.dev    supported state, logged once at startup
```

Per-workspace rather than one global key so two workspaces can bill to two
accounts. Blank is normalised to `undefined` at the point of creation — an empty
string would otherwise reach the spawn as a present-but-useless key and shadow
the `.env` default, producing an opaque auth error at the first tool call.

**The key never crosses the websocket.** The browser is told only whether a
default exists (`env.hasDefaultContextKey`), which is just enough for the dialog
to say what leaving the field blank will do.

### How it reaches the agent

```
UI: workspace.contextApiKey
  → pane:spawn { contextApiKey }
  → PaneSupervisor.spawn
  → buildPaneConfigDir()                     server/devin-config-dir.ts
      writes <paneDir>/xdg/devin/mcp_config.json   (0600)
  → ptySpawn(env: { XDG_CONFIG_HOME: <paneDir>/xdg })
```

`--config` still carries the hooks; `XDG_CONFIG_HOME` carries the MCP servers.
**They are two different mechanisms and are not interchangeable — §3 trap 9 has
the probes that establish why.**

The pane's config dir is a *shadow* of `~/.config`: every entry symlinked
through, with a real `devin/` whose `config.json` and `mcp_config.json` we
generate. This matters because `XDG_CONFIG_HOME` is not Devin's variable — a
bare redirect would also move `git`, `gh` and anything else the agent shells out
to. Symlinks (not copies) mean a skill the user adds mid-session is picked up
live. The dir is rebuilt from scratch on each spawn; stale links to deleted
config would be a silent, confusing failure.

Credentials live under `XDG_DATA_HOME`, which is untouched — this is why a
redirected pane stays signed in.

### The entry shape

Written exactly as issued, the `.mcp.json` form:

```json
{ "mcpServers": { "context": {
    "type": "http",
    "url": "https://mcp.context.dev/mcp",
    "headers": { "Authorization": "Bearer ctxt_secret_…" } } } }
```

Both `{"type":"http"}` and Devin's native `{"transport":"http"}` parse — verified
with `devin mcp get context`. The key goes in a header, never in the URL:
context.dev's own server instructions say so, and a URL is logged in far more
places than a header is.

`composeMcpConfig()` merges non-destructively and **refuses to overwrite an entry
it did not write** — specifically, one with no `Authorization` header, which is
what a user who ran `devin mcp login context` would have. Clobbering that would
silently swap a working OAuth credential for an API key.

### Verified end-to-end

Against real Devin CLI `3000.6.7`, driving the actual `buildPaneConfigDir` code
path rather than a hand-built fixture:

```
devin --config <paneDir>/xdg/devin/config.json   (XDG_CONFIG_HOME=<paneDir>/xdg)
  → "Logged in as naikashok08@gmail.com"          auth survives the redirect
  → "two MCP servers available: context and playwright"
  → context web-search tool call SUCCEEDED, no auth error
```

`playwright` in that list comes from Devin's Claude Code import (`~/.claude.json`),
which is home-based and unaffected by the redirect — a useful signal that the
shadow is not hiding the user's own config.

---

## 11. Session handoff — 2026-08-30

### What this session did

1. **context.dev as the default MCP server** (§10). New: `core/mcp.ts`,
   `server/devin-config-dir.ts`, `server/env.ts`, plus a `contextApiKey` field on
   `Workspace`, on `pane:spawn`, and in the New workspace dialog.
2. **Retheme to the Instrument design system.** `DESIGN.md` at the repo root is
   now authoritative for every colour, type step, spacing and motion value. The
   eight Dell catalog tints are gone; panes are told apart by the surface system
   and a brass left edge on `:focus-within`.
3. **Fixed the trace panel dumping raw JSON-RPC** (§3 trap 10).

94 tests pass, typecheck clean, `vite build` succeeds.

### Secrets — read before you commit anything

- **`.env` exists locally and holds a real context.dev key.** It is gitignored
  (`git check-ignore .env` confirms). **Never commit it, never paste the key into
  a file that is tracked, never echo it into a commit message or a PR body.**
- `.env.example` carries the placeholder and the explanation. That one is tracked.
- Generated `mcp_config.json` files under `~/.devin-agent-tmux/panes/*/xdg/` also
  contain the key, at `0600`. They are outside the repo.

### ⚠ Open risk: this repo's own `.mcp.json` shadows the feature

`.mcp.json` at the repo root is **tracked** and contains:

```json
"headers": { "Authorization": "Bearer " }     ← empty key
```

It is Claude Code's config, but **Devin imports `.mcp.json` as MCP servers** (see
Devin's `read_config_from` docs — Claude Code sources include `.mcp.json`). If
that import lands at project scope, it outranks the user-scope entry we generate,
and a pane whose cwd is *this repo* would get a `context` server with an empty
Bearer token — ours silently overridden by a broken one.

This is **unverified either way**. It does not affect panes in other directories,
which is every real use of the app, which is why it was recorded rather than
guessed at. To settle it:

```bash
cd /Users/ashoknaik/devin-agent-tmux
XDG_CONFIG_HOME=~/.devin-agent-tmux/panes/<somePaneId>/xdg devin mcp get context
# then check whether the Authorization header shown is ours or the empty one
```

If it does override, the fix is **not** to put the real key in `.mcp.json` — that
file is tracked and the repo is shared. Either delete the `context` block from
`.mcp.json` (Claude Code can get context.dev from `~/.claude.json` instead), or
set `read_config_from.claude: false` in the generated per-pane `config.json`.

### State of the tree

Everything described above is committed except this HANDOFF edit. Note that
`HANDOFF.md` was truncated to 9 lines in the working tree at one point during the
session — most likely two writers racing on it — and was restored with
`git checkout -- HANDOFF.md`. If a doc looks impossibly short, check `git show
HEAD:<file>` before assuming the content was never written.

### Things deliberately NOT done

- No commit of `.env`, and no key in any tracked file.
- The global `~/.config/devin/mcp_config.json` is **not** written to. An earlier
  draft did register context.dev there; it was removed when per-workspace keys
  made per-pane config necessary. The app should not change sessions it did not
  start.
- The React layer still has no automated test. It was rendered and eyeballed,
  not asserted on.
