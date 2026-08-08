/**
 * mock-host-bridge.ts — browser-only mock Host API for UI development.
 *
 * The renderer talks to Electron through `window.verseClaw.hostInvoke`.
 * When developing UI in a plain browser (no Electron), that bridge is
 * undefined and every host call fails — the app falls into setup, the
 * gateway reads "stopped", the composer is disabled, and none of the
 * surfaces you are trying to style can be exercised.
 *
 * This module installs a fixture-backed `window.verseClaw.hostInvoke` that
 * answers the host calls the UI actually makes with benign, realistic
 * fixtures. It is gated by `?mock=1` (or `--mock` via the npm script) so it
 * can never leak into normal dev or production runs.
 *
 * Usage:
 *   pnpm dev:mock            # vite + this bridge, seeded fixtures
 *   pnpm dev:mock -- --port 5199
 *
 * The bridge intentionally keeps the REQUEST/RESPONSE path real: the app's
 * stores, IPC plumbing (`invokeHost`), and UI all run their actual code —
 * only the transport endpoint is replaced. Extend `FIXTURES` below for new
 * host surfaces; everything the app probes is handled or returns a safe
 * empty-state.
 */

import type { HostRequest } from '@shared/host-api/types';

/** Shape of the staged-file payload the composer sends. */
type StageBufferPayload = {
  base64?: string;
  fileName?: string;
  mimeType?: string;
};

function ok<T>(id: string | undefined, data: T) {
  return { id, ok: true as const, data };
}

function fail(id: string | undefined, message: string) {
  return { id, ok: false as const, error: { message } };
}

const NOW = 1_781_900_000_000;

/** A gradient PNG data URL — stands in for a staged image preview. */
function makeGradientPreview(): string {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const cx = c.getContext('2d');
  if (!cx) return 'data:image/png;base64,';
  const g = cx.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, '#ff6b6b');
  g.addColorStop(0.5, '#4ecdc4');
  g.addColorStop(1, '#45b7d1');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 96, 96);
  return c.toDataURL('image/png');
}

const DEMO_WORKSPACE = {
  id: 'ws-mock-demo',
  name: 'mock-workspace',
  rootPath: 'C:\\mock\\workspace',
  agentId: 'agent-mock',
  activeSessionKey: 'sess-mock',
  permissionMode: 'fullAccess',
  createdAt: NOW,
  updatedAt: NOW,
  lastOpenedAt: NOW,
  state: 'active',
} as const;

/** One enabled provider account, so the composer's first-send gate opens. */
const DEMO_ACCOUNT = {
  id: 'acc-mock',
  vendorId: 'anthropic',
  label: 'Mock Anthropic',
  authMode: 'api_key',
  // Keep one concrete model in the browser fixture so the composer can
  // exercise the model picker without requiring provider setup.
  model: 'claude-sonnet-4',
  enabled: true,
  isDefault: true,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
} as const;

const DEMO_AGENT = {
  id: 'main',
  name: 'Main',
  isDefault: true,
  modelDisplay: 'claude-sonnet-4',
  modelRef: 'anthropic/claude-sonnet-4',
  overrideModelRef: null,
  inheritedModel: false,
  reasoningEffort: 'auto',
  workspace: DEMO_WORKSPACE.rootPath,
  agentDir: `${DEMO_WORKSPACE.rootPath}\\.openclaw\\agents\\main`,
  mainSessionKey: 'agent:main:main',
  channelTypes: [],
} as const;

/**
 * Fixtures keyed by `module.action`. Anything not listed returns a safe
 * empty-state via the default arm — the UI must never crash on a missing
 * fixture, it should just render its empty/loading state.
 */
const FIXTURES: Record<string, (req: HostRequest) => unknown> = {
  'app.version': () => ({ version: '0.0.0-mock' }),
  'openclaw.status': () => ({ ok: true, running: true }),

  'gateway.status': () => ({ state: 'running', gatewayReady: true, port: 18789 }),

  'settings.getAll': () => ({
    setupComplete: true,
    devModeUnlocked: true,
    theme: 'dark',
    language: 'zh-CN',
  }),
  'settings.get': () => ({}),
  'settings.set': () => ({ ok: true }),

  'workspaces.getActive': () => ({
    activeWorkspaceId: DEMO_WORKSPACE.id,
    activeWorkspace: DEMO_WORKSPACE,
    ok: true,
  }),
  'workspaces.list': () => ({
    profiles: [DEMO_WORKSPACE],
    activeWorkspaceId: DEMO_WORKSPACE.id,
    activeWorkspace: DEMO_WORKSPACE,
    ok: true,
  }),

  'sessions.list': () => [],
  'sessions.summaries': () => [],
  'sessions.history': () => ({ items: [], ok: true }),

  'providers.accounts': () => [DEMO_ACCOUNT],
  'providers.vendors': () => [],
  'providers.list': () => [],
  'providers.getDefaultAccount': () => ({ accountId: DEMO_ACCOUNT.id }),
  'providers.accountKeyInfo': () => [
    { accountId: DEMO_ACCOUNT.id, hasKey: true, keyMasked: 'sk-••••mock' },
  ],
  'providers.getAccount': () => DEMO_ACCOUNT,
  'providers.hasAccountApiKey': () => true,

  'agents.list': () => ({
    agents: [DEMO_AGENT],
    defaultAgentId: DEMO_AGENT.id,
    defaultModelRef: DEMO_AGENT.modelRef,
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
  }),

  'taskLedger.snapshot': () => ({ ok: true, nodes: [], links: [] }),
  'permissions.approvals': () => [],
  'agentBrowser.tasks': () => [],
  'channels.accounts': () => [],
  'channels.targets': () => [],
  'resourceTracker.list': () => [],

  'files.stageBuffer': (req) => {
    const payload = (req.payload ?? {}) as StageBufferPayload;
    const isImage = typeof payload.mimeType === 'string' && payload.mimeType.startsWith('image/');
    return {
      id: 'mock-' + Math.random().toString(36).slice(2, 10),
      fileName: payload.fileName || 'file.bin',
      mimeType: payload.mimeType || 'application/octet-stream',
      fileSize: 4096,
      stagedPath: `C:\\mock\\outbound\\${payload.fileName || 'file.bin'}`,
      preview: isImage ? makeGradientPreview() : null,
    };
  },
  'files.stagePaths': (req) => {
    const paths = Array.isArray((req.payload as { filePaths?: unknown } | undefined)?.filePaths)
      ? ((req.payload as { filePaths: string[] }).filePaths)
      : [];
    return paths.map((p) => ({
      id: 'mockp-' + Math.random().toString(36).slice(2, 10),
      fileName: String(p).split(/[\\/]/).pop() || 'file.bin',
      mimeType: 'image/png',
      fileSize: 4096,
      stagedPath: String(p),
      preview:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAAElUaGXAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIElEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAvg0YAAABhGmA2QAAAABJRU5ErkJggg==',
    }));
  },

  /**
   * Native file-picker stand-in: the composer's "添加文件" flow opens a real
   * dialog in Electron; here it returns one pre-selected demo path so the
   * whole attach → stage → preview → send chain is exercisable.
   */
  'dialog.open': () => ({
    canceled: false,
    filePaths: ['C:\\mock\\demo\\gradient.png', 'C:\\mock\\demo\\notes.txt'],
  }),
};

/**
 * Install the mock bridge. Idempotent; refuses to run when the real
 * Electron bridge is already present (never mask a real host).
 */
export function installMockHostBridge(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.verseClaw?.hostInvoke) return false;

  const handler = async (request: HostRequest) => {
    const { id, module, action } = request;
    const key = `${module}.${action}`;
    const fixture = FIXTURES[key];
    if (fixture) {
      try {
        return ok(id, fixture(request));
      } catch (err) {
        return fail(id, `mock fixture error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Default arm: benign empty-state so unknown probes never crash the UI.
    return ok(id, {});
  };

  window.verseClaw = { hostInvoke: handler };

  // Some surfaces read `window.electron` directly (e.g. Settings checks
  // `window.electron.platform`). In a browser that is undefined — stub the
  // few fields the UI dereferences unconditionally. IPC calls fall through
  // to hostEvents' no-op path (it warns and returns), which is fine for UI
  // work; the host bridge above is the real channel.
  if (!window.electron) {
    window.electron = {
      platform: 'win32',
      versions: { chrome: '', electron: '' },
      ipcRenderer: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as Window['electron'];
  }

  return true;
}

/** Query flag the entry point checks: `?mock=1`. */
export function isMockModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

/**
 * Seed the persisted settings store so the app boots past Setup before the
 * async `settings.getAll` round-trip lands. The settings store hydrates from
 * `verse-claw-settings` in localStorage synchronously; without this, the
 * setup redirect (running on the first frame) fires before `init()` resolves
 * and bounces the mock session to /setup.
 */
export function seedMockPersistedSettings(): void {
  try {
    const existing = window.localStorage.getItem('verse-claw-settings');
    if (existing) return;
    window.localStorage.setItem(
      'verse-claw-settings',
      JSON.stringify({
        state: { setupComplete: true, devModeUnlocked: true, theme: 'dark', language: 'zh-CN' },
        version: 0,
      }),
    );
  } catch {
    // localStorage unavailable — fall back to the async settings.getAll path.
  }
}
