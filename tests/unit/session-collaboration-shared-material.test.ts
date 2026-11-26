// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';

const { loadSessionEntry } = vi.hoisted(() => ({ loadSessionEntry: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({ loadSessionEntry }));

const source = {
  workspaceId: 'workspace-a', projectId: 'workspace-a',
  sessionKey: 'agent:main:writer', sessionGeneration: 'generation-a',
} as AutonomySessionScope;
const summary = 'The verified output matches the task.\n';
const sha256 = createHash('sha256').update(summary).digest('hex');
const fixtures: Array<{ root: string; store: TaskSystemStore }> = [];

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-material-'));
  const store = new TaskSystemStore(resolveTaskDomain(root));
  fixtures.push({ root, store });
  const path = join(root, 'result.txt');
  writeFileSync(path, summary);
  const { task } = store.create({ objective: 'Verify the output', target: 'result.txt', constraints: [],
    acceptance: [{ id: 'output', description: 'Check the output', verification: { kind: 'file-sha256', path: 'result.txt', sha256 } }],
  }, 'create');
  const claim = store.claim(task.contract.taskNodeId, source.sessionKey, source.sessionGeneration, 'claim').claim!;
  const proof = store.verifyFile(claim, 'output', 'result.txt', sha256, 'candidate');
  const material = { id: 'result', kind: 'fact', summary, sensitivity: 'restricted', evidenceRefs: [proof.receiptId],
    artifactRefs: [{ path: 'result.txt', sha256 }], applicability: ['candidate'] };
  return { root, path, store, task, claim, proof, material };
}

afterEach(() => {
  loadSessionEntry.mockReset();
  for (const { root, store } of fixtures.splice(0)) {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

describe('TaskSystem collaboration materials', () => {
  it('binds exact owner evidence and preserves one receipt across runs and database reopen', () => {
    const { store, task, claim, material } = setup();
    const result = store.publishSharedMaterial(claim, material, 'run-a', () => source);
    expect(result).toMatchObject({
      authorityId: store.domain.id, taskNodeId: task.contract.taskNodeId, taskRevision: task.contract.revision,
      taskDigest: task.contract.digest, sourceGeneration: source.sessionGeneration,
      sourceRun: { runId: 'run-a', scope: { workspaceId: source.workspaceId, sessionKey: source.sessionKey } },
      version: 1, state: 'evidence-backed', artifactRefs: material.artifactRefs,
    });
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    const reopened = new TaskSystemStore(store.domain);
    try {
      expect(reopened.publishSharedMaterial(claim, material, 'run-b', () => source)).toEqual(result);
      expect(() => reopened.publishSharedMaterial(claim, { ...material, summary: 'Different' }, 'run-b', () => source))
        .toThrow('TASK_IDEMPOTENCY_CONFLICT');
    } finally { reopened.close(); }
    expect(store.db.prepare("SELECT count(*) AS count FROM task_events WHERE kind='shared_material_published'").get()?.count).toBe(1);
    expect(store.history(claim.taskNodeId).map(event => event.kind)).not.toContain('shared_material_published');
    expect(store.changes('other-workspace').events.map(event => event.kind)).not.toContain('shared_material_published');
    expect(store.traceSnapshot(claim.taskNodeId).events.map(event => event.kind)).not.toContain('shared_material_published');
  });

  it('keeps unbound text as a claim and rejects stale evidence, scope changes and unsafe inputs', () => {
    const { store, claim, path, material } = setup();
    const publish = (value: unknown) => store.publishSharedMaterial(claim, value, 'run-a', () => source);
    expect(publish({ ...material, id: 'unbound', summary: 'Unverified conclusion' })).toMatchObject({ kind: 'claim', state: 'claim' });
    expect(publish({ ...material, id: 'handoff', kind: 'handoff', evidenceRefs: [] })).toMatchObject({ kind: 'handoff', state: 'claim' });
    expect(() => publish({ ...material, evidenceRefs: ['wrong-receipt'] })).toThrow('MATERIAL_EVIDENCE_UNVERIFIED');
    expect(() => publish({ ...material, sourceRun: { runId: 'forged' } })).toThrow('MATERIAL_INPUT_INVALID');
    expect(() => publish({ ...material, artifactRefs: [{ path, sha256, tools: ['exec'] }] })).toThrow('MATERIAL_INPUT_INVALID');
    expect(() => store.publishSharedMaterial(claim, material, 'run-a', vi.fn()
      .mockReturnValueOnce(source).mockReturnValue({ ...source, sessionGeneration: 'new-generation' }))).toThrow(/sessionGeneration/);
    writeFileSync(path, 'changed');
    expect(() => publish(material)).toThrow('TASK_EVIDENCE_STALE');
  });

  it('uses the current runtime run and rejects a prepared migration or old generation', async () => {
    const { root, store, claim, material } = setup();
    const runId = 'real-runtime-run';
    store.beginRun(claim, runId);
    const entry = { sessionId: source.sessionGeneration, workspaceId: source.workspaceId, workspaceDir: root };
    const setEntry = (value: Record<string, unknown>) => loadSessionEntry.mockReturnValue({ canonicalKey: source.sessionKey, entry: value });
    setEntry(entry);
    const tool = createPersistentTaskTool({ workspace: root, sessionKey: source.sessionKey, generation: source.sessionGeneration, runId });
    const params = { action: 'publishMaterial', material };
    await expect(tool.execute('call-a', params)).resolves.toMatchObject({ details: { sourceRun: { runId }, state: 'evidence-backed' } });
    await expect(tool.execute('call-b', { ...params, runId: 'forged' })).rejects.toThrow('MATERIAL_INPUT_INVALID');
    setEntry({ ...entry, executionMigration: { state: 'prepared' } });
    await expect(tool.execute('call-c', params)).rejects.toThrow('TASK_EXECUTION_MIGRATION_PENDING');
    setEntry({ ...entry, sessionId: 'new-generation' });
    await expect(tool.execute('call-d', params)).rejects.toThrow('MATERIAL_SOURCE_SCOPE_MISMATCH');
    expect(loadSessionEntry).toHaveBeenCalledWith(source.sessionKey, { readOnly: true, skipCache: true });
  });
});
