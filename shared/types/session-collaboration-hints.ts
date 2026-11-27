import { normalizeAutonomySessionScope, type AutonomySessionScope } from './identity-scope.js';
import { parseSessionCollaborationQuery, type SessionCollaborationQuery } from './session-collaboration.js';
import type { TaskClaim, TaskContract } from '../task-system/types.js';

export type CoordinationTaskRef = Pick<TaskContract, 'taskNodeId' | 'revision' | 'digest' | 'state'>;
export type TaskCoordinationFacts = {
  task: CoordinationTaskRef;
  referenceOnly: boolean;
  claim: Pick<TaskClaim, 'sessionKey' | 'generation' | 'epoch' | 'state' | 'expiresAt'> | null;
  pendingOperations: number;
  dependencies: Array<{ taskNodeId: string; state: TaskContract['state'] | 'unknown' }>;
  relation: 'same-task' | 'shared-artifact' | 'different' | 'unknown';
  sharedArtifacts: string[];
};
export type SessionCollaborationHints = {
  schemaVersion: 'SessionCollaborationHints/v1';
  requester: AutonomySessionScope;
  target: AutonomySessionScope;
  state: 'ready' | 'empty' | 'unavailable' | 'stale' | 'unknown';
  reason?: string;
  capturedAt: number;
  taskReadState: 'ready' | 'empty' | 'unavailable';
  task: TaskCoordinationFacts | null;
  admission: { owner: 'SessionAdmissionRegistry'; active: number; waiters: number; fenced: boolean } | null;
};

export function parseCollaborationHintsQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['requester', 'target', 'limit'].includes(key))) throw new TypeError('One scoped coordination target required');
  const query = parseSessionCollaborationQuery(value);
  if (!query.target || query.limit !== 1)
    throw new TypeError('One scoped coordination target required');
  return { requester: query.requester, target: query.target, limit: 1 as const } satisfies SessionCollaborationQuery;
}

export function emptyCollaborationHints(query: ReturnType<typeof parseCollaborationHintsQuery>,
  state: SessionCollaborationHints['state'], reason?: string): SessionCollaborationHints {
  return { schemaVersion: 'SessionCollaborationHints/v1', requester: query.requester, target: query.target,
    state, capturedAt: Date.now(), taskReadState: state === 'empty' ? 'empty' : 'unavailable', task: null, admission: null, ...(reason ? { reason } : {}) };
}

export function validateCollaborationHints(query: ReturnType<typeof parseCollaborationHintsQuery>, value: unknown): SessionCollaborationHints {
  const invalid = () => emptyCollaborationHints(query, 'unknown', 'protocol-unverified');
  try {
    const page = value as SessionCollaborationHints;
    const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
    const text = (value: unknown, limit = 300) => typeof value === 'string' && value.length > 0 && value.length <= limit;
    const states = ['ready', 'doing', 'paused', 'review', 'cancelling', 'done', 'cancelled'];
    if (!page || page.schemaVersion !== 'SessionCollaborationHints/v1' || !count(page.capturedAt)
      || !['ready', 'empty', 'unavailable', 'stale', 'unknown'].includes(page.state)) return invalid();
    normalizeAutonomySessionScope(page.requester, query.requester);
    normalizeAutonomySessionScope(page.target, query.target);
    if (page.state !== 'ready' && page.state !== 'empty') return emptyCollaborationHints(query, page.state, page.reason);
    if (!['ready', 'empty', 'unavailable'].includes(page.taskReadState) || (page.taskReadState === 'ready') !== Boolean(page.task)
      || (page.state === 'empty' && (page.task || page.taskReadState !== 'empty'))) return invalid();
    const facts = page.task;
    if (facts) {
      const task = facts.task, claim = facts.claim;
      if (!task || !text(task.taskNodeId) || !count(task.revision) || task.revision < 1 || !/^[a-f0-9]{64}$/.test(task.digest)
        || !states.includes(task.state) || typeof facts.referenceOnly !== 'boolean' || !count(facts.pendingOperations)
        || !Array.isArray(facts.dependencies) || facts.dependencies.length > 30
        || facts.dependencies.some(item => !text(item.taskNodeId) || ![...states, 'unknown'].includes(item.state))
        || !['same-task', 'shared-artifact', 'different', 'unknown'].includes(facts.relation)
        || !Array.isArray(facts.sharedArtifacts) || facts.sharedArtifacts.length > 4 || facts.sharedArtifacts.some(path => !text(path, 4096))) return invalid();
      if (claim && (!text(claim.sessionKey) || !text(claim.generation) || !count(claim.epoch) || claim.epoch < 1
        || !count(claim.expiresAt) || !['active', 'paused', 'recovery_required', 'released'].includes(claim.state))) return invalid();
    }
    const admission = page.admission;
    if (admission && (admission.owner !== 'SessionAdmissionRegistry' || !count(admission.active)
      || !count(admission.waiters) || typeof admission.fenced !== 'boolean')) return invalid();
    if (page.task === undefined || page.admission === undefined) return invalid();
    return page;
  } catch { return invalid(); }
}
