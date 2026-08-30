/**
 * The websocket protocol between the browser and this server. Shared by both
 * sides so a message shape cannot drift.
 */
import type { AppState, DevinPermissionMode } from '../core/models.js';
import type { ContextHealth } from '../core/context-health.js';
import type { AcpSessionSummary } from '../core/acp.js';
import type { PaneStatus } from '../core/models.js';
import type { Trace } from '../core/trace.js';

export type ClientMessage =
  | { t: 'state:save'; state: AppState }
  | { t: 'pane:spawn'; paneId: string; cwd: string; cols: number; rows: number; model?: string; permissionMode: DevinPermissionMode; prompt?: string; resumeSessionId?: string; shellOnly?: boolean }
  | { t: 'pane:input'; paneId: string; data: string }
  | { t: 'pane:resize'; paneId: string; cols: number; rows: number }
  | { t: 'pane:kill'; paneId: string }
  | { t: 'sessions:list'; cwd: string; reqId: string }
  | { t: 'trace:load'; sessionId: string; cwd: string; reqId: string };

export type ServerMessage =
  | { t: 'state'; state: AppState }
  /** Sent once on connect: real paths the browser cannot know on its own. */
  | { t: 'env'; home: string; cwd: string }
  | { t: 'pane:data'; paneId: string; data: string }
  | { t: 'pane:status'; paneId: string; status: PaneStatus }
  | { t: 'pane:session'; paneId: string; devinSessionId: string }
  | { t: 'pane:exit'; paneId: string; code: number }
  | { t: 'pane:health'; paneId: string; health: ContextHealth }
  | { t: 'sessions:result'; reqId: string; sessions?: AcpSessionSummary[]; error?: string }
  | { t: 'trace:result'; reqId: string; trace?: Trace; error?: string };
