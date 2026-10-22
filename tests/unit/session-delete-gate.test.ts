// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ configDir: '' }));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => state.configDir,
}));

const roots: string[] = [];

beforeEach(async () => {
  state.configDir = await mkdtemp(join(tmpdir(), 'clawx-delete-gate-'));
  roots.push(state.configDir);
});

afterEach(async () => {
  state.configDir = '';
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('session delete gate concurrency', () => {
  it('preserves concurrent gates for different sessions in one atomic file', async () => {
    const { persistSessionDeleteGate } = await import('@electron/services/session-delete-gate');
    const [first, second] = await Promise.all([
      persistSessionDeleteGate('agent:main:first', 'main'),
      persistSessionDeleteGate('agent:main:second', 'main'),
    ]);

    const filePath = join(
      state.configDir,
      'runtime-lifecycle-governance',
      'session-delete-gates.json',
    );
    const file = JSON.parse(await readFile(filePath, 'utf8')) as {
      gates: Record<string, { sessionKey: string }>;
    };
    expect(Object.keys(file.gates)).toEqual(expect.arrayContaining([
      first.operationId,
      second.operationId,
    ]));
  });

  it('reuses one operationId for concurrent persistence of the same session', async () => {
    const { persistSessionDeleteGate } = await import('@electron/services/session-delete-gate');
    const gates = await Promise.all(
      Array.from({ length: 20 }, () => persistSessionDeleteGate('agent:main:same', 'main')),
    );
    expect(new Set(gates.map((gate) => gate.operationId)).size).toBe(1);
  });

  it('reuses an archive operation only for the same request digest', async () => {
    const {
      buildSessionMutationRequestDigest,
      clearSessionDeleteGate,
      persistSessionMutationGate,
    } = await import('@electron/services/session-delete-gate');
    const requestDigest = buildSessionMutationRequestDigest('archive', {
      sessionKey: 'agent:main:archive-ui',
      originalWorkspaceId: 'workspace-a',
    });
    const first = await persistSessionMutationGate({
      sessionKey: 'agent:main:archive-ui',
      agentId: 'main',
      operationKind: 'archive',
      requestDigest,
    });
    const retry = await persistSessionMutationGate({
      sessionKey: 'agent:main:archive-ui',
      agentId: 'main',
      operationKind: 'archive',
      requestDigest,
    });
    expect(retry.operationId).toBe(first.operationId);
    await expect(persistSessionMutationGate({
      sessionKey: 'agent:main:archive-ui',
      agentId: 'main',
      operationKind: 'restore',
      requestDigest: buildSessionMutationRequestDigest('restore', {
        sessionKey: 'agent:main:archive-ui',
      }),
    })).rejects.toThrow(/pending archive operation/);
    await clearSessionDeleteGate(first.operationId);
  });

  it('fails try-lock admission while a delete critical section is active', async () => {
    const {
      tryWithSessionDeleteGateLock,
      withSessionDeleteGateLock,
    } = await import('@electron/services/session-delete-gate');
    let release!: () => void;
    const held = withSessionDeleteGateLock(
      'agent:main:locked',
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    await Promise.resolve();
    expect(tryWithSessionDeleteGateLock('agent:main:locked', () => 'opened')).toBeUndefined();
    release();
    await held;
    await expect(tryWithSessionDeleteGateLock('agent:main:locked', () => 'opened')).resolves.toBe('opened');
  });
});
