// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { materialReference } from '../../shared/types/session-collaboration-material';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

it('retains exact material evidence after source checkout cleanup and refuses wrong scopes or a missing retained object', () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-boundary-retention-')), repository = join(root, 'repo');
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
  vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'state'));
  const stores: ReturnType<typeof openExecutionTaskStore>[] = [];
  const open = (path: string) => { const store = openExecutionTaskStore(path); stores.push(store); return store; };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd, windowsHide: true, stdio: 'pipe', encoding: 'utf8' }).trim();
  const bytes = 'Original accepted evidence\n', sha256 = createHash('sha256').update(bytes).digest('hex');
  const source = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:source', sessionGeneration: 'source-generation' } }).requester;
  const viewer = { ...source, sessionKey: 'agent:main:viewer' as typeof source.sessionKey, sessionGeneration: 'viewer-generation' };
  try {
    mkdirSync(repository); git(repository, 'init', '-q', '-b', 'main');
    git(repository, 'config', 'user.name', 'Agent fixture'); git(repository, 'config', 'user.email', 'agent@example.invalid');
    git(repository, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repository, '.gitignore'), '.openclaw/\n'); writeFileSync(join(repository, 'artifact.txt'), bytes);
    git(repository, 'add', '.gitignore', 'artifact.txt'); git(repository, 'commit', '-qm', 'Original evidence');
    const service = createWorktreeService(repository, { backend: 'git' }), checkout = service.create('source');
    const original = open(checkout.root);
    const { task } = original.create({ objective: 'Preserve original evidence', target: 'artifact.txt', constraints: [],
      acceptance: [{ id: 'file', description: 'Original bytes', verification: { kind: 'file-sha256', path: 'artifact.txt', sha256 } }] }, 'create');
    const claim = original.claim(task.contract.taskNodeId, source.sessionKey, source.sessionGeneration, 'claim').claim!;
    const proof = original.verifyFile(claim, 'file', 'artifact.txt', sha256, 'original-candidate');
    const material = original.publishSharedMaterial(claim, { id: 'original-material', kind: 'artifact', summary: 'Original evidence',
      evidenceRefs: [proof.receiptId], artifactRefs: [{ path: 'artifact.txt', sha256 }], sensitivity: 'internal' }, 'publish', () => source);
    original.handoff(claim, viewer.sessionKey, viewer.sessionGeneration, repository);
    service.cleanup(checkout.id);
    const reader = open(repository), ref = materialReference(material);
    const history = reader.readHistoricalSharedMaterial(viewer, source, ref)!;
    expect(history).toMatchObject({ material, state: 'unknown', retainedEvidence: [{ sha256 }] });
    const retainedId = history.retainedEvidence[0].receiptId;
    writeFileSync(join(repository, 'artifact.txt'), 'Unrelated current checkout bytes');
    expect(reader.readRetainedArtifact(claim.taskNodeId, retainedId).toString()).toBe(bytes);
    expect(reader.readHistoricalSharedMaterial({ ...viewer, sessionGeneration: 'reset' }, source, ref)).toBeNull();
    expect(reader.readHistoricalSharedMaterial({ ...viewer, workspaceId: 'other', projectId: 'other' }, source, ref)).toBeNull();
    expect(reader.readHistoricalSharedMaterial(viewer, source, { ...ref, contentDigest: '0'.repeat(64) })).toBeNull();
    const receipt = reader.retentionReceipts(claim.taskNodeId).find(item => item.receiptId === retainedId)!;
    expect(() => reader.readRetainedArtifact('other-task', retainedId)).toThrow('TASK_RETENTION_RECEIPT_NOT_FOUND');
    git(repository, 'update-ref', '-d', receipt.retained.ref);
    expect(() => reader.readRetainedArtifact(claim.taskNodeId, retainedId)).toThrow();
    expect(reader.readHistoricalSharedMaterial(viewer, source, ref)?.material).toEqual(material);
  } finally {
    for (const store of stores) store.close();
    closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
  }
});
