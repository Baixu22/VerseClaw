/**
 * Resource Tracker — shared types
 *
 * Tracks server/port resources spawned during agent sessions so they can be
 * monitored, listed in the UI, and automatically cleaned up when idle or when
 * the owning session ends.
 */

export type TrackedResourceStatus = 'healthy' | 'idle' | 'unreachable';

export type TrackedResource = {
  /** Unique resource id */
  id: string;
  /** Port the resource is listening on */
  port: number;
  /** Human-readable label (derived from command or process name) */
  label: string;
  /** Process ID */
  pid: number;
  /** Command that started this resource */
  command?: string;
  /** Session key that owns this resource */
  sessionKey: string;
  /** Session label for display */
  sessionLabel?: string;
  /** Workspace id */
  workspaceId?: string | null;
  /** Agent id */
  agentId?: string | null;
  /** Current heartbeat status */
  status: TrackedResourceStatus;
  /** ISO timestamp when the resource was registered */
  startedAt: string;
  /** ISO timestamp of the last successful heartbeat */
  lastHeartbeatAt: string | null;
  /** ISO timestamp when the session was last active */
  sessionLastActiveAt?: string | null;
};

export type ResourceTrackerSnapshot = {
  resources: TrackedResource[];
  /** Number of healthy resources */
  healthyCount: number;
  /** Number of idle resources (no heartbeat for > idle threshold) */
  idleCount: number;
  /** Number of unreachable resources */
  unreachableCount: number;
  /** Idle timeout in minutes used by the tracker */
  idleTimeoutMinutes: number;
};

export type ResourceTrackerListResult = {
  success: boolean;
  error?: string;
} & ResourceTrackerSnapshot;

export type ResourceTrackerStopResult = {
  success: boolean;
  error?: string;
  /** Resource id of the stopped resource */
  resourceId?: string;
};

export type ResourceTrackerStopAllResult = {
  success: boolean;
  error?: string;
  /** Number of resources stopped */
  stoppedCount: number;
};

export type ResourceTrackerRegisterPayload = {
  port: number;
  pid: number;
  label?: string;
  command?: string;
  sessionKey: string;
  sessionLabel?: string;
  workspaceId?: string | null;
  agentId?: string | null;
};

export type ResourceTrackerUnregisterPayload = {
  resourceId?: string;
  sessionKey?: string;
};

export type ResourceTrackerHeartbeatPayload = {
  resourceId: string;
};

export type ResourceTrackerCleanupPayload = {
  sessionKey?: string;
};
