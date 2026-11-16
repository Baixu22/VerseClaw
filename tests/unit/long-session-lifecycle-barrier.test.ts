// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayRpcError } from '@electron/gateway/protocol';

const state = vi.hoisted(() => ({ configDir: '', unregister: vi.fn() }));

vi.mock('@electron/utils/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/paths')>();
  return { ...actual, getOpenClawConfigDir: () => state.configDir };
});

vi.mock('@electron/services/resource-tracker', () => ({
  getResourceTracker: () => ({ unregisterBySession: state.unregister, list: () => ({ resources: [] }) }),
}));

vi.mock('@electron/services/workspaces-api', async (original) => ({
  ...await original<typeof import('@electron/services/workspaces-api')>(),
  createWorkspacesApi: () => ({ list: async () => ({ success: true, profiles: [{
    id: 'workspace-a', activeSessionKey: 'agent:main:main', sessionStates: { 'agent:main:metadata-retry': {} },
  }] }) }),
  getPersistedCoordinatorBinding: async (_workspaceId: string, key: string) => key === 'agent:main:main'
    ? { state: 'active', archiveRestorePolicy: 'restore', sessionGeneration: 'generation-1' } : null,
}));

const roots: string[] = [];

beforeEach(async () => {
  state.configDir = await mkdtemp(join(tmpdir(), 'clawx-long-session-barrier-'));
  roots.push(state.configDir);
  state.unregister.mockReset();
  state.unregister.mockResolvedValue(0);
});

afterEach(async () => {
  state.configDir = '';
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function gatePath(): string {
  return join(state.configDir, 'runtime-lifecycle-governance', 'session-delete-gates.json');
}

async function readGates(): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(gatePath(), 'utf8')) as {
    gates?: Record<string, unknown>;
  };
  return parsed.gates ?? {};
}

describe('long-session Main lifecycle barrier', () => {
  it('calls the runtime archive method and releases the mirror gate only after a committed receipt', async () => {
    const rpc = vi.fn(async (_method: string, payload: Record<string, unknown>) => ({
      ok: true,
      key: payload.key,
      sessionId: 'generation-1',
      operationId: payload.operationId,
      journalState: 'runtime_committed',
      archived: true,
    }));
    const coordinatorLifecycle = vi.fn(async () => undefined);
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never, coordinatorLifecycle });
    const result = await api.archive({
      id: 'agent:main:main',
      originalWorkspaceId: 'workspace-a',
    });
    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'sessions.archive',
      expect.objectContaining({
        key: 'agent:main:main',
        operationId: expect.any(String),
        originalWorkspaceId: 'workspace-a',
      }),
      30_000,
    );
    expect(await readGates()).toEqual({});
    // The original archive reclamation contract preserves managed user resources.
    expect(state.unregister).not.toHaveBeenCalled();
    expect(coordinatorLifecycle).toHaveBeenCalledWith({ type: 'archive', workspaceId: 'workspace-a', sessionKey: 'agent:main:main' });
  });

  it('keeps the same operationId open after an unknown archive RPC and resumes on retry', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('RPC timeout'))
      .mockImplementationOnce(async (_method: string, payload: Record<string, unknown>) => ({
        ok: true,
        key: payload.key,
        sessionId: 'generation-1',
        operationId: payload.operationId,
        journalState: 'runtime_committed',
        archived: true,
      }));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });

    const first = await api.archive({ id: 'agent:main:retry' });
    expect(first.success).toBe(false);
    const pending = await readGates();
    expect(Object.values(pending)).toHaveLength(1);
    expect(Object.values(pending)[0]).toMatchObject({
      operationKind: 'archive',
      sessionKey: 'agent:main:retry',
    });

    const second = await api.archive({ id: 'agent:main:retry' });
    expect(second.success).toBe(true);
    const firstOperationId = (rpc.mock.calls[0]?.[1] as { operationId: string }).operationId;
    const secondOperationId = (rpc.mock.calls[1]?.[1] as { operationId: string }).operationId;
    expect(secondOperationId).toBe(firstOperationId);
    expect(await readGates()).toEqual({});
  });

  it('does not start a restore while an archive operation is pending for the same session', async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error('RPC timeout'));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });
    await api.archive({ id: 'agent:main:conflict' });
    const restore = await api.restore({ id: 'agent:main:conflict' });
    expect(restore.success).toBe(false);
    expect(restore.error).toMatch(/pending archive operation/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('uses the same durable gate contract for restore', async () => {
    const rpc = vi.fn(async (_method: string, payload: Record<string, unknown>) => ({
      ok: true,
      key: payload.key,
      entry: { sessionId: 'generation-restored' },
      operationId: payload.operationId,
      journalState: 'runtime_committed',
      restored: true,
    }));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });
    const result = await api.restore({ id: 'agent:main:restore' });
    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'sessions.restore',
      expect.objectContaining({
        key: 'agent:main:restore',
        operationId: expect.any(String),
      }),
      30_000,
    );
    expect(await readGates()).toEqual({});
  });

  it.each(['missing-action', 'wrong-session'])('retains the gate for a %s archive receipt', async (kind) => {
    const rpc = vi.fn(async (_method: string, payload: Record<string, unknown>) => ({
      ok: true,
      key: kind === 'wrong-session' ? 'agent:main:other' : payload.key,
      sessionId: 'generation-1',
      archived: kind === 'missing-action' ? undefined : true,
      operationId: payload.operationId,
      journalState: 'runtime_committed',
    }));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });
    expect((await api.archive({ id: 'agent:main:receipt-fault' })).success).toBe(false);
    expect(Object.values(await readGates())).toHaveLength(1);
    expect(state.unregister).not.toHaveBeenCalled();
  });

  it('releases a definitively refused pre-intent restore without releasing unknown mutations', async () => {
    const rpc = vi.fn(async (_method: string, payload: Record<string, unknown>) => {
      throw new GatewayRpcError({
        message: 'not archived',
        data: {
          kind: 'lifecycle-mutation-failure',
          operationId: payload.operationId,
          key: payload.key,
          retryable: false,
          noMutation: true,
        },
      });
    });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });
    expect((await api.restore({ id: 'agent:main:refused' })).success).toBe(false);
    expect(await readGates()).toEqual({});
    expect((await api.archive({ id: 'agent:main:refused' })).success).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(await readGates()).toEqual({});
  });

  it('releases a correlated definitive failure even when the runtime cannot claim noMutation', async () => {
    const rpc = vi.fn(async (_method: string, payload: Record<string, unknown>) => {
      throw new GatewayRpcError({
        message: 'operation identity conflicts with another session',
        details: {
          kind: 'lifecycle-mutation-failure',
          operationId: payload.operationId,
          key: payload.key,
          retryable: false,
        },
      });
    });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });
    expect((await api.archive({ id: 'agent:main:definitive' })).success).toBe(false);
    expect(await readGates()).toEqual({});
  });

  it('retains the gate for a correlated retryable failure', async () => {
    const rpc = vi.fn(async (_method: string, payload: Record<string, unknown>) => {
      throw new GatewayRpcError({
        message: 'filesystem outcome is unknown',
        details: {
          kind: 'lifecycle-mutation-failure',
          operationId: payload.operationId,
          key: payload.key,
          retryable: true,
        },
      });
    });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });
    expect((await api.archive({ id: 'agent:main:unknown' })).success).toBe(false);
    expect(Object.values(await readGates())).toHaveLength(1);
  });

  it('resumes the same archive operation after UI metadata changes', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('RPC timeout'))
      .mockImplementationOnce(async (_method: string, payload: Record<string, unknown>) => ({
        ok: true,
        key: payload.key,
        sessionId: 'generation-1',
        operationId: payload.operationId,
        journalState: 'runtime_committed',
        archived: true,
      }));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi({ gatewayManager: { rpc } as never });

    await api.archive({
      id: 'agent:main:metadata-retry',
      label: 'First label',
      originalWorkspaceId: 'workspace-a',
      originalFolderId: 'folder-a',
    });
    const retry = await api.archive({
      id: 'agent:main:metadata-retry',
      label: 'Changed label',
      originalWorkspaceId: 'workspace-b',
      originalFolderId: 'folder-b',
    });
    expect(retry.success).toBe(true);
    const firstOperationId = (rpc.mock.calls[0]?.[1] as { operationId: string }).operationId;
    const secondOperationId = (rpc.mock.calls[1]?.[1] as { operationId: string }).operationId;
    expect(secondOperationId).toBe(firstOperationId);
    expect(await readGates()).toEqual({});
  });
});
