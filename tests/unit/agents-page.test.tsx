import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agents } from '../../src/pages/Agents/index';
import { TooltipProvider } from '../../src/components/ui/tooltip';

const channelsAccountsMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const fetchAgentsMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentModelMock = vi.fn();
const refreshProviderSnapshotMock = vi.fn();
const getAgentBootstrapMock = vi.fn();
const updateAgentBootstrapMock = vi.fn();
const fetchSkillsMock = vi.fn();
const fetchMcpServersMock = vi.fn();

const { gatewayState, agentsState, providersState, skillsState, mcpState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    loading: false,
    error: null as string | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: '' as string,
  },
  skillsState: {
    skills: [] as Array<Record<string, unknown>>,
  },
  mcpState: {
    servers: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: typeof agentsState & {
    fetchAgents: typeof fetchAgentsMock;
    updateAgent: typeof updateAgentMock;
    updateAgentModel: typeof updateAgentModelMock;
    createAgent: ReturnType<typeof vi.fn>;
    deleteAgent: ReturnType<typeof vi.fn>;
  }) => unknown) => {
    const state = {
      ...agentsState,
      fetchAgents: fetchAgentsMock,
      updateAgent: updateAgentMock,
      updateAgentModel: updateAgentModelMock,
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState & {
    refreshProviderSnapshot: typeof refreshProviderSnapshotMock;
  }) => unknown) => {
    const state = {
      ...providersState,
      refreshProviderSnapshot: refreshProviderSnapshotMock,
    };
    return selector(state);
  },
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector?: (state: typeof skillsState & {
    fetchSkills: typeof fetchSkillsMock;
  }) => unknown) => {
    const state = {
      ...skillsState,
      fetchSkills: fetchSkillsMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/mcp', () => ({
  useMcpStore: (selector?: (state: typeof mcpState & {
    fetchServers: typeof fetchMcpServersMock;
  }) => unknown) => {
    const state = {
      ...mcpState,
      fetchServers: fetchMcpServersMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agents: {
      getBootstrap: (...args: unknown[]) => getAgentBootstrapMock(...args),
      updateBootstrap: (...args: unknown[]) => updateAgentBootstrapMock(...args),
    },
    channels: {
      accounts: (...args: unknown[]) => channelsAccountsMock(...args),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayChannelStatus: (handler: unknown) => subscribeHostEventMock('gateway:channel-status', handler),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderAgents() {
  return render(<Agents />, {
    wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
  });
}

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Agents page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = '';
    skillsState.skills = [];
    mcpState.servers = [];
    fetchAgentsMock.mockResolvedValue(undefined);
    updateAgentMock.mockResolvedValue(undefined);
    updateAgentModelMock.mockResolvedValue(undefined);
    refreshProviderSnapshotMock.mockResolvedValue(undefined);
    fetchSkillsMock.mockResolvedValue(undefined);
    fetchMcpServersMock.mockResolvedValue(undefined);
    getAgentBootstrapMock.mockResolvedValue({
      success: true,
      id: 'main',
      soulMd: '',
      bootstrapPath: 'C:\\Users\\27933\\.openclaw\\agents\\main\\agent\\SOUL.md',
      defaultSkillIds: [],
      defaultMcpServerIds: [],
    });
    updateAgentBootstrapMock.mockImplementation(async (payload: {
      id: string;
      soulMd?: string;
      defaultSkillIds?: string[];
      defaultMcpServerIds?: string[];
    }) => ({
      success: true,
      id: payload.id,
      soulMd: payload.soulMd ?? '',
      bootstrapPath: 'C:\\Users\\27933\\.openclaw\\agents\\main\\agent\\SOUL.md',
      defaultSkillIds: payload.defaultSkillIds ?? [],
      defaultMcpServerIds: payload.defaultMcpServerIds ?? [],
    }));
    channelsAccountsMock.mockResolvedValue({
      success: true,
      channels: [],
    });
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    renderAgents();

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(channelsAccountsMock).toHaveBeenCalledWith();
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      expect(channelsAccountsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('refetches channel accounts when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = renderAgents();

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(channelsAccountsMock).toHaveBeenCalledWith();
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Agents />);
    });

    await waitFor(() => {
      expect(channelsAccountsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not render the legacy gateway warning during transient stopped status', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };

    renderAgents();

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText('gatewayWarning')).not.toBeInTheDocument();
  });

  it('uses "Use default model" as form fill only and disables it when already default', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      { id: 'openrouter', name: 'OpenRouter', modelIdPlaceholder: 'anthropic/claude-opus-4.6' },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    renderAgents();

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTitle('settings'));
    fireEvent.click(screen.getByText('settingsDialog.modelLabel').closest('button') as HTMLButtonElement);

    const useDefaultButton = await screen.findByRole('button', { name: 'settingsDialog.useDefaultModel' });
    const modelIdInput = screen.getByLabelText('settingsDialog.modelIdLabel');
    const saveButton = screen.getByRole('button', { name: 'common:actions.save' });

    expect(useDefaultButton).toBeDisabled();

    fireEvent.change(modelIdInput, { target: { value: 'anthropic/claude-sonnet-4.5' } });
    expect(useDefaultButton).toBeEnabled();
    expect(saveButton).toBeEnabled();

    fireEvent.click(useDefaultButton);

    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect((modelIdInput as HTMLInputElement).value).toBe('anthropic/claude-opus-4.6');
    expect(useDefaultButton).toBeDisabled();
  });

  it('keeps the last agent snapshot visible while a refresh is in flight', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    const { rerender } = renderAgents();

    expect(await screen.findByText('Main')).toBeInTheDocument();

    agentsState.loading = true;
    await act(async () => {
      rerender(<Agents />);
    });

    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the blocking spinner during the initial load before any stable snapshot exists', async () => {
    agentsState.loading = true;
    fetchAgentsMock.mockImplementation(() => new Promise(() => {}));
    refreshProviderSnapshotMock.mockImplementation(() => new Promise(() => {}));
    channelsAccountsMock.mockImplementation(() => new Promise(() => {}));

    const { container } = renderAgents();

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
    expect(screen.queryByText('title')).not.toBeInTheDocument();
  });
});
