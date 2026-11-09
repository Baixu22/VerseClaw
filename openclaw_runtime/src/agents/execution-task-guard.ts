import { existsSync } from 'node:fs';
import { createTaskRuntimeGuard } from '../../../shared/task-system/runtime.js';
import { getSessionEntry } from '../config/sessions/store.js';
import { createExecutionTaskAccess } from './execution-task-authority.js';

/** Runtime admission reads session state; Main's authority access stays independent of runtime config. */
export function createExecutionTaskGuard(workspace: string | undefined, sessionKey: string | undefined, generation: string | undefined, runId?: string) {
  if (process.env.CLAWX_TASK_SCOPE_BRIDGE === '1' && sessionKey) {
    const migration = getSessionEntry({ sessionKey })?.executionMigration;
    if (migration && migration.state !== 'confirmed') throw new Error('TASK_EXECUTION_MIGRATION_PENDING');
  }
  return createTaskRuntimeGuard(workspace, sessionKey, generation, runId,
    workspace && sessionKey && existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}
