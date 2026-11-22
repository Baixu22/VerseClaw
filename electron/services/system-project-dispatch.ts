import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createHash } from 'node:crypto';
import type { SystemProjectDispatchPayload } from '../../shared/host-api/contract';
import type { SessionDelegationResult } from '../../shared/types/session-delegation';
import { getProjectCoordinatorProfiles, readSystemControl } from './workspaces-api';
import { getExecutionWorkspaceProfile, runWithProjectExecutionScope } from './project-execution-scope';
import { getResourceFabric, type ResourceFabric } from './resource-fabric';

/** Admission is serialized fairly; worker lifetime and spend remain with Runtime owners. */
export function createSystemProjectDispatch(dispatch: CompleteHostServiceRegistry['sessions']['dispatchPlanTask'],
  fabric: Pick<ResourceFabric, 'runResource'> = getResourceFabric()) {
  const flights = new Map<string, Promise<SessionDelegationResult>>();
  return async (input: SystemProjectDispatchPayload): Promise<SessionDelegationResult> => {
    if (!input || !Number.isSafeInteger(input.expectedPolicyRevision) || input.expectedPolicyRevision < 0
      || ![input.workspaceId, input.sessionKey, input.expectedSessionGeneration, input.planId, input.expectedChildId].every(value => typeof value === 'string' && value.trim())
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      return { success: false, status: 'rejected', error: 'SYSTEM_PROJECT_INTENT_INVALID' };
    }
    const key = createHash('sha256').update(JSON.stringify([input.workspaceId, input.sessionKey, input.expectedSessionGeneration, input.planId,
      input.expectedRevision, input.expectedChildId, input.expectedPolicyRevision, input.approvalId ?? null])).digest('hex');
    const existing = flights.get(key);
    if (existing) return existing;
    const execute = async (): Promise<SessionDelegationResult> => {
      try {
        const policy = await readSystemControl();
        if (policy.paused || policy.revision !== input.expectedPolicyRevision) throw new Error('SYSTEM_DISPATCH_PAUSED_OR_CHANGED');
        const profile = (await getProjectCoordinatorProfiles()).find(p => p.id === input.workspaceId);
        if (!profile) throw new Error('SYSTEM_PROJECT_UNAVAILABLE');
        return await runWithProjectExecutionScope(profile, input.sessionKey, input.expectedSessionGeneration, policy.revision, async () => {
          await getExecutionWorkspaceProfile();
          return fabric.runResource('projectDispatch', 'system', { tenant: profile.id, qos: 'background',
            timeoutMs: 180_000, operationKey: key }, async () => {
            await getExecutionWorkspaceProfile();
            return dispatch(input);
          });
        });
      } catch (error) {
        return { success: false, status: 'rejected', error: error instanceof Error ? error.message : String(error) };
      }
    };
    const flight = execute().finally(() => flights.delete(key));
    flights.set(key, flight);
    return flight;
  };
}
