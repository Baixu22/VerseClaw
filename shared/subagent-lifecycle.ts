export type SubagentLifecycleIdentity = {
  taskNodeId?: string;
  roleInstanceId?: string;
  childRunId?: string;
  roleName?: string;
  task?: string;
};

/** Stable compatibility key for merging live lifecycle events. */
export function subagentLifecycleIdentityKey(event: SubagentLifecycleIdentity): string {
  return event.taskNodeId
    || event.roleInstanceId
    || event.childRunId
    || `${event.roleName ?? 'unknown'}:${event.task ?? ''}`;
}
