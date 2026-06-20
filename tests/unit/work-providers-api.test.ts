// @vitest-environment node

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const {
  getActiveWorkspaceProfileMock,
  getSettingMock,
} = vi.hoisted(() => ({
  getActiveWorkspaceProfileMock: vi.fn(),
  getSettingMock: vi.fn(),
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: (...args: unknown[]) => getActiveWorkspaceProfileMock(...args),
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

function makeWorkspace(rootPath: string): WorkspaceProfile {
  return {
    id: 'workspace',
    name: 'Workspace',
    rootPath,
    agentId: 'main',
    activeSessionKey: 'main:workspace',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

describe('work providers api', () => {
  let workspaceRoot: string;
  let outsideRoot: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    workspaceRoot = resolve(join(tmpdir(), `clawx-work-provider-${Date.now()}-${Math.random().toString(16).slice(2)}`));
    outsideRoot = resolve(join(tmpdir(), `clawx-work-provider-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`));
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    getSettingMock.mockResolvedValue({});
    getActiveWorkspaceProfileMock.mockResolvedValue(makeWorkspace(workspaceRoot));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });

  it('reports search as missingConfig without issuing network requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { createWorkProvidersApi } = await import('@electron/services/work-providers-api');

    const status = await createWorkProvidersApi().status();
    const search = status.capabilities.find((capability) => capability.capability === 'web.search');

    expect(search).toMatchObject({
      providerId: 'web-search-configured',
      status: 'missingConfig',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps web.search blocked when no provider config exists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { createWorkProvidersApi } = await import('@electron/services/work-providers-api');

    const result = await createWorkProvidersApi().run({
      capability: 'web.search',
      input: { query: 'office providers' },
    });

    expect(result).toMatchObject({ success: false, error: 'missingConfig' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts a user-provided HTML source without search networking', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { createWorkProvidersApi } = await import('@electron/services/work-providers-api');

    const result = await createWorkProvidersApi().run({
      capability: 'web.extract',
      input: {
        html: '<html><head><title>Quarterly Notes</title></head><body><article><h1>Quarterly Notes</h1><p>Revenue grew 12 percent.</p></article></body></html>',
        title: 'Quarterly Notes',
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      kind: 'sourceBundle',
      title: 'Quarterly Notes',
    });
    expect(String(result.output?.markdown)).toContain('Revenue grew 12 percent');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs CSV read and validates artifacts only inside the active workspace', async () => {
    const csvPath = join(workspaceRoot, 'data.csv');
    const markdownPath = join(workspaceRoot, 'brief.md');
    const outsidePath = join(outsideRoot, 'outside.md');
    writeFileSync(csvPath, 'name,value\nalpha,1\nbeta,2\n');
    writeFileSync(markdownPath, '# Brief\n\nReady.\n');
    writeFileSync(outsidePath, '# Outside\n');
    const { createWorkProvidersApi } = await import('@electron/services/work-providers-api');
    const api = createWorkProvidersApi();

    await expect(api.run({
      capability: 'csv.read',
      input: { path: csvPath },
    })).resolves.toMatchObject({
      success: true,
      output: {
        kind: 'csv',
        rowCount: 3,
      },
    });

    await expect(api.validateArtifact({ path: markdownPath })).resolves.toMatchObject({
      success: true,
      artifactType: 'md',
      valid: true,
      previewAvailable: true,
    });

    await expect(api.validateArtifact({ path: outsidePath })).resolves.toMatchObject({
      success: false,
      error: 'outsideSandbox',
    });
  });
});
