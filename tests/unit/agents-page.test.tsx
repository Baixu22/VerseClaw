import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const capabilitiesPublicationsMock = vi.fn();
const mcpHeartbeatMock = vi.fn();
const mcpListToolsMock = vi.fn();
const mcpReloadRuntimeMock = vi.fn();
const fetchSkillsMock = vi.fn();
const fetchMcpServersMock = vi.fn();

const { gatewayState, agentsState, providersState, skillsState, mcpState, translate } = vi.hoisted(() => ({
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
  translate: (key: string) => key,
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
    capabilities: {
      publications: (...args: unknown[]) => capabilitiesPublicationsMock(...args),
    },
    mcp: {
      heartbeat: (...args: unknown[]) => mcpHeartbeatMock(...args),
      listTools: (...args: unknown[]) => mcpListToolsMock(...args),
      reloadRuntime: (...args: unknown[]) => mcpReloadRuntimeMock(...args),
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
    t: translate,
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
    mcpHeartbeatMock.mockResolvedValue({ success: true, serverId: 'filesystem', status: 'connected', message: 'ok', latencyMs: 1 });
    mcpListToolsMock.mockResolvedValue({ success: true, serverId: 'filesystem', status: 'connected', tools: [{ name: 'read_file' }] });
    mcpReloadRuntimeMock.mockResolvedValue({ success: true, serverCount: 1, hotReloaded: true, restartRequired: false, message: 'reloaded' });
    capabilitiesPublicationsMock.mockResolvedValue({
      success: true,
      source: 'gateway',
      generatedAt: '2026-01-01T00:00:00.000Z',
      publications: [],
      diagnostics: [],
    });
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

  it('loads publication candidates and stages selected capabilities into the bootstrap save payload', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: 'C:\\Users\\27933\\Desktop\\project',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    capabilitiesPublicationsMock.mockResolvedValue({
      success: true,
      source: 'gateway',
      generatedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [],
      publications: [
        {
          id: 'skill:create-skill',
          kind: 'skill',
          sourceId: 'create-skill',
          name: 'create-skill',
          owner: { type: 'agent', id: 'main' },
          scope: 'agent',
          source: 'local',
          state: 'available',
          exposure: { runtimeVisible: false, promptVisible: false, userInvocable: false },
          useModes: ['adminAction'],
          runtime: { status: 'cold', method: 'prompt', source: 'gateway' },
          reasons: ['agent-skill-candidate'],
          diagnostics: [],
          skillId: 'create-skill',
        },
      ],
    });

    renderAgents();

    expect(await screen.findByText('Main')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('settings'));

    const panel = await screen.findByTestId('agent-capability-workbench');
    await waitFor(() => {
      expect(capabilitiesPublicationsMock).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'main',
        workspaceId: 'C:\\Users\\27933\\Desktop\\project',
        includeDiagnostics: true,
        includeCandidates: true,
        includeToolCatalog: 'warmOnly',
      }));
    });

    const row = await within(panel).findByTestId('agent-capability-row-skill-create-skill');
    fireEvent.click(within(row).getByRole('button', { name: /identityTools\.publication\.add/ }));

    expect(screen.getByText('identityTools.publication.pendingSummary')).toBeInTheDocument();

    const applyButton = screen.getByRole('button', { name: 'identityTools.publication.apply' });
    await waitFor(() => {
      expect(applyButton).toBeEnabled();
    });
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(updateAgentBootstrapMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'main',
        defaultSkillIds: ['create-skill'],
      }));
    });
  });

  it('keeps advanced capability IDs in sync with the workbench draft', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: 'C:\\Users\\27933\\Desktop\\project',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    capabilitiesPublicationsMock.mockResolvedValue({
      success: true,
      source: 'gateway',
      generatedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [],
      publications: [
        {
          id: 'mcp:filesystem',
          kind: 'mcp',
          sourceId: 'filesystem',
          name: 'Filesystem',
          owner: { type: 'agent', id: 'main' },
          scope: 'agent',
          source: 'registered',
          state: 'available',
          exposure: { runtimeVisible: false, toolVisible: false },
          useModes: ['adminAction'],
          runtime: { status: 'cold', method: 'tool', source: 'gateway' },
          reasons: ['mcp-candidate'],
          diagnostics: [],
          serverId: 'filesystem',
        },
      ],
    });

    renderAgents();
    expect(await screen.findByText('Main')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('settings'));
    await screen.findByTestId('agent-capability-workbench');

    fireEvent.click(screen.getByText('identityTools.publication.advancedIds'));
    fireEvent.change(screen.getByLabelText('identityTools.defaultMcpIds'), { target: { value: 'filesystem' } });

    const row = await screen.findByTestId('agent-capability-row-mcp-filesystem');
    expect(within(row).getByRole('button', { name: /identityTools\.publication\.remove/ })).toBeEnabled();

    const applyButton = screen.getByRole('button', { name: 'identityTools.publication.apply' });
    await waitFor(() => expect(applyButton).toBeEnabled());
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(updateAgentBootstrapMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'main',
        defaultMcpServerIds: ['filesystem'],
      }));
    });
  });

  it('passes roleName only when the role policy preview is filled', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: 'C:\\Users\\27933\\Desktop\\project',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderAgents();
    expect(await screen.findByText('Main')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('settings'));
    await screen.findByTestId('agent-capability-workbench');

    expect(capabilitiesPublicationsMock.mock.calls.some(([payload]) => (
      typeof payload === 'object' && payload !== null && 'roleName' in payload
    ))).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('identityTools.publication.rolePreviewPlaceholder'), {
      target: { value: 'reviewer' },
    });

    await waitFor(() => {
      expect(capabilitiesPublicationsMock).toHaveBeenCalledWith(expect.objectContaining({ roleName: 'reviewer' }));
    });
  });

  it('blocks adding role-blocked capabilities and shows detail diagnostics', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: 'C:\\Users\\27933\\Desktop\\project',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    capabilitiesPublicationsMock.mockResolvedValue({
      success: true,
      source: 'gateway',
      generatedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [],
      publications: [
        {
          id: 'mcp:danger',
          kind: 'mcp',
          sourceId: 'danger',
          name: 'Danger MCP',
          owner: { type: 'agent', id: 'main' },
          scope: 'agent',
          source: 'registered',
          state: 'blocked',
          exposure: { runtimeVisible: false, toolVisible: false },
          useModes: ['adminAction'],
          runtime: { status: 'blocked', method: 'tool', source: 'gateway' },
          reasons: ['role-policy'],
          diagnostics: [{ code: 'roleToolsFilter', severity: 'blocked', message: 'blocked by role' }],
          serverId: 'danger',
        },
      ],
    });

    renderAgents();
    expect(await screen.findByText('Main')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('settings'));

    const row = await screen.findByTestId('agent-capability-row-mcp-danger');
    expect(within(row).getByRole('button', { name: /identityTools\.publication\.blocked/ })).toBeDisabled();
    fireEvent.click(within(row).getByLabelText('identityTools.publication.detail.open'));

    expect(await screen.findByText('roleToolsFilter')).toBeInTheDocument();
    expect(screen.getByText('blocked by role')).toBeInTheDocument();
  });

  it('shows local fallback publication state when runtime is unavailable', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: 'C:\\Users\\27933\\Desktop\\project',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    capabilitiesPublicationsMock.mockResolvedValue({
      success: true,
      source: 'local-fallback',
      generatedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [{ code: 'runtimeUnavailable', severity: 'warning', message: 'Runtime unavailable' }],
      publications: [],
    });

    renderAgents();
    expect(await screen.findByText('Main')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('settings'));

    expect(await screen.findByText('identityTools.publication.sourceFallback')).toBeInTheDocument();
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
