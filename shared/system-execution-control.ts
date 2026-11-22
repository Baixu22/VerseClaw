/** Control actions still reach their existing owner, which validates their target identity. */
export function isSystemExecutionControl(toolName: string, args: unknown): boolean {
  const action = String((args as { action?: unknown } | null)?.action ?? '').toLowerCase();
  const controls: Record<string, readonly string[]> = {
    process: ['list', 'poll', 'log', 'kill'],
    subagents: ['list', 'info', 'kill'],
    task_loop: ['status', 'pause', 'cancel'],
    mission_loop: ['status', 'pause', 'cancel'],
    transcripts: ['status', 'list', 'stop'],
  };
  return controls[toolName.toLowerCase()]?.includes(action) === true;
}
