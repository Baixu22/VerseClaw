import electronBinaryPath from 'electron';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type LaunchElectronOptions = {
  skipSetup?: boolean;
  flags?: string[];
  visualMode?: boolean;
  devScenario?: string;
  bootHoldMs?: number;
  settingsSectionDelayMs?: number;
  theme?: 'light' | 'dark' | 'system';
  env?: Record<string, string>;
};

type IpcMockConfig = {
  gatewayStatus?: Record<string, unknown>;
  gatewayRpc?: Record<string, unknown>;
  hostApi?: Record<string, unknown>;
};

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  homeDir: string;
  userDataDir: string;
  launchElectronApp: (options?: LaunchElectronOptions) => Promise<ElectronApplication>;
};

type AgentDevTestWindow = Window & {
  __CLAWX_TEST__?: {
    getSnapshot?: () => unknown;
    setHostApiReplay?: (config: unknown) => void;
    hostApiCalls?: unknown[];
  };
};

function envWithoutUndefined(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
const rendererEntryUrl = pathToFileURL(join(repoRoot, 'dist', 'index.html')).toString();

// FP-P3-05: openclaw_runtime dist freshness guard.
// E2E must test the current source build, not a stale dist/entry.js bundle.
// If any src file is newer than dist/entry.js, fail-fast with a readable hint.
const runtimeSrcDir = join(repoRoot, 'openclaw_runtime', 'src');
const runtimeDistEntry = join(repoRoot, 'openclaw_runtime', 'dist', 'entry.js');

let freshnessChecked = false;
async function assertRuntimeDistFresh(): Promise<void> {
  if (freshnessChecked) return; // check once per process
  freshnessChecked = true;
  let distMtimeMs: number;
  try {
    const st = await stat(runtimeDistEntry);
    distMtimeMs = st.mtimeMs;
  } catch {
    return; // dist missing → let the runtime path fall back to tsx; no staleness to check
  }
  const stale: string[] = [];
  async function walk(dir: string): Promise<void> {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        const st = await stat(full);
        if (st.mtimeMs > distMtimeMs) stale.push(full);
      }
    }
  }
  try {
    await walk(runtimeSrcDir);
  } catch {
    return; // src dir missing or unreadable → skip (not our job to fail here)
  }
  if (stale.length > 0) {
    const sample = stale.slice(0, 5).map((f) => f.replace(repoRoot + '\\', ''));
    throw new Error(
      `[FP-P3-05] openclaw_runtime/dist/entry.js is stale. ${stale.length} src file(s) newer than dist.\n` +
        `Run \`pnpm build:runtime\` before E2E to avoid testing a stale bundle.\n` +
        `Sample stale files: ${sample.join(', ')}${stale.length > 5 ? ` (and ${stale.length - 5} more)` : ''}`,
    );
  }
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function getStableWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;
  let page = await app.firstWindow();

  while (Date.now() < deadline) {
    const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
    const currentWindow = openWindows.at(-1) ?? page;

    if (currentWindow && !currentWindow.isClosed()) {
      try {
        await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        return currentWindow;
      } catch (error) {
        if (!String(error).includes('has been closed')) {
          throw error;
        }
      }
    }

    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling until a stable window is available or the deadline expires.
    }
  }

  throw new Error('No stable Electron window became available');
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let closed = false;

  await Promise.race([
    (async () => {
      const [closeResult] = await Promise.allSettled([
        app.waitForEvent('close', { timeout: timeoutMs }),
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
      ]);

      if (closeResult.status === 'fulfilled') {
        closed = true;
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (closed) {
    return;
  }

  try {
    await app.close();
    return;
  } catch {
    // Fall through to process kill if Playwright cannot close the app cleanly.
  }

  try {
    app.process().kill('SIGKILL');
  } catch {
    // Ignore process kill failures during e2e teardown.
  }
}

async function seedE2eSettings(userDataDir: string, theme?: LaunchElectronOptions['theme']): Promise<void> {
  const settingsPath = join(userDataDir, 'settings.json');
  let existing: Record<string, unknown> = {};
  try {
    await access(settingsPath);
    existing = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    if (!theme) return;
  } catch {
    // Seed only once per isolated profile. Tests that switch language should
    // keep their persisted setting across relaunches in the same profile.
  }

  await writeFile(settingsPath, JSON.stringify({ language: 'en', ...existing, ...(theme ? { theme } : {}) }, null, 2), 'utf-8');
}

async function cleanupTempDir(path: string): Promise<void> {
  if (process.env.CLAWX_E2E_KEEP_TEMP === '1') {
    return;
  }

  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY')) {
      return;
    }
    throw error;
  }
}

async function launchVerseClawElectron(
  homeDir: string,
  userDataDir: string,
  options: LaunchElectronOptions = {},
): Promise<ElectronApplication> {
  await seedE2eSettings(userDataDir, options.theme);
  const hostApiPort = await allocatePort();
  const cdpPort = await allocatePort();
  const electronEnv = process.platform === 'linux'
    ? {
      ELECTRON_DISABLE_SANDBOX: '1',
      DISPLAY: process.env.DISPLAY || ':1',
    }
    : {};
  return await electron.launch({
    executablePath: String(electronBinaryPath),
    args: [
      '--lang=en-US',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization',
      electronEntry,
    ],
    env: envWithoutUndefined({
      ...process.env,
      ...electronEnv,
      ...options.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LANGUAGE: 'en',
      VERSE_CLAW_E2E: '1',
      CLAWX_AGENT_DEV: '1',
      ...(options.flags?.length ? { CLAWX_FLAGS: options.flags.join(',') } : {}),
      ...(options.visualMode ? { CLAWX_VISUAL_MODE: '1' } : {}),
      ...(options.devScenario ? { CLAWX_DEV_SCENARIO: options.devScenario } : {}),
      ...(typeof options.bootHoldMs === 'number'
        ? { CLAWX_E2E_BOOT_HOLD_MS: String(Math.max(0, Math.round(options.bootHoldMs))) }
        : {}),
      ...(typeof options.settingsSectionDelayMs === 'number'
        ? { CLAWX_E2E_SETTINGS_SECTION_DELAY_MS: String(Math.max(0, Math.round(options.settingsSectionDelayMs))) }
        : {}),
      VERSE_CLAW_USER_DATA_DIR: userDataDir,
      ...(options.skipSetup ? { VERSE_CLAW_E2E_SKIP_SETUP: '1' } : {}),
      VERSE_CLAW_PORT_CLAWX_HOST_API: String(hostApiPort),
      VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(cdpPort),
    }),
    timeout: 90_000,
  });
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({ browserName: _browserName }, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'verse-claw-e2e-home-'));
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
    try {
      await provideHomeDir(homeDir);
    } finally {
      await cleanupTempDir(homeDir);
    }
  },

  userDataDir: async ({ browserName: _browserName }, provideUserDataDir) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'verse-claw-e2e-user-data-'));
    try {
      await provideUserDataDir(userDataDir);
    } finally {
      await cleanupTempDir(userDataDir);
    }
  },

  launchElectronApp: async ({ homeDir, userDataDir }, provideLauncher) => {
    await provideLauncher(async (options?: LaunchElectronOptions) => {
      // Most production-path specs use this explicit launcher instead of the
      // `electronApp` fixture. Keep the FP-P3-05 stale-runtime guard on both
      // paths so a direct launch cannot silently test an older child bundle.
      await assertRuntimeDistFresh();
      return await launchVerseClawElectron(homeDir, userDataDir, options);
    });
  },

  electronApp: async ({ launchElectronApp }, provideElectronApp) => {
    await assertRuntimeDistFresh();
    const app = await launchElectronApp();
    let appClosed = false;
    app.once('close', () => {
      appClosed = true;
    });

    try {
      await provideElectronApp(app);
    } finally {
      if (!appClosed) {
        await closeElectronApp(app);
      }
    }
  },

  page: async ({ electronApp }, providePage) => {
    const page = await getStableWindow(electronApp);
    await providePage(page);
  },
});

export async function completeSetup(page: Page): Promise<void> {
  await expect(page.getByTestId('setup-page')).toBeVisible();
  await page.getByTestId('setup-skip-button').click();
  await expect(page.getByTestId('main-layout')).toBeVisible();
}

export { closeElectronApp };
export { getStableWindow };
export { expect };

export async function openAgentDevScenario(
  page: Page,
  scenario: string,
  options: { flags?: string[]; visualMode?: boolean } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(page.url());
    if (url.protocol === 'chrome-error:' || url.protocol === 'about:') {
      url = new URL(rendererEntryUrl);
    }
  } catch {
    url = new URL(rendererEntryUrl);
  }
  url.searchParams.set('e2eSkipSetup', '1');
  url.searchParams.set('devScenario', scenario);
  if (options.flags?.length) url.searchParams.set('flags', options.flags.join(','));
  if (options.visualMode) url.searchParams.set('visual', '1');
  await page.goto(url.toString());
}

export async function getAgentDevSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as AgentDevTestWindow).__CLAWX_TEST__?.getSnapshot?.() ?? null);
}

export async function configureAgentDevHostReplay(
  page: Page,
  config: {
    mode?: 'off' | 'record' | 'replay';
    fixtures?: Array<{ module: string; action: string; payload?: unknown; result: unknown }>;
  },
): Promise<void> {
  await page.evaluate((replayConfig) => {
    (window as AgentDevTestWindow).__CLAWX_TEST__?.setHostApiReplay?.(replayConfig);
  }, config);
}

export async function getAgentDevHostCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as AgentDevTestWindow).__CLAWX_TEST__?.hostApiCalls ?? []);
}

export async function installIpcMocks(
  app: ElectronApplication,
  config: IpcMockConfig,
): Promise<void> {
  // The window can still be navigating right after launch; app.evaluate then
  // races the navigation and dies with "Execution context was destroyed".
  // Stabilize the window first, then retry briefly as a fallback.
  await getStableWindow(app);
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await app.evaluate(
        async ({ app: _app }, mockConfig) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const stableStringify = (value: unknown): string => {
        if (value == null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
        const entries = Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
        return `{${entries.join(',')}}`;
      };

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      type IpcInvokeHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
      const getInvokeHandler = (channel: string): IpcInvokeHandler | undefined => {
        return (ipcMain as unknown as {
          _invokeHandlers?: Map<string, IpcInvokeHandler>;
        })._invokeHandlers?.get(channel);
      };

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });
      const fail = (id: unknown, message: string) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: false,
        error: { code: 'INTERNAL', message },
      });

      const unwrapLegacyResponse = (response: unknown): unknown => {
        if (!response || typeof response !== 'object') return response;
        const record = response as Record<string, unknown>;
        const data = record.data;
        if (data && typeof data === 'object' && 'json' in (data as Record<string, unknown>)) {
          return (data as Record<string, unknown>).json;
        }
        return data ?? response;
      };
      const respondGatewayRpc = (id: unknown, response: unknown) => {
        if (response && typeof response === 'object') {
          const record = response as Record<string, unknown>;
          if (record.success === false) {
            return fail(id, String(record.error || 'Gateway RPC failed'));
          }
          if (record.success === true && 'result' in record) {
            return respond(id, record.result);
          }
        }
        return respond(id, response);
      };
      const originalLegacyGatewayRpc = getInvokeHandler('gateway:rpc');
      const originalLegacyFileStat = getInvokeHandler('file:stat');
      const originalLegacyFileReadText = getInvokeHandler('file:readText');
      const getLegacyOverride = (channel: string, original?: IpcInvokeHandler) => {
        const current = getInvokeHandler(channel);
        return current && current !== original ? current : null;
      };
      (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls = [];

      const legacyPathForHostRequest = (request: {
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }): [string, string] | null => {
        const payload = request.payload ?? {};
        if (request.module === 'gateway') {
          if (request.action === 'status') return ['/api/gateway/status', 'GET'];
          if (request.action === 'start') return ['/api/gateway/start', 'POST'];
          if (request.action === 'restart') return ['/api/gateway/restart', 'POST'];
        }
        if (request.module === 'agents' && request.action === 'list') return ['/api/agents', 'GET'];
        if (request.module === 'settings' && request.action === 'getAll') return ['/api/settings', 'GET'];
        if (request.module === 'channels') {
          if (request.action === 'accounts') return ['/api/channels/accounts', 'GET'];
          if (request.action === 'validateCredentials') return ['/api/channels/credentials/validate', 'POST'];
          if (request.action === 'saveConfig') return ['/api/channels/config', 'POST'];
          if (request.action === 'bindingSave') return ['/api/channels/binding', 'PUT'];
          if (request.action === 'bindingDelete') return ['/api/channels/binding', 'DELETE'];
          if (request.action === 'formValues') {
            const channelType = encodeURIComponent(String(payload.channelType ?? ''));
            return [`/api/channels/config/${channelType}`, 'GET'];
          }
        }
        if (request.module === 'diagnostics' && request.action === 'gatewaySnapshot') {
          return ['/api/diagnostics/gateway-snapshot', 'GET'];
        }
        if (request.module === 'workspaces') {
          if (request.action === 'list') return ['/api/workspaces', 'GET'];
          if (request.action === 'getActive') return ['/api/workspaces/active', 'GET'];
          if (request.action === 'saveState') return ['/api/workspaces/state', 'PUT'];
        }
        if (request.module === 'usage') {
          if (request.action === 'recentTokenHistory') return ['/api/usage/recent-token-history', 'GET'];
          if (request.action === 'live') return ['/api/usage/live', 'GET'];
          if (request.action === 'contextRange') return ['/api/usage/context-range', 'GET'];
        }
        if (request.module === 'cron' && request.action === 'list') return ['/api/cron/jobs', 'GET'];
        if (request.module === 'skills' && request.action === 'quickAccess') return ['/api/skills/quick-access', 'POST'];
        if (request.module === 'files' && request.action === 'thumbnails') return ['/api/files/thumbnails', 'POST'];
        if (request.module === 'media') {
          if (request.action === 'thumbnails') return ['/api/files/thumbnails', 'POST'];
          if (request.action === 'imageGenerationSettings') return ['/api/media/image-generation', 'GET'];
          if (request.action === 'saveImageGenerationSettings') return ['/api/media/image-generation', 'PUT'];
        }
        if (request.module === 'sessions') {
          if (request.action === 'history') {
            const params = new URLSearchParams();
            if (typeof payload.sessionKey === 'string') params.set('sessionKey', payload.sessionKey);
            if (typeof payload.agentId === 'string') params.set('agentId', payload.agentId);
            if (typeof payload.sessionId === 'string') params.set('sessionId', payload.sessionId);
            if (typeof payload.limit === 'number') params.set('limit', String(payload.limit));
            return [`/api/sessions/transcript?${params.toString()}`, 'GET'];
          }
          if (request.action === 'summaries') return ['/api/sessions/summaries', 'POST'];
        }
        return null;
      };

      if (mockConfig.gatewayRpc || mockConfig.hostApi || mockConfig.gatewayStatus) {
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls?.push({
            module: request?.module,
            action: request?.action,
            payload: request?.payload ?? null,
          });

          if (mockConfig.gatewayStatus && request?.module === 'gateway' && request.action === 'status') {
            return respond(request.id, mockConfig.gatewayStatus);
          }

          if (mockConfig.gatewayRpc && request?.module === 'gateway' && request.action === 'rpc') {
            const payload = request.payload ?? {};
            const method = typeof payload.method === 'string' ? payload.method : '';
            const params = 'params' in payload ? payload.params : null;
            const key = stableStringify([method, params ?? null]);
            if (key in mockConfig.gatewayRpc) return respondGatewayRpc(request.id, mockConfig.gatewayRpc[key]);
            if (method === 'sessions.list') {
              const emptySessionsListKey = stableStringify([method, {}]);
              if (emptySessionsListKey in mockConfig.gatewayRpc) {
                return respondGatewayRpc(request.id, mockConfig.gatewayRpc[emptySessionsListKey]);
              }
            }
            const fallbackKey = stableStringify([method, null]);
            if (fallbackKey in mockConfig.gatewayRpc) return respondGatewayRpc(request.id, mockConfig.gatewayRpc[fallbackKey]);
            const legacyGatewayRpc = getLegacyOverride('gateway:rpc', originalLegacyGatewayRpc);
            if (legacyGatewayRpc) {
              return respondGatewayRpc(
                request.id,
                await legacyGatewayRpc(event, method, params, payload.timeoutMs),
              );
            }
            return respond(request.id, {});
          }

          if (mockConfig.hostApi) {
            const typedKey = stableStringify([
              request?.module ?? null,
              request?.action ?? null,
              request?.payload ?? null,
            ]);
            if (typedKey in mockConfig.hostApi) {
              return respond(request.id, unwrapLegacyResponse(mockConfig.hostApi[typedKey]));
            }
            const typedFallbackKey = stableStringify([
              request?.module ?? null,
              request?.action ?? null,
              null,
            ]);
            if (typedFallbackKey in mockConfig.hostApi) {
              return respond(request.id, unwrapLegacyResponse(mockConfig.hostApi[typedFallbackKey]));
            }

            const legacyPath = legacyPathForHostRequest(request ?? {});
            if (legacyPath) {
              const key = stableStringify(legacyPath);
              if (key in mockConfig.hostApi) {
                return respond(request.id, unwrapLegacyResponse(mockConfig.hostApi[key]));
              }
            }
          }

          if (request?.module === 'files') {
            const payload = request.payload ?? {};
            const path = typeof payload.path === 'string' ? payload.path : '';
            if (request.action === 'stat') {
              const legacyFileStat = getLegacyOverride('file:stat', originalLegacyFileStat);
              if (legacyFileStat) {
                return respond(request.id, await legacyFileStat(event, path));
              }
            }
            if (request.action === 'readText') {
              const legacyFileReadText = getLegacyOverride('file:readText', originalLegacyFileReadText);
              if (legacyFileReadText) {
                return respond(request.id, await legacyFileReadText(event, path));
              }
            }
          }

          return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
        });
      }

      if (mockConfig.gatewayStatus) {
        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => mockConfig.gatewayStatus);
      }
    },
    config,
  );
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
