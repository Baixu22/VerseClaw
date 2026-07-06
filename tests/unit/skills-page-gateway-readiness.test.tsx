import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Skills } from '@/pages/Skills';

const fetchSkillsMock = vi.fn();
const enableSkillMock = vi.fn();
const disableSkillMock = vi.fn();
const setSkillsEnabledMock = vi.fn();
const searchSkillsMock = vi.fn();
const installSkillMock = vi.fn();
const uninstallSkillMock = vi.fn();
const fetchSkillPacksMock = vi.fn();
const installSkillPackMock = vi.fn();
const setSkillPackEnabledMock = vi.fn();
const syncSkillPackMock = vi.fn();
const readSkillPackSkillMock = vi.fn();
const fetchMcpServersMock = vi.fn();
const createMcpServerMock = vi.fn();
const updateMcpServerMock = vi.fn();
const deleteMcpServerMock = vi.fn();
const testMcpServerMock = vi.fn();
const clawhubCapabilityMock = vi.fn();
const clawhubOpenSkillPathMock = vi.fn();
const officeToolsDetectMock = vi.fn();
const officeToolsInstallMock = vi.fn();
const officeToolsUninstallMock = vi.fn();
const officeToolsListSkillsMock = vi.fn();
const officeToolsSyncSkillsMock = vi.fn();
const officeToolsListAllSkillInstallStatusesMock = vi.fn();
const officeToolsApplySkillLinksMock = vi.fn();
const agentsListMock = vi.fn();
const openclawGetSkillsDirMock = vi.fn();
const shellOpenExternalMock = vi.fn();

const { gatewayState, skillsState, skillPacksState, mcpState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, gatewayReady: true } as {
      state: string;
      port: number;
      gatewayReady?: boolean;
    },
  },
  skillsState: {
    skills: [] as Array<Record<string, unknown>>,
  },
  skillPacksState: {
    packs: [] as Array<Record<string, unknown>>,
    loading: false,
    busy: {} as Record<string, boolean>,
    error: null as string | null,
  },
  mcpState: {
    servers: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    skills: skillsState.skills,
    loading: false,
    error: null,
    fetchSkills: fetchSkillsMock,
    enableSkill: enableSkillMock,
    disableSkill: disableSkillMock,
    setSkillsEnabled: setSkillsEnabledMock,
    searchResults: [],
    searchSkills: searchSkillsMock,
    installSkill: installSkillMock,
    uninstallSkill: uninstallSkillMock,
    searching: false,
    searchError: null,
    installing: {},
  }),
}));

vi.mock('@/stores/skill-packs', () => ({
  useSkillPacksStore: () => ({
    packs: skillPacksState.packs,
    loading: skillPacksState.loading,
    busy: skillPacksState.busy,
    error: skillPacksState.error,
    fetchPacks: fetchSkillPacksMock,
    installPack: installSkillPackMock,
    setPackEnabled: setSkillPackEnabledMock,
    syncPack: syncSkillPackMock,
    readSkill: readSkillPackSkillMock,
  }),
}));

vi.mock('@/stores/mcp', () => ({
  useMcpStore: () => ({
    servers: mcpState.servers,
    loading: false,
    error: null,
    fetchServers: fetchMcpServersMock,
    createServer: createMcpServerMock,
    updateServer: updateMcpServerMock,
    deleteServer: deleteMcpServerMock,
    testServer: testMcpServerMock,
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    openclaw: {
      getSkillsDir: () => openclawGetSkillsDirMock(),
    },
    shell: {
      openExternal: (...args: unknown[]) => shellOpenExternalMock(...args),
    },
    skills: {
      clawhubCapability: () => clawhubCapabilityMock(),
      clawhubOpenSkillPath: (...args: unknown[]) => clawhubOpenSkillPathMock(...args),
    },
    agents: {
      list: () => agentsListMock(),
    },
    officeTools: {
      detect: () => officeToolsDetectMock(),
      install: (...args: unknown[]) => officeToolsInstallMock(...args),
      uninstall: () => officeToolsUninstallMock(),
      listSkills: () => officeToolsListSkillsMock(),
      syncSkills: () => officeToolsSyncSkillsMock(),
      listAllSkillInstallStatuses: () => officeToolsListAllSkillInstallStatusesMock(),
      applySkillLinks: (...args: unknown[]) => officeToolsApplySkillLinksMock(...args),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onOfficeToolsInstallEvent: vi.fn(() => () => undefined),
  },
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: vi.fn(),
}));

vi.mock('@/extensions/registry', () => ({
  rendererExtensionRegistry: {
    getSkillDetailMetaComponents: () => [],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Skills page gateway readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    skillsState.skills = [];
    skillPacksState.packs = [
      {
        id: 'superpowers',
        name: 'Superpowers',
        description: 'Curated expert workflows',
        status: 'notInstalled',
        enabled: false,
        skills: [],
      },
      {
        id: 'officecli',
        name: 'Office CLI',
        description: 'Office document workflows',
        status: 'installed',
        enabled: false,
        skills: [{ id: 'officecli-docx', name: 'Word', description: 'Word documents', enabled: false, installed: true }],
      },
    ];
    skillPacksState.loading = false;
    skillPacksState.busy = {};
    skillPacksState.error = null;
    mcpState.servers = [];
    openclawGetSkillsDirMock.mockResolvedValue('/tmp/.openclaw/skills');
    shellOpenExternalMock.mockResolvedValue(undefined);
    clawhubCapabilityMock.mockResolvedValue({ success: true, capability: { canSearch: false, canInstall: false } });
    clawhubOpenSkillPathMock.mockResolvedValue({ success: true });
    officeToolsDetectMock.mockResolvedValue({
      installed: true,
      version: 'officecli 1.2.3',
      path: 'C:/tools/officecli.exe',
      runtimeError: null,
    });
    officeToolsInstallMock.mockResolvedValue({
      installed: true,
      version: 'officecli 1.2.3',
      path: 'C:/tools/officecli.exe',
      runtimeError: null,
    });
    officeToolsUninstallMock.mockResolvedValue({
      installed: false,
      version: null,
      path: null,
      runtimeError: null,
    });
    officeToolsListSkillsMock.mockResolvedValue([]);
    officeToolsSyncSkillsMock.mockResolvedValue({ synced: 1, errors: [] });
    agentsListMock.mockResolvedValue({
      success: true,
      agents: [
        {
          id: 'main',
          name: 'Main Agent',
          isDefault: true,
          modelDisplay: 'Not configured',
          inheritedModel: false,
          workspace: '/workspace',
          agentDir: '/agents/main',
          mainSessionKey: 'agent:main:main',
          channelTypes: [],
        },
      ],
    });
    officeToolsListAllSkillInstallStatusesMock.mockResolvedValue([
      {
        expertId: 'officecli-docx',
        skillId: 'officecli-docx',
        agentId: 'main',
        agentType: 'main',
        agentName: 'Main Agent',
        state: 'not_linked',
        linkPath: 'agent:main:defaultSkillIds',
        targetPath: null,
        expectedTargetPath: '/skills/officecli-docx',
        copyMode: false,
        installedCentrally: true,
      },
    ]);
    officeToolsApplySkillLinksMock.mockResolvedValue([]);
    fetchSkillsMock.mockResolvedValue(true);
    fetchSkillPacksMock.mockResolvedValue(undefined);
    installSkillPackMock.mockResolvedValue(undefined);
    setSkillPackEnabledMock.mockResolvedValue(undefined);
    syncSkillPackMock.mockResolvedValue(undefined);
    readSkillPackSkillMock.mockResolvedValue('---\nname: officecli-docx\n---\nWord skill');
    fetchMcpServersMock.mockResolvedValue(undefined);
    createMcpServerMock.mockResolvedValue(undefined);
    updateMcpServerMock.mockResolvedValue(undefined);
    deleteMcpServerMock.mockResolvedValue(undefined);
    testMcpServerMock.mockResolvedValue({ ok: true, message: 'ok' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps loading skills while gatewayReady is false and hides the banner once local skills fetch succeeds', async () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('skills-gateway-banner')).not.toBeInTheDocument();
  });

  it('keeps startup readiness feedback out of the Skills page banner', async () => {
    fetchSkillsMock.mockResolvedValue(false);
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('skills-gateway-banner')).not.toBeInTheDocument();
  });

  it('still fetches local skills when the gateway is stopped', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('actions.installSkill')).not.toBeInTheDocument();
  });

  it('filters the list via enabled and disabled buttons', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };
    skillsState.skills = [
      { id: 'pdf', name: 'PDF', description: 'enabled skill', enabled: true, source: 'openclaw-managed' },
      { id: 'xlsx', name: 'XLSX', description: 'disabled skill', enabled: false, source: 'openclaw-managed' },
    ];

    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('XLSX')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('skills-filter-enabled'));
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.queryByText('XLSX')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('skills-filter-disabled'));
    expect(screen.queryByText('PDF')).not.toBeInTheDocument();
    expect(screen.getByText('XLSX')).toBeInTheDocument();
  });

  it('shows manifest versions but still hides slug badges and hash-only preinstalled versions', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };
    skillsState.skills = [
      {
        id: 'self-improvement-agent',
        slug: 'self-improvement-agent',
        name: 'self-improvement',
        description: 'versionless local skill',
        enabled: true,
        source: 'openclaw-managed',
        baseDir: '/tmp/self-improvement',
      },
      {
        id: 'pdf',
        slug: 'pdf',
        name: 'pdf',
        description: 'placeholder version skill',
        enabled: true,
        version: '1.0.0',
        source: 'openclaw-managed',
        baseDir: '/tmp/pdf',
      },
      {
        id: 'docx',
        slug: 'docx',
        name: 'docx',
        description: 'hash version skill',
        enabled: true,
        source: 'openclaw-managed',
        baseDir: '/tmp/docx',
      },
      {
        id: 'custom-skill',
        slug: 'custom-skill',
        name: 'custom-skill',
        description: 'real version skill',
        enabled: true,
        version: '0.1.3',
        source: 'openclaw-managed',
        baseDir: '/tmp/custom-skill',
      },
    ];

    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(screen.queryByText('self-improvement-agent')).not.toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('v0.1.3')).toBeInTheDocument();

    fireEvent.click(screen.getByText('docx'));
    expect(screen.queryByText(/^v[a-f0-9]{40}$/i)).not.toBeInTheDocument();
  });

  it('does not show uninstall for plugin-provided skills', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };
    skillsState.skills = [
      { id: 'browser-automation', slug: 'browser-automation', name: 'Browser Automation', description: 'plugin skill', enabled: true, source: 'openclaw-plugin', baseDir: '/tmp/plugin-skill' },
    ];

    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    fireEvent.click(screen.getByText('Browser Automation'));
    expect(screen.queryByText('detail.uninstall')).not.toBeInTheDocument();
    expect(screen.getByText('detail.disable')).toBeInTheDocument();
  });

  it('opens the MCP services tab and registers a stdio service', async () => {
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    fireEvent.click(screen.getByRole('button', { name: 'mcp.tab' }));

    expect(screen.getByTestId('mcp-services-panel')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            'local-tools': {
              command: 'npx',
              args: ['@modelcontextprotocol/server-filesystem', 'C:\\workspace'],
              scope: 'global',
              enabled: true,
            },
          },
        }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'mcp.actions.register' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(createMcpServerMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'local-tools',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', 'C:\\workspace'],
      scope: 'global',
      enabled: true,
    }));
  });

  it('shows managed skill packs and routes pack actions through the skill packs store', async () => {
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    fireEvent.click(screen.getByRole('button', { name: 'packs.tab' }));

    expect(fetchSkillPacksMock).toHaveBeenCalled();
    expect(screen.getByTestId('skill-packs-panel')).toBeInTheDocument();
    expect(screen.getByTestId('skill-pack-card-superpowers')).toHaveTextContent('Superpowers');
    expect(screen.getByTestId('skill-pack-card-officecli')).toHaveTextContent('Office CLI');

    fireEvent.click(screen.getByTestId('skill-pack-install-superpowers'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(installSkillPackMock).toHaveBeenCalledWith('superpowers');

    fireEvent.click(screen.getByTestId('skill-pack-enable-officecli'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(setSkillPackEnabledMock).toHaveBeenCalledWith('officecli', true);
  });

  it('surfaces OfficeCLI detect diagnostics and partial sync recovery in skill packs', async () => {
    officeToolsDetectMock.mockResolvedValue({
      installed: true,
      version: 'officecli 1.2.3',
      path: 'C:/tools/officecli.exe',
      runtimeError: 'Missing libicu. Install ICU runtime libraries.',
    });
    officeToolsSyncSkillsMock.mockResolvedValue({
      synced: 8,
      errors: ['officecli-pptx: Missing libicu. Install ICU runtime libraries.'],
    });

    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    fireEvent.click(screen.getByRole('button', { name: 'packs.tab' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('officecli-detection-card')).toHaveTextContent('Missing libicu');
    expect(screen.getByTestId('officecli-detection-card')).toHaveTextContent('officecli 1.2.3');

    fireEvent.click(screen.getByTestId('skill-pack-sync-officecli'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(officeToolsSyncSkillsMock).toHaveBeenCalled();
    expect(screen.getByTestId('officecli-sync-report')).toHaveTextContent('officecli-pptx');
  });
});
