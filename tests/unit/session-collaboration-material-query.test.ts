// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { readSessionCollaborationMaterials } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-material';
import type { GatewayRequestContext } from '../../openclaw_runtime/src/gateway/server-methods/types';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import { materialReference, validateMaterialPage } from '../../shared/types/session-collaboration-material';

const { visibility, loadSessionEntry } = vi.hoisted(() => ({ visibility: vi.fn(), loadSessionEntry: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({ loadSessionEntry }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-collaboration-query.js', () => ({ readSessionCollaborationQuery: visibility }));

it('searches only the visible source scopes and opens the original version by its digest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-material-query-'));
  const now = Date.now();
  const store = new TaskSystemStore(resolveTaskDomain(root), () => now - 10_000);
  const requester = { workspaceId: 'workspace-a', projectId: 'workspace-a', sessionKey: 'agent:main:reader',
    sessionGeneration: 'reader-generation' } as AutonomySessionScope;
  const source = { ...requester, sessionKey: 'agent:main:writer' as AutonomySessionScope['sessionKey'], sessionGeneration: 'writer-generation' };
  const context = {} as GatewayRequestContext;
  const query = (filters: Record<string, unknown>) => readSessionCollaborationMaterials({ requester, ...filters }, context);
  try {
    loadSessionEntry.mockImplementation(key => ({ canonicalKey: key, entry: { workspaceId: requester.workspaceId, workspaceDir: root,
      sessionId: key === source.sessionKey ? source.sessionGeneration : requester.sessionGeneration } }));
    visibility.mockImplementation(input => ({ state: 'ready', items: (input.target ? [input.target] : [requester, source])
      .map(scope => ({ detail: { scope } })), nextCursor: null }));
    const create = (name: string, file: string) => {
      const sha256 = createHash('sha256').update(file).digest('hex');
      writeFileSync(join(root, file), file);
      const { task } = store.create({ objective: name, target: file, constraints: [],
        acceptance: [{ id: 'output', description: 'Verify file', verification: { kind: 'file-sha256', path: file, sha256 } }],
      }, name);
      const claim = store.claim(task.contract.taskNodeId, source.sessionKey, source.sessionGeneration, `${name}-claim`).claim!;
      const proof = store.verifyFile(claim, 'output', file, sha256, 'candidate');
      const material = store.publishSharedMaterial(claim, { id: name, kind: 'artifact', summary: `Shared topic ${'a'.repeat(250)}`,
        artifactRefs: [{ path: file, sha256 }], sensitivity: 'internal', evidenceRefs: [proof.receiptId],
        ...(file === 'old.txt' ? { expiresAt: now - 1 } : {}),
      }, `${name}-run`, () => source);
      return { material, proof, claim };
    };
    const old = create('older', 'old.txt');
    store.control(old.claim, 'release');
    const current = create('newer', 'result.txt');
    store.publishSharedMaterial(current.claim, { id: 'private', kind: 'claim', summary: 'Shared topic private',
      sensitivity: 'restricted', evidenceRefs: [] }, 'newer-run', () => source);
    const first = await query({ search: 'shared topic', limit: 1 });
    expect(first).toMatchObject({ state: 'ready', items: [{ ref: materialReference(current.material), truncated: true }] });
    expect(first.nextCursor).toBeTruthy();
    const second = await query({ search: 'shared topic', limit: 1, cursor: first.nextCursor });
    expect(second).toMatchObject({ state: 'ready', items: [{ ref: materialReference(old.material), state: 'expired' }], nextCursor: null });
    expect(await query({ file: 'result.txt', evidenceRef: current.proof.receiptId, taskNodeId: current.claim.taskNodeId }))
      .toMatchObject({ items: [{ ref: materialReference(current.material) }], scanned: 2 });
    const detail = await query({ target: source, ref: materialReference(current.material) });
    expect(detail.detail?.material).toEqual(current.material);
    expect(validateMaterialPage({ requester, target: source, ref: materialReference(current.material) },
      { ...detail, detail: { ...detail.detail, material: { ...current.material, contentDigest: '0'.repeat(64) } } })).toMatchObject({ state: 'unknown' });
    expect(await query({ search: 'does not exist' })).toMatchObject({ state: 'empty', items: [] });
    expect(await query({ target: { ...source, workspaceId: 'workspace-b', projectId: 'workspace-b' } }))
      .toMatchObject({ state: 'unavailable', reason: 'not-visible', scanned: 0 });
    visibility.mockResolvedValueOnce({ state: 'unavailable', reason: 'not-visible' });
    expect(await query({ target: source, ref: materialReference(current.material) }))
      .toMatchObject({ state: 'unavailable', reason: 'not-visible', detail: null });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
    vi.resetAllMocks();
  }
});
