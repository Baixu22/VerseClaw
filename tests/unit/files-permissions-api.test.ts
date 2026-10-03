import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

vi.mock('@electron/services/permissions-api', async () => {
  const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
  return permissionsApiTestDouble.module();
});

vi.mock('../../electron/services/permissions-api', async () => {
  const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
  return permissionsApiTestDouble.module();
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => join(tmpdir(), 'clawx-user-data-mock')),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
    })),
  },
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[]; decisionEvents?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
      if (storeState.decisionEvents.length === 0 && options?.defaults?.decisionEvents) {
        storeState.decisionEvents = [...options.defaults.decisionEvents];
      }
    }

    get(key: string) {
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') {
        storeState.approvals = Array.isArray(value) ? [...value] : [];
      }
      if (key === 'decisionEvents') {
        storeState.decisionEvents = Array.isArray(value) ? [...value] : [];
      }
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('../../electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => join(tmpdir(), 'clawx-openclaw-config-mock'),
}));

vi.mock('../../electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => join(tmpdir(), 'clawx-openclaw-config-mock'),
}));

function workspace(rootPath: string, permissionMode: WorkspaceProfile['permissionMode'] = 'acceptEdits'): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath,
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

describe('files api permission approval flow', () => {
  beforeEach(async () => {
    storeState.approvals = [];
    storeState.decisionEvents = [];
    const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
    permissionsApiTestDouble.reset();
    activeWorkspace.profile = null;
  });

  it('returns an approval event for workspace-external writes and consumes it once', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-workspace-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-outside-'));
    const filePath = join(outsideDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createPermissionsApi } = await import('../../electron/services/permissions-api');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();
    const permissions = createPermissionsApi();

    const first = await api.writeText({ path: filePath, content: 'new' });
    expect(first).toMatchObject({
      ok: false,
      error: 'approvalRequired',
      approvalRequired: true,
      approval: {
        source: 'file',
        paths: [filePath],
      },
    });

    const approvalId = first.approval?.id;
    expect(approvalId).toBeTruthy();
    await permissions.decideApproval({ id: approvalId, decision: 'approved' } as never);

    await expect(api.writeText({ path: filePath, content: 'new', approvalId })).resolves.toMatchObject({
      ok: true,
    });

    await expect(api.writeText({ path: filePath, content: 'new', approvalId })).resolves.toMatchObject({
      ok: false,
      error: 'approvalRequired',
    });
  });

  it('blocks writes outright in plan mode', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-workspace-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir, 'plan');

    const { listPermissionDecisionEvents } = await import('../../electron/services/permissions-api');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();

    await expect(api.writeText({ path: filePath, content: 'new' })).resolves.toMatchObject({
      ok: false,
      error: 'permissionDenied',
    });
    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'permission-decision',
        workspaceMode: 'plan',
        tool: 'files.writeText',
        boundary: 'user-file',
        decision: 'deny',
      }),
    ]));
  });

  it('P2-001: readOnly default blocks files.writeText without silent acceptEdits', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-ws-ro-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir, 'readOnly');

    const { listPermissionDecisionEvents } = await import('../../electron/services/permissions-api');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();

    await expect(api.writeText({ path: filePath, content: 'new' })).resolves.toMatchObject({
      ok: false,
      error: 'permissionDenied',
    });
    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceMode: 'readOnly',
        tool: 'files.writeText',
        decision: 'deny',
      }),
    ]));
  });
});

describe('files api read allowlist (P1-003)', () => {
  it('rejects arbitrary local path reads outside workspace and write roots', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-ws-read-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-out-read-'));
    const secretPath = join(outsideDir, 'secret.txt');
    await writeFile(secretPath, 'top-secret', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();
    const result = await api.readText({ path: secretPath });
    expect(result).toMatchObject({ ok: false, error: 'outsideSandbox' });
  });

  it('allows reading files inside the active workspace', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-ws-in-'));
    const filePath = join(workspaceDir, 'note.txt');
    await writeFile(filePath, 'hello', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createFilesApi } = await import('../../electron/services/files-api');
    const api = createFilesApi();
    const result = await api.readText({ path: filePath });
    expect(result).toMatchObject({ ok: true, content: 'hello' });
  });
});
