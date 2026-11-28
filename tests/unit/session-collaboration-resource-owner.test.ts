import { expect, it } from 'vitest';
import { projectCollaborationProcessSample, resourceOwnerScopeMatches, validateCollaborationResources } from '../../shared/types/session-collaboration-resources';
import { RESOURCE_METRICS_TTL_MS, type ResourceProcessObservation } from '../../shared/types/resources';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';

const now = 50_000;
const root: ResourceProcessObservation = { pid: 100, parentPid: 1, creationToken: 'root-incarnation',
  rssBytes: 1024, privateBytes: null, cpuTimeMs: 100, cpuPercent: 2 };
const child: ResourceProcessObservation = { ...root, pid: 101, parentPid: root.pid, creationToken: 'child-incarnation',
  rssBytes: 2048, cpuPercent: 3 };
const capture = new Map([[root.pid, root.creationToken], [child.pid, child.creationToken]]);
const scope = { sessionKey: 'agent:main:session', workspaceId: 'workspace-a', projectId: 'workspace-a',
  sessionGeneration: 'generation-a' } as AutonomySessionScope;

it('counts the same original process only once across overlapping roots', () => {
  const result = projectCollaborationProcessSample({ sample: { status: 'ok', sampledAt: now, processes: [root, child, child] },
    roots: [root.pid, child.pid, root.pid], ownedRoots: capture, captured: capture, handlesStable: true, now });
  expect(result).toMatchObject({ state: 'known', count: 2, rssKb: 3, cpuPercent: 5, processTreePids: [100, 101], sampledAt: now });
});

it('keeps reused PIDs, changed owner handles and stale samples unknown', () => {
  const read = (processes: ResourceProcessObservation[], sampledAt: number, handlesStable = true) =>
    projectCollaborationProcessSample({ sample: { status: 'ok', sampledAt, processes }, roots: [root.pid], ownedRoots: capture, captured: capture, handlesStable, now });
  for (const result of [
    read([{ ...root, creationToken: 'reused' }, child], now),
    read([root, child], now, false),
    read([root, child], now - RESOURCE_METRICS_TTL_MS - 1),
  ]) {
    expect(result).toMatchObject({ state: 'unknown', count: null, rssKb: null, cpuPercent: null, processTreePids: null });
  }
});

it('rejects a PID reused before both measurements and missing original root identity', () => {
  for (const ownedRoots of [new Map([[root.pid, 'original-incarnation']]), new Map<number, string>()]) {
    expect(projectCollaborationProcessSample({ sample: { status: 'ok', sampledAt: now, processes: [root, child] },
      roots: [root.pid], ownedRoots, captured: capture, handlesStable: true, now }))
      .toMatchObject({ state: 'unknown', pids: null, rssKb: null, cpuPercent: null });
  }
});

it('rejects inventory from a different workspace or physical generation', () => {
  const owner = { sessionKey: scope.sessionKey, workspaceId: scope.workspaceId, expectedSessionId: 'old' };
  expect(resourceOwnerScopeMatches(owner, scope)).toBe(false);
  expect(resourceOwnerScopeMatches({ ...owner, expectedSessionId: scope.sessionGeneration, workspaceId: 'other' }, scope)).toBe(false);
  const query = { requester: scope, target: scope };
  expect(validateCollaborationResources(query, { ...query, schemaVersion: 'SessionCollaborationResources/v1', state: 'ready',
    inventory: { schema: 'LongSessionResourceInventory/v1', scope: owner, capturedAt: new Date(now).toISOString(), owners: [] } }))
    .toMatchObject({ state: 'unknown', reason: 'protocol-unverified', inventory: null });
});
