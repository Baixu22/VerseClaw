import { existsSync } from 'node:fs';
import type { GatewayManager } from '../gateway/manager';
import { getProjectCoordinatorProfiles } from './workspaces-api';
import { openTaskSystem } from './task-system-service';
import { getAggregatedResourceEnvelopeSnapshot } from './resource-envelope';
import { RESOURCE_METRICS_TTL_MS } from '../../shared/types/resources';
import { nextReadyPlanChild } from '../../shared/task-system/types';
import { systemProjectOwnerKey, type SystemProjectRead, type SystemProjectSnapshot } from '../../shared/types/system-portfolio';
import type { SessionKey, WorkspaceId } from '../../shared/types/identity-scope';

export async function readSystemProject(input: SystemProjectRead, gateway?: Pick<GatewayManager, 'rpc'>): Promise<SystemProjectSnapshot> {
  if (!input || typeof input.workspaceId !== 'string' || !input.workspaceId.trim()
    || typeof input.expectedOwnerKey !== 'string') throw new Error('SYSTEM_PROJECT_IDENTITY_REQUIRED');
  const profiles = await getProjectCoordinatorProfiles();
  const profile = profiles.find(entry => entry.id === input.workspaceId);
  if (!profile || !existsSync(profile.rootPath)) throw new Error('SYSTEM_PROJECT_UNAVAILABLE');
  const ownerKey = systemProjectOwnerKey(profile);
  if (ownerKey !== input.expectedOwnerKey) throw new Error('SYSTEM_PROJECT_CHANGED');
  const key = profile.projectCoordinatorSessionKey;
  const binding = key ? profile.coordinatorBindings?.[key] : undefined;
  const owners = (rows: typeof profiles) => rows.filter(entry => key && entry.projectCoordinatorSessionKey === key).map(entry => entry.id).sort().join('\n');
  const coordinator: SystemProjectSnapshot['coordinator'] = {
    sessionKey: key ? key as SessionKey : null, generation: binding?.sessionGeneration ?? null,
    bindingRevision: binding?.bindingRevision ?? null, state: key ? 'unavailable' : 'unbound',
  };
  if (key && binding?.workspaceId === profile.id && binding.sessionKey === key
    && binding.sessionGeneration && !profile.archivedSessionKeys?.includes(key)
    && profiles.filter(entry => entry.projectCoordinatorSessionKey === key).length === 1
    && (!binding.invalidationReason || (binding.state === 'paused' && binding.invalidationReason === 'user-paused'))
    && (binding.state === 'active' || binding.state === 'paused') && gateway) {
    try {
      const description = await gateway.rpc<{ session?: { key?: string; sessionId?: string } | null }>('sessions.describe', { key }, 15_000);
      if (description.session?.sessionId === binding.sessionGeneration
        && (!description.session.key || description.session.key === key)) {
        coordinator.state = binding.state === 'paused' ? 'paused' : binding.invalidationReason ? 'unavailable' : 'ready';
      }
    } catch { /* The persisted identity remains visible while its live owner is unavailable. */ }
  }
  const store = await openTaskSystem(profile.id);
  try {
    const envelope = await getAggregatedResourceEnvelopeSnapshot().catch(() => null);
    const observedAt = Date.now();
    const observations = (envelope?.entries ?? []).filter(entry => entry.workspaceKey === profile.id
      && observedAt >= entry.updatedAt && observedAt - entry.updatedAt <= RESOURCE_METRICS_TTL_MS).map(entry => ({
      id: entry.id, owner: entry.owner, kind: entry.kind, activeSlots: entry.activeSlots,
      queuedCount: entry.queuedCount, observedAt: entry.updatedAt,
    }));
    const plan = store?.projectPlan(profile.id);
    const tasks = plan ? [plan.task, ...plan.children] : [];
    const result: SystemProjectSnapshot = {
      scope: 'project', workspaceId: profile.id as WorkspaceId, ownerKey, observedAt, coordinator,
      plan: plan ? {
        taskNodeId: plan.task.contract.taskNodeId, objective: plan.task.contract.objective,
        state: plan.task.contract.state, revision: plan.task.contract.revision,
        nextAction: plan.task.checkpoint?.nextAction ?? plan.revisions[0]?.nextAction ?? '',
        nextTaskNodeId: nextReadyPlanChild(plan.children)?.contract.taskNodeId ?? null,
        pendingDecisions: plan.revisions[0]?.pendingDecisions ?? [],
        tasks: plan.children.map(({ contract }) => ({ taskNodeId: contract.taskNodeId,
          objective: contract.objective, state: contract.state, revision: contract.revision })),
      } : null,
      evidence: tasks.flatMap(task => (store?.getTaskEvidence(task.contract.taskNodeId) ?? []).map(receipt => ({
        taskNodeId: receipt.taskNodeId, receiptId: receipt.receiptId, candidate: receipt.candidate,
        revision: receipt.revision, sha256: receipt.sha256, verifier: receipt.verifier,
      }))),
      resources: {
        activeTaskClaims: plan ? tasks.filter(task => task.claim && task.claim.state !== 'released').length : null,
        pendingEffects: plan ? tasks.reduce((sum, task) => sum + task.pendingOperations, 0) : null,
        costUsd: null,
        observations,
      },
    };
    const currentProfiles = await getProjectCoordinatorProfiles();
    const current = currentProfiles.find(entry => entry.id === profile.id);
    if (!current || systemProjectOwnerKey(current) !== ownerKey || owners(currentProfiles) !== owners(profiles)) {
      throw new Error('SYSTEM_PROJECT_CHANGED');
    }
    return result;
  } finally { store?.close(); }
}
