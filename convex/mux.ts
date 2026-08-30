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
