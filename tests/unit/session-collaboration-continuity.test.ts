// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { materialReference, validateMaterialPage } from '../../shared/types/session-collaboration-material';
import { emptySessionCollaborationPage } from '../../shared/types/session-collaboration';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import { readSessionCollaborationMaterials, readSessionCollaborationMaterialBatch } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-material';
import { openExecutionStateDatabase } from '../../openclaw_runtime/src/state/execution-state-db';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

const mocks = vi.hoisted(() => ({ entries: {} as Record<string, { sessionId: string; workspaceId: string; workspaceDir: string }> }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({ loadSessionEntry: (key: string) => ({ canonicalKey: key, entry: mocks.entries[key] }) }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-collaboration-query.js', () => ({ readSessionCollaborationQuery: async (query: { requester: AutonomySessionScope; target?: AutonomySessionScope }) => {
  const source = query.target ?? query.requester;
  if (mocks.entries[source.sessionKey]?.sessionId !== source.sessionGeneration)
    return { ...emptySessionCollaborationPage(query, 'stale', 'generation-changed') };
  return { state: 'ready', items: [{ detail: { scope: source } }], nextCursor: null };
} }));
const source = { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:source', sessionGeneration: 'source-generation' } as AutonomySessionScope;
const child = { ...source, sessionKey: 'agent:main:child', sessionGeneration: 'child-generation' } as AutonomySessionScope;
const context = { getRuntimeConfig: () => ({ tools: { sessions: { visibility: 'all' } } }) } as never;
let root: string, store: TaskSystemStore, now: number;
let claim: NonNullable<ReturnType<TaskSystemStore['claim']>['claim']>;
const publish = (id: string, sensitivity: 'internal' | 'restricted' = 'internal') => store.publishSharedMaterial(claim,
  { id, kind: 'claim', summary: id, sensitivity, evidenceRefs: [] }, 'original-run', () => source);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'collaboration-continuity-'));
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite')); openExecutionStateDatabase();
  now = Date.now() - 10_000;
  store = new TaskSystemStore(resolveTaskDomain(root), () => now);
  const task = store.create({ objective: 'Continue original work', target: 'result', constraints: [],
    acceptance: [{ id: 'owner', description: 'Original result', verification: { kind: 'owner-receipt', owner: 'fixture' } }] }, 'task').task;
  claim = store.claim(task.contract.taskNodeId, source.sessionKey, source.sessionGeneration, 'claim').claim!;
  mocks.entries = Object.fromEntries([source, child].map(scope => [scope.sessionKey, { sessionId: scope.sessionGeneration,
    workspaceId: scope.workspaceId, workspaceDir: root }]));
});
afterEach(() => { store.close(); closeOpenClawStateDatabase(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

it('pins allowed versions atomically with a readonly fork and preserves them across retries and reopen', () => {
  const material = publish('original'); publish('private', 'restricted');
  const fork = store.inheritReference(source.sessionKey, source.sessionGeneration, child.sessionKey, child.sessionGeneration)!;
  expect(fork.referenceOnly).toBe(true); expect(fork.claim?.sessionKey).toBe(source.sessionKey);
  expect(() => store.beginOperation({ ...claim, sessionKey: child.sessionKey, generation: child.sessionGeneration }, 'write', 'exec')).toThrow();
  const saved = store.collaborationContinuity(child.sessionKey, child.sessionGeneration, claim.taskNodeId);
  expect(saved).toMatchObject([{ kind: 'fork', materials: [{ source, ref: materialReference(material) }] }]);
  publish('after-fork'); store.inheritReference(source.sessionKey, source.sessionGeneration, child.sessionKey, child.sessionGeneration);
  const reopened = new TaskSystemStore(store.domain);
  try { expect(reopened.collaborationContinuity(child.sessionKey, child.sessionGeneration, claim.taskNodeId)).toEqual(saved); }
  finally { reopened.close(); }
  expect(store.history(claim.taskNodeId).some(event => event.kind === 'shared_material_continuity')).toBe(false);
});

it('honors a historical fork point and bounds references without importing later material', () => {
  publish('before'); now += 1; const cutoff = now; publish('ambiguous-same-millisecond'); now += 100;
  for (let index = 0; index < 7; index++) publish('later-' + index);
  store.inheritReference(source.sessionKey, source.sessionGeneration, child.sessionKey, child.sessionGeneration, cutoff);
  expect(store.collaborationContinuity(child.sessionKey, child.sessionGeneration, claim.taskNodeId)[0].materials.map(item => item.ref.id)).toEqual(['before']);
  store.inheritReference(source.sessionKey, source.sessionGeneration, 'agent:main:tip', 'tip-generation');
  expect(store.collaborationContinuity('agent:main:tip', 'tip-generation', claim.taskNodeId)[0]).toMatchObject({ truncated: true, materials: expect.any(Array) });
  expect(store.collaborationContinuity('agent:main:tip', 'tip-generation', claim.taskNodeId)[0].materials).toHaveLength(4);
});

it('retains original sources through a fork of a fork and reads current revocation from the material owner', async () => {
  const material = publish('source-material');
  store.inheritReference(source.sessionKey, source.sessionGeneration, child.sessionKey, child.sessionGeneration);
  store.inheritReference(child.sessionKey, child.sessionGeneration, 'agent:main:grandchild', 'grandchild-generation');
  expect(store.collaborationContinuity('agent:main:grandchild', 'grandchild-generation', claim.taskNodeId)[0].materials[0].source).toEqual(source);
  store.revokeSharedMaterial(claim, materialReference(material), 'Withdrawn', 'original-run', () => source);
  const result = await readSessionCollaborationMaterials({ requester: child, target: source, ref: materialReference(material) }, context);
  expect(result.detail?.state).toBe('revoked');
  expect(store.collaborationContinuity(child.sessionKey, child.sessionGeneration, claim.taskNodeId)[0].materials[0].ref).toEqual(materialReference(material));
});

it('records handoff provenance while the original owner alone transfers the writer epoch', () => {
  const material = publish('handoff-material');
  const next = store.handoff(claim, child.sessionKey, child.sessionGeneration);
  expect(next.claim).toMatchObject({ sessionKey: child.sessionKey, generation: child.sessionGeneration, epoch: claim.epoch + 1 });
  expect(() => store.control(claim, 'renew')).toThrow();
  expect(store.collaborationContinuity(child.sessionKey, child.sessionGeneration, claim.taskNodeId)).toMatchObject([
    { kind: 'handoff', sourceGeneration: source.sessionGeneration, materials: [{ ref: materialReference(material) }] },
  ]);
});

it('reads a pinned internal predecessor only after a real same-session migration, including final batches', async () => {
  const material = publish('migration-material'); const restricted = publish('private', 'restricted');
  const next = { ...source, sessionGeneration: 'new-generation' };
  const input = { requester: next, target: source, ref: materialReference(material) };
  mocks.entries[source.sessionKey].sessionId = next.sessionGeneration;
  expect(await readSessionCollaborationMaterials(input, context)).toMatchObject({ state: 'stale', detail: null });
  store.handoff(claim, source.sessionKey, next.sessionGeneration);
  const result = await readSessionCollaborationMaterials(input, context);
  expect(validateMaterialPage(input, result)).toMatchObject({ state: 'ready', detail: { state: 'claim', material: { sourceGeneration: source.sessionGeneration, sourceRun: { runId: 'original-run' } } } });
  expect((await readSessionCollaborationMaterialBatch([input], context))[0].detail?.material).toEqual(material);
  expect((await readSessionCollaborationMaterials({ ...input, ref: materialReference(restricted) }, context)).detail).toBeNull();
  expect((await readSessionCollaborationMaterials({ ...input, ref: { ...input.ref, contentDigest: '0'.repeat(64) } }, context)).detail).toBeNull();
  expect(() => store.binding(source.sessionKey, source.sessionGeneration)).toThrow('TASK_GENERATION_STALE');
});

it('does not turn a migrated material reference into a cross-workspace grant', async () => {
  const material = publish('workspace-material');
  store.handoff(claim, source.sessionKey, 'new-generation');
  const requester = { ...source, workspaceId: 'other', projectId: 'other', sessionGeneration: 'new-generation' } as AutonomySessionScope;
  mocks.entries[source.sessionKey] = { sessionId: requester.sessionGeneration, workspaceId: requester.workspaceId, workspaceDir: root };
  expect(await readSessionCollaborationMaterials({ requester, target: source, ref: materialReference(material) }, context))
    .toMatchObject({ state: 'unavailable', detail: null, reason: 'not-visible' });
});
