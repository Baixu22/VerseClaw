import { mkdtemp, symlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => join(tmpdir(), 'clawx-user-data-mock')),
  },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })) },
}));

vi.mock('electron-store', () => {
  class MockStore {
    get() { return []; }
    set() {}
  }
  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
}));

function workspace(rootPath: string): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath,
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

describe('workspace junction write escape (P1-003 / F-SEC-006)', () => {
  beforeEach(() => {
    activeWorkspace.profile = null;
  });

  it('denies writes that realpath outside workspace via symlink/junction', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-junc-ws-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-junc-out-'));
    const outsideFile = join(outsideDir, 'escape.txt');
    await writeFile(outsideFile, 'old', 'utf8');

    const linkPath = join(workspaceDir, 'escape-link');
    try {
      await symlink(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      // Windows may require elevation for some link types; skip if unsupported.
      console.warn('symlink/junction unsupported in this environment', error);
      return;
    }

    activeWorkspace.profile = workspace(workspaceDir);
    const { createFilesApi } = await import('@electron/services/files-api');
    const api = createFilesApi();
    const target = join(linkPath, 'escape.txt');
    const result = await api.writeText({ path: target, content: 'pwned' });
    expect(result.ok).toBe(false);
    expect(['approvalRequired', 'permissionDenied', 'adsPath', 'unsafePath', 'outsideSandbox']).toContain(
      (result as { error?: string }).error,
    );
    const body = await readFile(outsideFile, 'utf8');
    expect(body).toBe('old');
  });
});
