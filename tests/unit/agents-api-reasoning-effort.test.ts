// @vitest-environment node
// R1-01: agents.updateReasoningEffort must accept every AgentReasoningEffort
// value exposed by shared/types/agent.ts, including `max`, and reject unknown
// values before touching agent config.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentsSnapshot, AgentReasoningEffort } from '@shared/types/agent';

const mocks = vi.hoisted(() => ({
  updateAgentReasoningEffort: vi.fn(),
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
  updateAgentModel: vi.fn(),
  updateAgentName: vi.fn(),
  updateAgentReasoningEffort: mocks.updateAgentReasoningEffort,
  updateAgentAvatar: vi.fn(),
  resetAgentAvatar: vi.fn(),
  writeAgentBootstrapFile: vi.fn(),
  writeAgentBootstrapTools: vi.fn(),
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

const snapshot: AgentsSnapshot = {
  agents: [],
  defaultAgentId: 'main',
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
};

const VALID_EFFORTS: ReadonlyArray<AgentReasoningEffort> = [
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

describe('agents-api reasoning effort validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAgentReasoningEffort.mockResolvedValue(snapshot);
  });

  it.each(VALID_EFFORTS)('persists supported reasoning effort %s', async (effort) => {
    const api = createAgentsApi({
      gatewayManager: { getStatus: () => ({ state: 'stopped' }) } as never,
    });

    await expect(api.updateReasoningEffort({ id: 'main', reasoningEffort: effort })).resolves.toMatchObject({
      success: true,
    });
    expect(mocks.updateAgentReasoningEffort).toHaveBeenCalledWith('main', effort);
  });

  it('rejects unsupported reasoning effort values without calling config writer', async () => {
    const api = createAgentsApi({
      gatewayManager: { getStatus: () => ({ state: 'stopped' }) } as never,
    });

    await expect(
      api.updateReasoningEffort({ id: 'main', reasoningEffort: 'ultra' as AgentReasoningEffort }),
    ).rejects.toThrow('reasoningEffort is invalid');
    expect(mocks.updateAgentReasoningEffort).not.toHaveBeenCalled();
  });

  it('rejects missing or empty reasoning effort values', async () => {
    const api = createAgentsApi({
      gatewayManager: { getStatus: () => ({ state: 'stopped' }) } as never,
    });

    await expect(api.updateReasoningEffort({ id: 'main' } as never)).rejects.toThrow(
      'reasoningEffort is invalid',
    );
    await expect(
      api.updateReasoningEffort({ id: 'main', reasoningEffort: '  ' as AgentReasoningEffort }),
    ).rejects.toThrow('reasoningEffort is invalid');
    expect(mocks.updateAgentReasoningEffort).not.toHaveBeenCalled();
  });
});
