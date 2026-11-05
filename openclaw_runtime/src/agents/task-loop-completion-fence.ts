// Coordinates existing owner mutations with A2 journal CAS. No verdict cache.
import { existsSync } from 'node:fs';
import { getRuntimeConfigSnapshotMetadata, hashRuntimeConfigValue, registerRuntimeConfigMutationGuard } from '../config/runtime-snapshot.js';
import { taskLedgerEventsPath, withLongTaskLedgerEvidenceMutation } from './long-task-control/task-ledger.js';

type WorkspaceJournal = { workspaceId: string; eventsPath: string };
const observed = new Map<string, WorkspaceJournal>();

/** Called only for a session-resolved completion context or a persisted owner. */
export function trackTaskLoopCompletionWorkspace(workspaceId: string, env: NodeJS.ProcessEnv = process.env): WorkspaceJournal {
  const owner = { workspaceId, eventsPath: taskLedgerEventsPath(workspaceId, env) };
  if (existsSync(owner.eventsPath)) observed.set(owner.eventsPath, owner);
  return owner;
}

registerRuntimeConfigMutationGuard((apply, reset, nextConfig) => {
  // A repeated activation may refresh metadata but cannot change an A3 config
  // digest. Compare the retained fingerprint, not object identity (callers may
  // mutate and reactivate the same object). Real changes/clear still fence.
  if (!reset && nextConfig && getRuntimeConfigSnapshotMetadata()?.fingerprint === hashRuntimeConfigValue(nextConfig)) {
    apply();
    return;
  }
  const owners = [...observed.values()].filter(owner => {
    if (existsSync(owner.eventsPath)) return true;
    observed.delete(owner.eventsPath);
    return false;
  });
  withLongTaskLedgerEvidenceMutation(owners, 'runtime-config-before-mutation', apply);
  if (reset) observed.clear();
});

/** Old and new workspace are fenced when an existing checkpoint is reassigned. */
export function mutateTaskLoopCompletionEvidence<T>(workspaces: readonly (string | undefined)[], apply: () => T): T {
  const owners = [...new Set(workspaces.filter((id): id is string => Boolean(id)))].map(id => trackTaskLoopCompletionWorkspace(id));
  const result = withLongTaskLedgerEvidenceMutation(owners, 'task-loop-checkpoint-before-mutation', apply);
  for (const owner of owners) observed.set(owner.eventsPath, owner);
  return result;
}
