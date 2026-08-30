import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * The mirror schema.
 *
 * This is deliberately a THIN projection of the local file store, not a second
 * model of the app. Layout trees and pane maps are stored as opaque JSON strings
 * because their shape lives in src/core/models.ts — mirroring them structurally
 * would mean migrating two stores in lockstep every time a layout gains a field,
 * for no query we actually run. What IS structured is what a remote view needs
 * to list and order workspaces without parsing anything.
 */
export default defineSchema({
  profiles: defineTable({
    /** One row per machine/profile. Last write wins. */
    profileKey: v.string(),
    storeVersion: v.number(),
    activeWorkspaceId: v.optional(v.string()),
    workspaceOrder: v.array(v.string()),
    updatedAt: v.number(),
  }).index('by_profile', ['profileKey']),

  workspaces: defineTable({
    profileKey: v.string(),
    workspaceId: v.string(),
    name: v.string(),
    cwd: v.string(),
    view: v.string(),
    sessionOrder: v.array(v.string()),
    /** JSON: LayoutNode. Opaque on purpose — see the note above. */
    layout: v.string(),
    /** JSON: Record<string, SessionConfig>. Opaque on purpose. */
    sessions: v.string(),
    updatedAt: v.number(),
  })
    .index('by_profile', ['profileKey'])
    .index('by_workspace', ['profileKey', 'workspaceId']),
});
