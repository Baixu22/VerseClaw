import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
}));

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
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
    constructor(options?: { defaults?: { approvals?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
    }

    get(key: string) {
      return key === 'approvals' ? storeState.approvals : undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') {
        storeState.approvals = Array.isArray(value) ? [...value] : [];
      }
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
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
  beforeEach(() => {
    storeState.approvals = [];
    activeWorkspace.profile = null;
  });

  it('returns an approval event for workspace-external writes and consumes it once', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-workspace-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-outside-'));
    const filePath = join(outsideDir, 'note.txt');
    await writeFile(filePath, 'old', 'utf8');
    activeWorkspace.profile = workspace(workspaceDir);

    const { createFilesApi } = await import('@electron/services/files-api');
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
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
    await permissions.decideApproval({ id: approvalId, decision: 'approved' });

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

    const { createFilesApi } = await import('@electron/services/files-api');
    const api = createFilesApi();

    await expect(api.writeText({ path: filePath, content: 'new' })).resolves.toMatchObject({
      ok: false,
      error: 'permissionDenied',
    });
  });
});
