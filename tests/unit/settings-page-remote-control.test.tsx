import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '@/pages/Settings';

const remoteControlStatusMock = vi.fn();
const remoteControlInspectMock = vi.fn();
const remoteControlPageInfoMock = vi.fn();
const remoteControlScrollMock = vi.fn();
const remoteControlClickMock = vi.fn();
const remoteControlScreenshotMock = vi.fn();
const settingsSetManyMock = vi.fn();
const gatewayRestartMock = vi.fn();
const setRoleMemoryEnabledMock = vi.fn();
const setWorkModeToolBundlesMock = vi.fn();
const setWorkModeKitsMock = vi.fn();
const saveWorkspaceStateMock = vi.fn();
const sandboxStatusMock = vi.fn();
const sandboxUpdateProfileMock = vi.fn();

const { settingsState, gatewayState } = vi.hoisted(() => ({
  settingsState: {
    theme: 'system',
    language: 'zh',
    launchAtStartup: false,
    gatewayAutoStart: true,
    roleMemoryEnabled: true,
    cdpRemoteControlEnabled: false,
    cdpRemoteDebuggingPort: 9222,
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '',
    devModeUnlocked: false,
    telemetryEnabled: false,
    workModeToolBundles: {},
    workModeKits: {},
  },
  gatewayState: {
    status: { state: 'stopped', port: 18789 },
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    ...settingsState,
    setTheme: vi.fn(),
    setLanguage: vi.fn(),
    setLaunchAtStartup: vi.fn(),
    setGatewayAutoStart: vi.fn(),
    setRoleMemoryEnabled: setRoleMemoryEnabledMock,
    setCdpRemoteControlEnabled: vi.fn(),
    setCdpRemoteDebuggingPort: vi.fn(),
    setProxyEnabled: vi.fn(),
    setProxyServer: vi.fn(),
    setProxyHttpServer: vi.fn(),
    setProxyHttpsServer: vi.fn(),
    setProxyAllServer: vi.fn(),
    setProxyBypassRules: vi.fn(),
    setDevModeUnlocked: vi.fn(),
    setTelemetryEnabled: vi.fn(),
    setWorkModeToolBundles: setWorkModeToolBundlesMock,
    setWorkModeKits: setWorkModeKitsMock,
  }),
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (state: unknown) => unknown) => selector({
    activeWorkspace: {
      id: 'workspace-1',
      name: 'Demo Workspace',
      rootPath: 'C:/demo',
      activeSessionKey: 'agent:main:main',
      permissionMode: 'acceptEdits',
      state: {},
      sessionStates: {
        'agent:main:main': { workMode: 'build' },
      },
    },
    saveWorkspaceState: saveWorkspaceStateMock,
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: () => ({
    status: gatewayState.status,
    restart: gatewayRestartMock,
  }),
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayStatus: () => vi.fn(),
    onOpenClawCliInstalled: () => vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    remoteControl: {
      status: () => remoteControlStatusMock(),
      inspect: () => remoteControlInspectMock(),
      pageInfo: (...args: unknown[]) => remoteControlPageInfoMock(...args),
      scroll: (...args: unknown[]) => remoteControlScrollMock(...args),
      click: (...args: unknown[]) => remoteControlClickMock(...args),
      screenshot: (...args: unknown[]) => remoteControlScreenshotMock(...args),
    },
    settings: {
      setMany: (...args: unknown[]) => settingsSetManyMock(...args),
    },
    gateway: {
      controlUi: vi.fn(),
    },
    logs: {
      recent: vi.fn(),
      dir: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
    openclaw: {
      getCliCommand: vi.fn(),
    },
    app: {
      version: vi.fn(async () => '0.0.0-test'),
      openClawDoctor: vi.fn(),
    },
    sandbox: {
      status: () => sandboxStatusMock(),
      updateProfile: (...args: unknown[]) => sandboxUpdateProfileMock(...args),
    },
    skills: {
      local: vi.fn(async () => ({ success: true, skills: [] })),
      clawhubInstall: vi.fn(async () => ({ success: true })),
    },
    usage: {
      recentTokenHistory: vi.fn(async () => []),
    },
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    i18n: { changeLanguage: vi.fn() },
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderSettings(path = '/settings/system') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Settings />
    </MemoryRouter>,
  );
}

describe('Settings remote control section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.devModeUnlocked = false;
    settingsState.workModeToolBundles = {};
    settingsState.workModeKits = {};
    setWorkModeToolBundlesMock.mockImplementation((mode, bundles) => {
      settingsState.workModeToolBundles = {
        ...settingsState.workModeToolBundles,
        [mode]: bundles,
      };
    });
    setWorkModeKitsMock.mockImplementation((mode, kits) => {
      settingsState.workModeKits = {
        ...settingsState.workModeKits,
        [mode]: kits,
      };
    });
    saveWorkspaceStateMock.mockResolvedValue(undefined);
    sandboxStatusMock.mockResolvedValue({
      success: true,
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
      degraded: false,
      permissionMode: 'acceptEdits',
      summary: 'Policy-light / acceptEdits / policy / network=disabled',
      updatedAt: 1,
      docker: { cli: false, daemon: false, image: false },
      execPolicy: { host: 'gateway', security: 'allowlist', ask: 'dangerous' },
      networkPolicy: 'disabled',
      workspaceAccess: 'none',
      providers: [
        {
          id: 'policy-light',
          label: 'Policy-light',
          available: true,
          runtimeLevel: 'policy',
          capabilities: [],
        },
      ],
      warnings: [],
      provider: {
        id: 'policy-light',
        label: 'Policy-light',
        available: true,
        runtimeLevel: 'policy',
        capabilities: [],
      },
      openClawConfig: {
        agents: {
          defaults: {
            sandbox: {
              mode: 'off',
              backend: 'openshell',
              scope: 'session',
              workspaceAccess: 'none',
            },
          },
        },
        tools: {
          exec: { host: 'gateway', security: 'allowlist', ask: 'dangerous' },
          sandbox: { tools: { alsoAllow: [] } },
        },
      },
    });
    sandboxUpdateProfileMock.mockResolvedValue({
      success: true,
      profile: {
        id: 'default',
        name: 'Default sandbox',
        providerId: 'policy-light',
        networkPolicy: 'disabled',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    remoteControlStatusMock.mockResolvedValue({
      success: true,
      configuredEnabled: false,
      configuredPort: 9222,
      effectiveEnabled: false,
      effectivePort: null,
      endpoint: null,
      envOverride: false,
      restartRequired: false,
    });
    remoteControlInspectMock.mockResolvedValue({
      success: true,
      endpoint: 'http://127.0.0.1:9222/json/version',
      browser: 'Electron/38.0.0',
      protocolVersion: '1.3',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
      targets: [{ id: 'page-1', title: 'Verse Claw', type: 'page', url: 'app://verse-claw' }],
    });
    remoteControlPageInfoMock.mockResolvedValue({
      success: true,
      title: 'Verse Claw',
      url: 'app://verse-claw',
      viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
      scroll: { x: 0, y: 0, width: 1200, height: 1800 },
    });
    remoteControlScrollMock.mockResolvedValue({ success: true });
    remoteControlClickMock.mockResolvedValue({ success: true });
    remoteControlScreenshotMock.mockResolvedValue({
      success: true,
      format: 'png',
      dataUrl: 'data:image/png;base64,abc',
    });
  });

  it('shows CDP remote control outside developer mode and can inspect the endpoint', async () => {
    renderSettings('/settings/system');

    expect(screen.getByTestId('settings-remote-control-section')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-developer-section')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-cdp-inspect'));

    await waitFor(() => {
      expect(remoteControlInspectMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Browser：Electron/38.0.0')).toBeInTheDocument();
      expect(screen.getByText('Verse Claw')).toBeInTheDocument();
    });
  });

  it('shows the Role Memory runtime toggle in system settings', () => {
    renderSettings('/settings/system');

    expect(screen.getByTestId('settings-role-memory-section')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings-role-memory-toggle'));

    expect(setRoleMemoryEnabledMock).toHaveBeenCalledWith(false);
  });

  it('can trigger CDP page actions from settings', async () => {
    renderSettings('/settings/system');

    fireEvent.click(screen.getByTestId('settings-cdp-inspect'));
    await screen.findByText('remoteControl.inspect.targets');

    fireEvent.click(screen.getByText('remoteControl.actions.pageInfo'));
    await waitFor(() => {
      expect(remoteControlPageInfoMock).toHaveBeenCalledWith({ targetId: 'page-1' });
      expect(screen.getByText('viewport 1200x800 / scroll 0/1800')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('settings-cdp-screenshot'));
    await waitFor(() => {
      expect(remoteControlScreenshotMock).toHaveBeenCalledWith({
        targetId: 'page-1',
        fullPage: true,
        format: 'png',
      });
      expect(screen.getByAltText('remoteControl.screenshotAlt')).toBeInTheDocument();
    });
  });

  it('does not expose legacy Work Mode settings', async () => {
    renderSettings('/settings/work-modes');

    expect(screen.queryByTestId('settings-work-modes-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-nav-work-modes')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(saveWorkspaceStateMock).not.toHaveBeenCalled();
      expect(setWorkModeKitsMock).not.toHaveBeenCalled();
      expect(setWorkModeToolBundlesMock).not.toHaveBeenCalled();
    });
  });
});
