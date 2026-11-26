import type { LongSessionResourceInventory, ReclaimScope, SessionOwnerInventory } from '../long-session-resource-reclamation.js';
import { normalizeAutonomySessionScope, type AutonomySessionScope } from './identity-scope.js';
import { RESOURCE_METRICS_TTL_MS, type ResourceProcessObservation } from './resources.js';
import type { SessionActivityReadReason } from './session-activity.js';

export type SessionCollaborationResourceQuery = { requester: AutonomySessionScope; target: AutonomySessionScope };
export type SessionCollaborationResources = SessionCollaborationResourceQuery & {
  schemaVersion: 'SessionCollaborationResources/v1';
  state: 'ready' | 'stale' | 'unavailable' | 'unknown';
  reason?: SessionActivityReadReason;
  inventory: LongSessionResourceInventory | null;
};

export function parseSessionCollaborationResourceQuery(value: unknown): SessionCollaborationResourceQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => key !== 'requester' && key !== 'target')) throw new TypeError('Scoped resource query required');
  const { requester, target } = value as SessionCollaborationResourceQuery;
  return { requester: normalizeAutonomySessionScope(requester, requester), target: normalizeAutonomySessionScope(target, target) };
}

export function emptyCollaborationResources(query: SessionCollaborationResourceQuery,
  state: Exclude<SessionCollaborationResources['state'], 'ready'>, reason: SessionActivityReadReason): SessionCollaborationResources {
  return { ...query, schemaVersion: 'SessionCollaborationResources/v1', state, reason, inventory: null };
}

export function resourceOwnerScopeMatches(owner: ReclaimScope, target: AutonomySessionScope) {
  return owner.sessionKey === target.sessionKey && owner.workspaceId === target.workspaceId && owner.expectedSessionId === target.sessionGeneration;
}

export function validateCollaborationResources(query: SessionCollaborationResourceQuery, value: unknown): SessionCollaborationResources {
  const invalid = () => emptyCollaborationResources(query, 'unknown', 'protocol-unverified');
  if (!value || typeof value !== 'object') return invalid();
  const resource = value as SessionCollaborationResources;
  try {
    normalizeAutonomySessionScope(resource.requester, query.requester);
    normalizeAutonomySessionScope(resource.target, query.target);
    if (resource.schemaVersion !== 'SessionCollaborationResources/v1' ||
        !['ready', 'stale', 'unknown', 'unavailable'].includes(resource.state)) return invalid();
    if (resource.state !== 'ready') return resource.inventory === null ? resource : invalid();
    const inventory = resource.inventory;
    if (!inventory || inventory.schema !== 'LongSessionResourceInventory/v1' || !resourceOwnerScopeMatches(inventory.scope, query.target) ||
        !Number.isFinite(Date.parse(inventory.capturedAt)) || !Array.isArray(inventory.owners)) return invalid();
    const seen = new Set<string>();
    const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    for (const owner of inventory.owners) {
      const key = JSON.stringify([owner.kind, owner.owner, owner.observationScope]);
      if (!owner.owner || seen.has(key) || !['known', 'unknown'].includes(owner.state) ||
          (owner.observationScope === 'shared' ? owner.generation !== null : owner.generation !== query.target.sessionGeneration) ||
          (owner.sampledAt !== undefined && (!Number.isFinite(owner.sampledAt) || owner.sampledAt < 0))) return invalid();
      seen.add(key);
      if (owner.admission && (typeof owner.admission.fenced !== 'boolean' ||
          (owner.admission.rejectedWhileFenced !== null && !count(owner.admission.rejectedWhileFenced)))) return invalid();
      if (owner.budgetEnabled !== undefined && typeof owner.budgetEnabled !== 'boolean') return invalid();
      if (owner.spend) {
        if (!Array.isArray(owner.spend) || owner.spend.length > 3 || new Set(owner.spend.map(row => row.scope)).size !== owner.spend.length ||
            owner.spend.some(row => !['host', 'project', 'session'].includes(row.scope) || ![
              row.spentTokens, row.spentCostMicros, row.heldTokens, row.heldCostMicros, row.activeCalls, row.unknownTokenCalls, row.unknownCostCalls,
            ].every(count))) return invalid();
      }
    }
  } catch { return invalid(); }
  return resource;
}

type ScopedProcessSample = {
  status: 'ok' | 'unknown' | 'empty';
  sampledAt: number;
  processes?: ResourceProcessObservation[];
};

/** Distinct incarnation tokens fence the measured tree against the owner's original root handles. */
export function projectCollaborationProcessSample(input: {
  sample: ScopedProcessSample; roots: readonly number[]; captured: ReadonlyMap<number, string> | null;
  handlesStable: boolean; now: number;
}): Pick<SessionOwnerInventory, 'state' | 'count' | 'pids' | 'processTreePids' | 'rssKb' | 'cpuPercent' | 'sampledAt'> {
  const { sample, captured, handlesStable } = input;
  const roots = [...new Set(input.roots)];
  const unknown = { state: 'unknown' as const, count: null, pids: null, processTreePids: null, rssKb: null, cpuPercent: null, sampledAt: sample.sampledAt };
  if (!handlesStable || !captured || !Number.isFinite(sample.sampledAt) || sample.sampledAt > input.now ||
      input.now - sample.sampledAt > RESOURCE_METRICS_TTL_MS) return unknown;
  if (sample.status === 'empty' && !roots.length && !captured.size)
    return { ...unknown, state: 'known', count: 0, pids: [], processTreePids: [], rssKb: 0 };
  if (sample.status !== 'ok' || !sample.processes?.length) return unknown;
  const tree = new Map<number, ResourceProcessObservation>();
  for (const process of sample.processes) {
    if (!process.creationToken || captured.get(process.pid) !== process.creationToken ||
        !Number.isFinite(process.rssBytes) || process.rssBytes < 0) return unknown;
    const prior = tree.get(process.pid);
    if (prior && (prior.rssBytes !== process.rssBytes || prior.cpuPercent !== process.cpuPercent)) return unknown;
    tree.set(process.pid, process);
  }
  if (tree.size !== captured.size || roots.some(pid => !tree.has(pid))) return unknown;
  const rows = [...tree.values()];
  return { state: 'known', count: tree.size, pids: roots.sort((a, b) => a - b), processTreePids: [...tree.keys()].sort((a, b) => a - b),
    rssKb: Math.ceil(rows.reduce((total, process) => total + process.rssBytes, 0) / 1024),
    cpuPercent: rows.every(process => process.cpuPercent !== null && Number.isFinite(process.cpuPercent) && process.cpuPercent >= 0)
      ? rows.reduce((total, process) => total + process.cpuPercent!, 0) : null, sampledAt: sample.sampledAt };
}
