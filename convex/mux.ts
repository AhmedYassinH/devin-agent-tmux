import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Mirror endpoints.
 *
 * `pushState` is idempotent and last-write-wins: the local file store is the
 * source of truth, so the correct recovery from any conflict is simply to push
 * again from local. Nothing here ever writes back down.
 */

const workspaceArg = v.object({
  id: v.string(),
  name: v.string(),
  cwd: v.string(),
  view: v.string(),
  sessionOrder: v.array(v.string()),
  layout: v.string(),
  sessions: v.string(),
  // The Kanban board, mirrored opaquely alongside sessions (see schema.ts).
  cards: v.optional(v.string()),
  cardOrder: v.optional(v.array(v.string())),
  updatedAt: v.number(),
});

export const pushState = mutation({
  args: {
    profileKey: v.optional(v.string()),
    storeVersion: v.number(),
    activeWorkspaceId: v.optional(v.string()),
    workspaceOrder: v.array(v.string()),
    workspaces: v.array(workspaceArg),
  },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    const now = Date.now();

    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_profile', (q) => q.eq('profileKey', profileKey))
      .unique();

    const profile = {
      profileKey,
      storeVersion: args.storeVersion,
      activeWorkspaceId: args.activeWorkspaceId,
      workspaceOrder: args.workspaceOrder,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, profile);
    else await ctx.db.insert('profiles', profile);

    const live = new Set(args.workspaces.map((w) => w.id));
    for (const ws of args.workspaces) {
      const row = await ctx.db
        .query('workspaces')
        .withIndex('by_workspace', (q) => q.eq('profileKey', profileKey).eq('workspaceId', ws.id))
        .unique();
      const doc = {
        profileKey,
        workspaceId: ws.id,
        name: ws.name,
        cwd: ws.cwd,
        view: ws.view,
        sessionOrder: ws.sessionOrder,
        layout: ws.layout,
        sessions: ws.sessions,
        cards: ws.cards,
        cardOrder: ws.cardOrder,
        updatedAt: ws.updatedAt || now,
      };
      if (row) await ctx.db.patch(row._id, doc);
      else await ctx.db.insert('workspaces', doc);
    }

    // Reap workspaces deleted locally, so the mirror cannot resurrect them.
    const all = await ctx.db
      .query('workspaces')
      .withIndex('by_profile', (q) => q.eq('profileKey', profileKey))
      .collect();
    for (const row of all) {
      if (!live.has(row.workspaceId)) await ctx.db.delete(row._id);
    }

    return { ok: true, workspaces: args.workspaces.length };
  },
});

/** Read the mirror — for a remote/read-only view of what a machine has open. */
export const pullState = query({
  args: { profileKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_profile', (q) => q.eq('profileKey', profileKey))
      .unique();
    const workspaces = await ctx.db
      .query('workspaces')
      .withIndex('by_profile', (q) => q.eq('profileKey', profileKey))
      .collect();
    return { profile, workspaces };
  },
});

const commandArg = v.object({
  commandId: v.string(),
  message: v.string(),
  createdAt: v.number(),
});

export const enqueueCommands = mutation({
  args: { profileKey: v.optional(v.string()), commands: v.array(commandArg) },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    for (const command of args.commands) {
      const existing = await ctx.db
        .query('terminalCommands')
        .withIndex('by_command', (q) => q.eq('profileKey', profileKey).eq('commandId', command.commandId))
        .unique();
      if (!existing) await ctx.db.insert('terminalCommands', { profileKey, ...command });
    }
  },
});

export const pendingCommands = query({
  args: { profileKey: v.optional(v.string()) },
  handler: async (ctx, args) =>
    ctx.db
      .query('terminalCommands')
      .withIndex('by_profile', (q) => q.eq('profileKey', args.profileKey ?? 'default'))
      .order('asc')
      .take(500),
});

export const acknowledgeCommands = mutation({
  args: { profileKey: v.optional(v.string()), commandIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    for (const commandId of args.commandIds) {
      const row = await ctx.db
        .query('terminalCommands')
        .withIndex('by_command', (q) => q.eq('profileKey', profileKey).eq('commandId', commandId))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }
  },
});

export const acknowledgeCommand = mutation({
  args: { profileKey: v.optional(v.string()), commandId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('terminalCommands')
      .withIndex('by_command', (q) =>
        q.eq('profileKey', args.profileKey ?? 'default').eq('commandId', args.commandId),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const updateMachineStatus = mutation({
  args: {
    profileKey: v.optional(v.string()),
    home: v.string(),
    cwd: v.string(),
    agentId: v.string(),
    hasDefaultContextKey: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    const row = await ctx.db
      .query('machineStatus')
      .withIndex('by_profile', (q) => q.eq('profileKey', profileKey))
      .unique();
    const value = {
      profileKey,
      home: args.home,
      cwd: args.cwd,
      agentId: args.agentId,
      hasDefaultContextKey: args.hasDefaultContextKey,
      lastSeen: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert('machineStatus', value);
  },
});

export const getMachineStatus = query({
  args: { profileKey: v.optional(v.string()) },
  handler: async (ctx, args) =>
    ctx.db
      .query('machineStatus')
      .withIndex('by_profile', (q) => q.eq('profileKey', args.profileKey ?? 'default'))
      .unique(),
});

export const appendOutput = mutation({
  args: { profileKey: v.optional(v.string()), paneId: v.string(), data: v.string() },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    const row = await ctx.db
      .query('terminalPanes')
      .withIndex('by_pane', (q) => q.eq('profileKey', profileKey).eq('paneId', args.paneId))
      .unique();
    const snapshot = `${row?.snapshot ?? ''}${args.data}`.slice(-200_000);
    const value = {
      profileKey,
      paneId: args.paneId,
      snapshot,
      lastChunk: args.data,
      outputVersion: (row?.outputVersion ?? 0) + 1,
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert('terminalPanes', value);
  },
});

export const terminalState = query({
  args: { profileKey: v.optional(v.string()) },
  handler: async (ctx, args) =>
    ctx.db
      .query('terminalPanes')
      .withIndex('by_profile', (q) => q.eq('profileKey', args.profileKey ?? 'default'))
      .collect(),
});

export const publishEvent = mutation({
  args: {
    profileKey: v.optional(v.string()),
    eventId: v.string(),
    message: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const profileKey = args.profileKey ?? 'default';
    const existing = await ctx.db
      .query('realtimeEvents')
      .withIndex('by_event', (q) => q.eq('profileKey', profileKey).eq('eventId', args.eventId))
      .unique();
    if (!existing) await ctx.db.insert('realtimeEvents', { ...args, profileKey });
    const rows = await ctx.db
      .query('realtimeEvents')
      .withIndex('by_profile', (q) => q.eq('profileKey', profileKey))
      .order('desc')
      .take(251);
    for (const row of rows.slice(250)) await ctx.db.delete(row._id);
  },
});

export const realtimeEvents = query({
  args: { profileKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('realtimeEvents')
      .withIndex('by_profile', (q) => q.eq('profileKey', args.profileKey ?? 'default'))
      .order('desc')
      .take(250);
    return rows.reverse();
  },
});
