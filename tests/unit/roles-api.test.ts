import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
  return {
    testHome: `${root}/clawx-roles-api-${suffix}`,
    testUserData: `${root}/clawx-roles-api-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('roles host API', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('creates a config-backed role in agents.roles', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    const result = await rolesApi.upsertConfigRole({
      name: 'research-helper',
      displayName: 'Research Helper',
      description: 'Collects bounded context.',
      rolePrompt: 'Help review sources and report uncertainty.',
      tools: ['read', 'search'],
      effort: 'medium',
      permissions: {
        filesystem: 'read',
        network: 'limited',
        commands: [],
      },
      tags: ['research', 'review'],
    });

    expect(result).toMatchObject({
      success: true,
      role: {
        name: 'research-helper',
        displayName: 'Research Helper',
        origin: 'config',
      },
      pendingRuntimeRefresh: true,
    });

    const config = await readOpenClawJson();
    expect(config).toMatchObject({
      agents: {
        roles: [
          expect.objectContaining({
            name: 'research-helper',
            displayName: 'Research Helper',
            rolePrompt: 'Help review sources and report uncertainty.',
            tools: ['read', 'search'],
            effort: 'medium',
            permissions: {
              filesystem: 'read',
              network: 'limited',
              commands: [],
            },
            tags: ['research', 'review'],
          }),
        ],
      },
    });
  });

  it('edits an existing config role without duplicating it', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    await rolesApi.upsertConfigRole({
      name: 'research-helper',
      displayName: 'Research Helper',
      rolePrompt: 'Initial prompt.',
      tools: [],
      effort: 'low',
      permissions: { filesystem: 'read', network: 'none', commands: [] },
      tags: [],
    });
    const result = await rolesApi.upsertConfigRole({
      name: 'research-helper',
      displayName: 'Research Helper Updated',
      rolePrompt: 'Updated prompt.',
      tools: ['read'],
      effort: 'high',
      permissions: { filesystem: 'write', network: 'limited', commands: ['pnpm test'] },
      tags: ['updated'],
    });

    expect(result.role.displayName).toBe('Research Helper Updated');
    const config = await readOpenClawJson();
    const roles = ((config.agents as Record<string, unknown>).roles ?? []) as Array<Record<string, unknown>>;
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      name: 'research-helper',
      displayName: 'Research Helper Updated',
      rolePrompt: 'Updated prompt.',
      effort: 'high',
      tags: ['updated'],
    });
  });

  it('rejects invalid role payloads before writing config', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    await expect(rolesApi.upsertConfigRole({
      name: 'Bad Name',
      displayName: 'Bad',
      rolePrompt: 'Prompt',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('Role name must match');

    await expect(rolesApi.upsertConfigRole({
      name: 'valid-role',
      displayName: '',
      rolePrompt: 'Prompt',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('displayName is required');

    await expect(rolesApi.upsertConfigRole({
      name: 'valid-role',
      displayName: 'Valid',
      rolePrompt: '',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('rolePrompt is required');

    await expect(rolesApi.upsertConfigRole({
      name: 'valid-role',
      displayName: 'Valid',
      rolePrompt: 'Prompt',
      tools: [],
      effort: 'xhigh',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('effort must be one of');
  });

  it('does not allow a config role to overwrite a built-in role', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    await expect(rolesApi.upsertConfigRole({
      name: 'architect',
      displayName: 'Architect Override',
      rolePrompt: 'Override built-in.',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('Cannot overwrite built-in role');
  });
});
