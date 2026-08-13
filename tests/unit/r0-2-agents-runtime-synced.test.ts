// @vitest-environment node
// R0-2: agents.updateModel must flag runtimeSync failures explicitly
// (runtimeSynced:false + warning) instead of returning a plain success.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentsSnapshot } from '@shared/types/agent';

const mocks = vi.hoisted(() => ({
  updateAgentModel: vi.fn(),
  syncAllProviderAuthToRuntime: vi.fn(),
  syncAgentModelOverrideToRuntime: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  listAgentsSnapshot: vi.fn(),
  removeAgentWorkspaceDirectory: vi.fn(),
  readAgentBootstrapFile: vi.fn(),
  readAgentBootstrapTools: vi.fn(),
  readAgentRoleProfile: vi.fn(),
  readAgentSoul: vi.fn(),
  resolveAccountIdForAgent: vi.fn(),
  updateAgentModel: mocks.updateAgentModel,
  updateAgentName: vi.fn(),
  updateAgentReasoningEffort: vi.fn(),
  updateAgentAvatar: vi.fn(),
  resetAgentAvatar: vi.fn(),
  writeAgentBootstrapFile: vi.fn(),
  writeAgentBootstrapTools: vi.fn(),
  writeAgentRoleProfile: vi.fn(),
  writeAgentSoul: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAgentModelOverrideToRuntime: mocks.syncAgentModelOverrideToRuntime,
  syncAllProviderAuthToRuntime: mocks.syncAllProviderAuthToRuntime,
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

const snapshot: AgentsSnapshot = {
  agents: [],
  defaultAgentId: 'main',
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
};

describe('R0-2 agents.updateModel runtime sync flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAgentModel.mockResolvedValue(snapshot);
    mocks.syncAllProviderAuthToRuntime.mockResolvedValue(undefined);
    mocks.syncAgentModelOverrideToRuntime.mockResolvedValue(undefined);
  });

  it('returns runtimeSynced:true when the runtime sync succeeds', async () => {
    const api = createAgentsApi({ gatewayManager: { getStatus: () => ({ state: 'stopped' }) } as never });

    const result = await api.updateModel({ id: 'main', modelRef: 'openai/gpt-5.5' });

    expect(result.success).toBe(true);
    expect(result.runtimeSynced).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(mocks.updateAgentModel).toHaveBeenCalledWith('main', 'openai/gpt-5.5');
    expect(mocks.syncAllProviderAuthToRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.syncAgentModelOverrideToRuntime).toHaveBeenCalledWith('main');
  });

  it('returns success with runtimeSynced:false and a warning when the sync fails', async () => {
    mocks.syncAllProviderAuthToRuntime.mockRejectedValue(new Error('models.json busy'));
    const api = createAgentsApi({ gatewayManager: { getStatus: () => ({ state: 'stopped' }) } as never });

    const result = await api.updateModel({ id: 'main', modelRef: 'openai/gpt-5.5' });

    expect(result.success).toBe(true);
    expect(result.runtimeSynced).toBe(false);
    expect(result.warning).toContain('runtime sync failed');
    expect(result.warning).toContain('models.json busy');
  });
});
