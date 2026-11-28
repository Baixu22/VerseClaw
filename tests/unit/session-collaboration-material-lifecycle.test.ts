// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import { MATERIAL_SCAN_LIMIT, materialReference } from '../../shared/types/session-collaboration-material';

it('preserves original versions through conflict, replacement, revocation and missing evidence', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'collaboration-material-lifecycle-'));
  const store = new TaskSystemStore(resolveTaskDomain(workspace));
  const source = { workspaceId: 'workspace-a', projectId: 'workspace-a',
    sessionKey: 'agent:main:author', sessionGeneration: 'first' } as AutonomySessionScope;
  try {
    const original = 'Confirmed result', path = join(workspace, 'result.txt');
    const sha256 = createHash('sha256').update(original).digest('hex');
    writeFileSync(path, original);
    const { task } = store.create({ objective: 'Verify the result', target: 'result.txt', constraints: [],
      acceptance: [{ id: 'result', description: 'Original output', verification: { kind: 'file-sha256', path, sha256 } }],
    }, 'create');
    const claim = store.claim(task.contract.taskNodeId, source.sessionKey, source.sessionGeneration, 'claim').claim!;
    const proof = store.verifyFile(claim, 'result', path, sha256, 'candidate');
    const input = { id: 'initial', kind: 'fact', summary: original, sensitivity: 'internal',
      evidenceRefs: [proof.receiptId], artifactRefs: [{ path: 'result.txt', sha256 }] };
    const publish = (value: unknown) => store.publishSharedMaterial(claim, value, 'current-run', () => source);
    const first = publish(input), firstRef = materialReference(first);
    const alternative = publish({ ...input, id: 'alternative', summary: 'A conflicting conclusion', evidenceRefs: [], artifactRefs: [] });
    expect(store.sharedMaterialStatus(first, source, Date.now()).state).toBe('evidence-backed');
    expect(() => publish({ ...input, id: 'bad-replacement', summary: 'Unconfirmed replacement', supersedes: firstRef }))
      .toThrow('MATERIAL_SUPERSESSION_REJECTED');
    const conflict = publish({ id: 'conflict', kind: 'conflict', summary: 'Both claims retained', sensitivity: 'internal',
      evidenceRefs: [], conflictsWith: [firstRef, materialReference(alternative)] });
    expect(store.sharedMaterialStatus(first, source, Date.now())).toEqual({ state: 'conflict', related: [materialReference(conflict)] });
    expect(conflict.conflictsWith).toEqual([firstRef, materialReference(alternative)]);
    for (let index = 0; index < 8; index++) {
      const newer = publish({ id: `revoked-conflict-${index}`, kind: 'conflict', summary: 'Withdrawn conflict', sensitivity: 'internal',
        evidenceRefs: [], conflictsWith: [firstRef, materialReference(alternative)] });
      store.revokeSharedMaterial(claim, materialReference(newer), 'Withdrawn', 'current-run', () => source);
    }
    expect(store.sharedMaterialStatus(first, source, Date.now())).toEqual({ state: 'conflict', related: [materialReference(conflict)] });
    for (let index = 8; index < 60; index++) {
      const newer = publish({ id: `revoked-conflict-${index}`, kind: 'conflict', summary: 'Withdrawn conflict', sensitivity: 'internal',
        evidenceRefs: [], conflictsWith: [firstRef, materialReference(alternative)] });
      store.revokeSharedMaterial(claim, materialReference(newer), 'Withdrawn', 'current-run', () => source);
    }
    expect(store.sharedMaterialStatus(first, source, Date.now()).state).toBe('unknown');
    const successor = publish({ ...input, id: 'replacement', supersedes: firstRef });
    expect(successor.version).toBe(2);
    expect(store.sharedMaterialStatus(first, source, Date.now())).toEqual({ state: 'superseded', related: [materialReference(successor)] });
    writeFileSync(path, 'Modified output');
    expect(store.sharedMaterialStatus(successor, source, Date.now()).state).toBe('stale');
    unlinkSync(path);
    expect(store.sharedMaterialStatus(successor, source, Date.now()).state).toBe('unknown');
    const revoke = () => store.revokeSharedMaterial(claim, materialReference(successor), 'Source replaced', 'current-run', () => source);
    expect(revoke()).toEqual(revoke());
    expect(store.sharedMaterialStatus(successor, source, Date.now()).state).toBe('revoked');
    expect(store.readSharedMaterial(source, source, firstRef)).toEqual(first);
    expect(store.readHistoricalSharedMaterial(source, source, firstRef)).toMatchObject({ material: first, state: 'unknown' });
    expect(store.readHistoricalSharedMaterial({ ...source, sessionGeneration: 'unbound' }, source, firstRef)).toBeNull();
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

it('retains bounded active conflicts and keeps exhausted history unknown', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'collaboration-material-conflicts-'));
  const store = new TaskSystemStore(resolveTaskDomain(workspace));
  const source = { workspaceId: 'workspace-a', projectId: 'workspace-a',
    sessionKey: 'agent:main:author', sessionGeneration: 'first' } as AutonomySessionScope;
  try {
    const { task } = store.create({ objective: 'Check conflict filtering', target: 'out.txt', constraints: [],
      acceptance: [{ id: 'out', description: 'Check out', verification: { kind: 'owner-receipt', owner: 'fixture' } }],
    }, 'create');
    const claim = store.claim(task.contract.taskNodeId, source.sessionKey, source.sessionGeneration, 'claim').claim!;
    const publish = (input: Parameters<typeof store.publishSharedMaterial>[1]) =>
      store.publishSharedMaterial(claim, input, 'run-1', () => source);
    const base = publish({ id: 'base', kind: 'claim', summary: 'Base claim', sensitivity: 'internal', evidenceRefs: [] });
    const alt = publish({ id: 'alt', kind: 'claim', summary: 'Alternative claim', sensitivity: 'internal', evidenceRefs: [] });
    const baseRef = materialReference(base);
    const altRef = materialReference(alt);
    const activeConflict = publish({ id: 'conflict-active', kind: 'conflict', summary: 'Active conflict',
      sensitivity: 'internal', evidenceRefs: [], conflictsWith: [baseRef, altRef] });
    for (let i = 0; i < 8; i++) {
      const revoked = publish({ id: `conflict-revoked-${i}`, kind: 'conflict', summary: `Revoked ${i}`,
        sensitivity: 'internal', evidenceRefs: [], conflictsWith: [baseRef, altRef] });
      store.revokeSharedMaterial(claim, materialReference(revoked), 'Superseded', 'run-1', () => source);
    }
    expect(store.sharedMaterialStatus(base, source, Date.now())).toEqual({
      state: 'conflict', related: [materialReference(activeConflict)],
    });
    for (let i = 8; i < MATERIAL_SCAN_LIMIT; i++) {
      const revoked = publish({ id: `conflict-revoked-${i}`, kind: 'conflict', summary: `Revoked ${i}`,
        sensitivity: 'internal', evidenceRefs: [], conflictsWith: [baseRef, altRef] });
      store.revokeSharedMaterial(claim, materialReference(revoked), 'Superseded', 'run-1', () => source);
    }
    expect(store.sharedMaterialStatus(base, source, Date.now())).toEqual({ state: 'unknown' });
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
