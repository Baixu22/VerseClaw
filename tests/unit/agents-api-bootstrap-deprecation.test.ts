// @vitest-environment node
// W6: BOOT.md is read/write deprecated without deleting existing user files.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readAgentBootstrapFile: vi.fn(async (_agentId: string, filename: string) => ({
    content: filename === 'SOUL.md' ? 'soul' : '',
    path: `C:/workspace/${filename}`,
  })),
  writeAgentBootstrapFile: vi.fn(async () => ({ path: 'C:/workspace/file.md' })),
  readAgentSoul: vi.fn(async () => ({ soulMd: 'soul', path: 'C:/workspace/SOUL.md' })),
  readAgentBootstrapTools: vi.fn(async () => ({ defaultSkillIds: [], defaultMcpServerIds: [] })),
  readAgentRoleProfile: vi.fn(async () => null),
  writeAgentBootstrapTools: vi.fn(async () => ({ defaultSkillIds: [], defaultMcpServerIds: [] })),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  listAgentsSnapshot: vi.fn(),
  removeAgentWorkspaceDirectory: vi.fn(),
  readAgentBootstrapFile: mocks.readAgentBootstrapFile,
  readAgentBootstrapTools: mocks.readAgentBootstrapTools,
  readAgentRoleProfile: mocks.readAgentRoleProfile,
  readAgentSoul: mocks.readAgentSoul,
  resolveAccountIdForAgent: vi.fn(),
  updateAgentModel: vi.fn(),
  updateAgentName: vi.fn(),
  updateAgentReasoningEffort: vi.fn(),
  updateAgentAvatar: vi.fn(),
  resetAgentAvatar: vi.fn(),
  writeAgentBootstrapFile: mocks.writeAgentBootstrapFile,
  writeAgentBootstrapTools: mocks.writeAgentBootstrapTools,
  writeAgentRoleProfile: vi.fn(),
  writeAgentSoul: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAgentModelOverrideToRuntime: vi.fn(),
  syncAllProviderAuthToRuntime: vi.fn(),
}));

vi.mock('@electron/services/mcp-api', () => ({
  syncAgentMcpExposureToOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  deleteChannelAccountConfig: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-workspace', () => ({
  ensureVerseClawContext: vi.fn(),
}));

import { createAgentsApi } from '@electron/services/agents-api';

function makeApi() {
  return createAgentsApi({
    gatewayManager: { getStatus: () => ({ state: 'stopped' }) } as never,
  });
}

describe('BOOT.md deprecation compatibility window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getBootstrap no longer reads BOOT.md and returns explicit deprecation metadata', async () => {
    const result = await makeApi().getBootstrap({ id: 'main' });
    expect(result.success).toBe(true);
    expect(result.bootMd).toBe('');
    expect(result.bootMdPath).toBe('');
    expect(result.bootDeprecated).toEqual({
      supported: false,
      code: 'BOOT_MD_DEPRECATED',
      message: expect.stringContaining('export/migration requires explicit user confirmation'),
    });
    const filesRead = mocks.readAgentBootstrapFile.mock.calls.map((call) => call[1]);
    expect(filesRead).not.toContain('BOOT.md');
  });

  it('updateBootstrap rejects BOOT.md writes without deleting or touching existing files', async () => {
    const result = await makeApi().updateBootstrap({
      id: 'main',
      bootMd: 'new boot content',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('BOOT.md writes are deprecated');
    expect(result.bootDeprecated?.code).toBe('BOOT_MD_DEPRECATED');
    expect(mocks.writeAgentBootstrapFile).not.toHaveBeenCalled();
  });
});
