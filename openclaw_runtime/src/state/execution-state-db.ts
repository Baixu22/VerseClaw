import { isAbsolute } from 'node:path';
import { openOpenClawStateDatabase, runOpenClawStateWriteTransaction, type OpenClawStateDatabase } from './openclaw-state-db.js';
import { resolveOpenClawStateSqlitePath } from './openclaw-state-db.paths.js';

/** Desktop-owned execution facts share one existing SQLite owner even when a source Gateway isolates its session config. */
export function resolveExecutionStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CLAWX_EXECUTION_STATE_PATH?.trim();
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error('execution_state_path_not_absolute');
    return explicit;
  }
  return resolveOpenClawStateSqlitePath(env);
}

export function openExecutionStateDatabase(): OpenClawStateDatabase {
  return openOpenClawStateDatabase({ path: resolveExecutionStatePath() });
}

export function runExecutionStateWriteTransaction<T>(operation: (database: OpenClawStateDatabase) => T): T {
  return runOpenClawStateWriteTransaction(operation, { path: resolveExecutionStatePath() });
}
