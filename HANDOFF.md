# Handoff — devin-agent-tmux

Read this first. It records **why** things are the way they are, and the
empirically-verified facts about the Devin CLI that were expensive to discover.
Re-deriving them costs real time; contradicting them will break the app.

**Status:** working v1. 67 tests pass, typecheck clean, production build succeeds,
both halves verified end-to-end against real Devin CLI `3000.6.7`.

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

**Design language:** "Dell 1996 Inspired" — black page frame, flat catalog-color
ribbon cards, Arial Black display / Helvetica UI / **Times Roman body**, zero
border-radius except award seals. The palette is **closed**: red is reserved for
the CTA panel, the banner callout and the cert-seal *only*, which is why `exited`
status and the `handoff` context tier use `tint-salmon` rather than brand red.

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
  acp.ts             ACP wire types (captured from the live server)
  models.ts          domain types + DEFAULT_PERMISSION_MODE

src/server/   the local host (Node)
  index.ts           ws + http, message routing
  panes.ts           node-pty supervisor, per-pane config, OSC extraction
  acp-client.ts      short-lived `devin acp` JSON-RPC subprocess
  health.ts          polls each pane's --export transcript (4s)
  store.ts           ~/.devin-agent-tmux, atomic + diffed writes
  paths.ts           tilde expansion (tested separately from node-pty)
  convex-mirror.ts   best-effort sync, never blocks
  protocol.ts        ws message types, shared with the browser

src/ui/       React + xterm.js
  App.tsx            shell, state, banner, panes
  Guide.tsx          the guide popup (first-run + banner button)
  theme.ts           catalog tints + CRT terminal palette
  ... LayoutView, Sidebar, TerminalPane, PaneLauncher,
      SessionPicker, TracePanel, NameDialog, StatusBadge, backend

convex/       mirror schema + push/pull (thin projection, opaque JSON blobs)
scripts/      node-pty fix + two smoke tests
```

**Three seams:** PTY (bidirectional, the live agent) · Hooks→OSC (agent→app,
status + identity) · ACP (app→agent, read-only history).

---

## 6. Run & verify

```bash
npm install          # postinstall fixes node-pty's spawn-helper exec bit
npm run dev          # Vite :5173 + PTY/ACP server :5177
npm test             # 67 tests
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
  hand-verified only.
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

1. Drive the UI in a browser and fix what breaks — the least-verified layer.
2. `npx convex dev` and confirm the mirror actually writes.
3. Decide on swarms: native `run_subagent` vs. Chorus-style external fan-out.
4. Consider live trace via the hook event-stream route.
