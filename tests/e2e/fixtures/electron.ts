import electronBinaryPath from 'electron';
import { spawn } from 'node:child_process';
import { _electron as electron, expect, test as base, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordElectronProcess } from './electron-process-cleanup';

type LaunchElectronOptions = {
  skipSetup?: boolean;
  skipSeed?: boolean;
  flags?: string[];
  visualMode?: boolean;
  devScenario?: string;
  bootHoldMs?: number;
  settingsSectionDelayMs?: number;
  theme?: 'light' | 'dark' | 'system';
  env?: Record<string, string>;
  profileDir?: string;
  packaged?: boolean;
  executablePath?: string;
};

type IpcMockConfig = {
  gatewayStatus?: Record<string, unknown>;
  gatewayRpc?: Record<string, unknown>;
  /** Plain method-name seam; `*` is the fallback for unlisted methods. */
  gatewayRpcByMethod?: Record<string, unknown>;
  /** Per-method response sequences; the last entry repeats. */
  gatewayRpcSequences?: Record<string, unknown[]>;
  /** Optional per-method delay in milliseconds for gatewayRpcByMethod. */
  gatewayRpcDelays?: Record<string, number>;
  hostApi?: Record<string, unknown>;
  /** Typed seam for the former `file:stat` flat handler. */
  fileStat?: Record<string, unknown>;
  /** Typed seam for the former `file:readText` flat handler. */
  fileReadText?: Record<string, unknown>;
};

type ElectronFixtures = {
  workerDiagnostics: void;
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
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
        // Test/spec files are never inputs to the runtime bundle (entry.js), so a
        // test edited after the last build must not report the dist as stale.
        !/\.(test|spec)\.[cm]?[jt]s$/u.test(entry.name)
      ) {
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
        // A window that is not ready yet is expected while the app boots: this
        // helper's contract is to poll until the deadline, so a slow load must
        // not abort the loop. Only a window that actually closed is terminal.
        const message = String(error);
        if (!message.includes('has been closed') && !message.includes('Timeout')) {
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

/**
 * The sidebar's section actions are hover-revealed: `.section-heading-actions`
 * starts at `opacity: 0; pointer-events: none` and only flips to `auto` while
 * its heading is hovered. Clicking one of those 22x22 slots straight after a
 * bare `hover()` can race that flip, because the click's hit test resolves
 * `pointer-events` at the moment it runs and then reports the heading as
 * intercepting the pointer. Hover the heading and wait for the slot to actually
 * accept pointer events before touching it.
 */
export async function revealSectionHeadingActions(page: Page, index = 0): Promise<void> {
  const heading = page.locator('.section-heading').nth(index);
  await heading.hover();
  await expect(heading.locator('.section-heading-actions')).toHaveCSS('pointer-events', 'auto');
}

/**
 * Reveals the hover-only action slot that owns `control`.
 *
 * The sidebar has several `.section-heading` blocks (the nav sections and the
 * conversations/projects section), each with its own hover-revealed actions, and
 * only one is revealed at a time. Revealing by index therefore only works when the
 * caller happens to know which heading owns the control: four specs clicked
 * `sidebar-session-organize` -- which lives in the conversations/projects heading,
 * not the first one -- after revealing index 0, so the slot kept
 * `pointer-events: none` and the click died on "<div class=\"section-heading\">
 * intercepts pointer events" once the sidebar had more than one heading. Resolve the
 * owning heading from the control itself instead.
 */
export async function revealSectionHeadingActionsFor(control: Locator): Promise<void> {
  // Hover the heading that owns the control, not the control itself: the slot
  // starts at `pointer-events: none`, and hovering an element that cannot receive
  // pointer events blocks until Playwright's own action timeout.
  const heading = control.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " section-heading ")][1]',
  );
  await expect(async () => {
    await heading.hover();
    await expect(control).toHaveCSS('pointer-events', 'auto', { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Hover a row and wait until a hover-revealed control inside it actually
 * appears. `row.hover()` on its own is not enough: the sidebar re-renders as its
 * data settles and workers:1 keeps the pointer between tests, so the hover can be
 * lost or never register, leaving the control at a zero-size box while the click
 * waits out its whole 30s budget. Retry the hover under a bounded budget so a
 * genuinely broken reveal still fails.
 */
export async function hoverUntilVisible(
  row: Locator,
  control: Locator,
  timeoutMs = 30_000,
): Promise<void> {
  await expect(async () => {
    await row.hover();
    await expect(control).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: timeoutMs });
}

/**
 * Electron clamps `page.setViewportSize()` to the real BrowserWindow, so a spec
 * that needs a reproducible capture width has to resize the window itself.
 *
 * `setContentSize` is deliberate: it sizes the web contents area (what a
 * screenshot of a page-level element actually sees) instead of the outer frame,
 * so the result does not drift with the platform's title-bar metrics. The
 * window is created with `minWidth: 960` / `minHeight: 600`, so requests below
 * those bounds are clamped by Electron — the returned rect reports the truth.
 */
async function pinWindowContentSize(
  app: ElectronApplication,
  size: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  return await app.evaluate(async ({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('pinWindowContentSize: no BrowserWindow available');
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(target.width, target.height);
    const [width, height] = win.getContentSize();
    return { width, height };
  }, size);
}

/**
 * Kills the Electron process and every descendant it spawned.
 *
 * Closing only the Electron main process leaves its descendants alive -- in
 * particular the Gateway child, which inherits the stdio pipes Playwright created
 * for the app. Node keeps a handle open until every writer closes it, so one
 * surviving descendant stops the worker from ever exiting; Playwright then reports
 * "Worker teardown timeout of 90000ms exceeded ... 1 error was not a part of any
 * test" even though every test passed. Descendants also keep hundreds of MB
 * resident for the rest of the suite. This is separate from an unattributed
 * Node worker 0xC0000409; an Electron 0x80000003 dump does not explain that exit.
 *
 * Best-effort by design: teardown must never throw or hang.
 */
async function killElectronProcessTree(app: ElectronApplication): Promise<void> {
  if (process.platform !== 'win32') return;
  let pid: number | undefined;
  try {
    pid = app.process().pid;
  } catch {
    return;
  }
  if (!pid) return;
  // Kill the Electron parent directly first. taskkill /T can block on Windows
  // when a detached Gateway child owns inherited stdio; a bounded taskkill is
  // only a child-tree follow-up.
  try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
  await new Promise<void>((resolve) => {
    try {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
      let settled = false;
      const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      // A timed-out helper must exit too; its process handle otherwise pins the worker.
      const timer = setTimeout(() => {
        try { killer.kill('SIGKILL'); } catch { /* helper already exited */ }
        done();
      }, 2_000);
      timer.unref();
      killer.on('close', done);
      killer.on('error', done);
    } catch {
      resolve();
    }
  });
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let closed = false;

  // Windows Electron can ignore app.quit() while a Gateway child still owns
  // inherited stdio. Kill the owned process tree first, then use the bounded
  // close races below as the Playwright cleanup path. Without this order the
  // worker can sit behind a 90s teardown wait despite all tests passing.
  if (process.platform === 'win32') {
    await killElectronProcessTree(app);
  }

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
    await killElectronProcessTree(app);
    return;
  }

  // Bound `app.close()` too. It was awaited without a limit, so when a real
  // gateway child refused to quit the fixture hung here until Playwright's
  // 90-second worker-teardown timeout fired and blamed the test that had just
  // finished -- runtime-launch-contract-fp-p0.spec.ts:271 passed every
  // assertion (its [fp-p0-02-config-kill] line was logged) and was still
  // reported as a 7.0m failure.
  try {
    const closedByPlaywright = await Promise.race([
      app.close().then(() => true, () => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (closedByPlaywright) return;
  } catch {
    // Fall through to process kill if Playwright cannot close the app cleanly.
  }

  try {
    app.process().kill('SIGKILL');
  } catch {
    // Ignore process kill failures during e2e teardown.
  }

  await killElectronProcessTree(app);
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
  const profileDir = options.profileDir ?? userDataDir;
  if (!options.skipSeed) await seedE2eSettings(profileDir, options.theme);
  const hostApiPort = await allocatePort();
  const cdpPort = await allocatePort();
  const electronEnv = process.platform === 'linux'
    ? {
      ELECTRON_DISABLE_SANDBOX: '1',
      DISPLAY: process.env.DISPLAY || ':1',
    }
    : {};
  const app = await electron.launch({
    executablePath: options.executablePath ?? String(electronBinaryPath),
    args: [
      // Windows runners cannot use the Chromium sandbox in this isolated E2E user-data context.
      ...(process.platform === 'win32' ? ['--no-sandbox'] : []),
      `--user-data-dir=${profileDir}`,
      '--lang=en-US',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization',
      ...(options.packaged ? [] : [electronEntry]),
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
      VERSE_CLAW_USER_DATA_DIR: profileDir,
      ...(options.skipSetup ? { VERSE_CLAW_E2E_SKIP_SETUP: '1' } : {}),
      VERSE_CLAW_PORT_CLAWX_HOST_API: String(hostApiPort),
      VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(cdpPort),
    }),
    timeout: 90_000,
  });
  await recordElectronProcess(userDataDir, app.process().pid);
  /*
   * The app's own output is otherwise swallowed, which makes a stalled turn
   * unattributable from the test side: the composer just goes idle and the
   * runtime's reason never leaves the process. Opt in with CLAWX_E2E_APP_LOGS=1
   * when diagnosing one.
   */
  if (process.env.CLAWX_E2E_APP_LOGS === '1') {
    app.process().stdout?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[app:out] ${String(chunk)}`);
    });
    app.process().stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[app:err] ${String(chunk)}`);
    });
  }
  // Hosted runners can open the desktop window on a 1024px screen. Wait for
  // its creation before pinning content size; responsive specs can resize it.
  try {
    await app.firstWindow();
    await pinWindowContentSize(app, { width: 1280, height: 800 });
  } catch (error) {
    await closeElectronApp(app);
    throw error;
  }
  return app;
}

export const test = base.extend<ElectronFixtures>({
  workerDiagnostics: [async ({ browserName: _browserName }, provideDiagnostics, testInfo) => {
    const dir = process.env.CLAWX_E2E_RUN_ROOT;
    if (!dir) { await provideDiagnostics(); return; }
    // Write before the test and synchronously: a native abort bypasses teardown.
    // Do not include inherited environment variables or a user's configuration.
    process.report.directory = dir;
    process.report.reportOnFatalError = true;
    process.report.excludeEnv = true;
    const record = (phase: string) => appendFileSync(join(dir, `worker-${process.pid}.jsonl`), JSON.stringify({
      driven_by: 'agent', actor: 'playwright-worker', phase, time: new Date().toISOString(),
      pid: process.pid, ppid: process.ppid, execPath: process.execPath, node: process.version,
      workerIndex: testInfo.workerIndex, test: testInfo.titlePath, status: testInfo.status,
      memory: process.memoryUsage(), resources: process.resourceUsage(),
    }) + '\n');
    record('begin');
    const timer = setInterval(() => record('sample'), 5_000).unref();
    try { await provideDiagnostics(); } finally { clearInterval(timer); record('end'); }
  }, { auto: true }],
  homeDir: async ({ browserName: _browserName }, provideHomeDir) => {
    const homeDir = await mkdtemp(join(process.env.CLAWX_E2E_RUN_ROOT ?? tmpdir(), 'verse-claw-e2e-home-'));
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await mkdir(join(homeDir, '.openclaw'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
    try {
      await provideHomeDir(homeDir);
    } finally {
      await cleanupTempDir(homeDir);
    }
  },

  userDataDir: async ({ browserName: _browserName }, provideUserDataDir) => {
    const userDataDir = await mkdtemp(join(process.env.CLAWX_E2E_RUN_ROOT ?? tmpdir(), 'verse-claw-e2e-user-data-'));
    try {
      await provideUserDataDir(userDataDir);
    } finally {
      await cleanupTempDir(userDataDir);
    }
  },

  launchElectronApp: async ({ homeDir, userDataDir }, provideLauncher) => {
    // Specs that launch through this helper are NOT covered by the `electronApp`
    // fixture's auto-close, and three specs close fewer apps than they launch
    // (provider-lifecycle 2/1, runtime-approval-bridge 2/0, system-maturity-p45
    // 5/0). A leaked instance keeps the worker's handles open -- Playwright then
    // reports "Worker teardown timeout of 90000ms exceeded ... 1 error was not a
    // part of any test" after every test passed -- and holds a few hundred MB for
    // the rest of the suite, which is also when Electron's native fatal CHECK
    // fires. Track every launch here and close whatever is still running.
    const launched: Array<{ app: ElectronApplication; closed: boolean }> = [];
    try {
      await provideLauncher(async (options?: LaunchElectronOptions) => {
        // Most production-path specs use this explicit launcher instead of the
        // `electronApp` fixture. Keep the FP-P3-05 stale-runtime guard on both
        // paths so a direct launch cannot silently test an older child bundle.
        if (!options?.packaged) await assertRuntimeDistFresh();
        const app = await launchVerseClawElectron(homeDir, userDataDir, options);
        const entry = { app, closed: false };
        app.once('close', () => {
          entry.closed = true;
        });
        launched.push(entry);
        return app;
      });
    } finally {
      const leaked = launched.filter((entry) => !entry.closed);
      await Promise.all(leaked.map((entry) => closeElectronApp(entry.app).catch(() => undefined)));
    }
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
export { pinWindowContentSize };
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

/** Push a gateway status event into every open window (the gateway store subscribes to it). */
export async function publishGatewayStatus(
  app: ElectronApplication,
  status: Record<string, unknown>,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, payload) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('gateway:status-changed', payload);
  }, status);
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

      const rpcCallCounts = new Map<string, number>();
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
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

      const resolveHostApiMock = async (value: unknown): Promise<unknown> => {
        if (value && typeof value === 'object' && '__delayMs' in value && 'result' in value) {
          const delayMs = Number((value as { __delayMs?: unknown }).__delayMs);
          if (Number.isFinite(delayMs) && delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          return (value as { result: unknown }).result;
        }
        return value;
      };
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

      if (mockConfig.gatewayRpc || mockConfig.gatewayRpcByMethod || mockConfig.gatewayRpcDelays || mockConfig.hostApi || mockConfig.gatewayStatus || mockConfig.fileStat || mockConfig.fileReadText) {
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

          if ((mockConfig.gatewayRpc || mockConfig.gatewayRpcByMethod || mockConfig.gatewayRpcDelays) && request?.module === 'gateway' && request.action === 'rpc') {
            const payload = request.payload ?? {};
            const method = typeof payload.method === 'string' ? payload.method : '';
            const params = 'params' in payload ? payload.params : null;
            const sequences = mockConfig.gatewayRpcSequences;
            if (sequences && method in sequences) {
              const list = sequences[method];
              const count = rpcCallCounts.get(method) ?? 0;
              rpcCallCounts.set(method, count + 1);
              const delay = mockConfig.gatewayRpcDelays?.[method];
              if (typeof delay === 'number' && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
              return respondGatewayRpc(request.id, list[Math.min(count, list.length - 1)]);
            }
            const byMethod = mockConfig.gatewayRpcByMethod;
            if (byMethod) {
              const delay = mockConfig.gatewayRpcDelays?.[method];
              if (typeof delay === 'number' && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
              if (method in byMethod) return respondGatewayRpc(request.id, byMethod[method]);
              if ('*' in byMethod) return respondGatewayRpc(request.id, byMethod['*']);
            }
            const rpcMap = mockConfig.gatewayRpc;
            if (rpcMap) {
              const key = stableStringify([method, params ?? null]);
              if (key in rpcMap) return respondGatewayRpc(request.id, rpcMap[key]);
              if (method === 'sessions.list') {
                const emptySessionsListKey = stableStringify([method, {}]);
                if (emptySessionsListKey in rpcMap) {
                  return respondGatewayRpc(request.id, rpcMap[emptySessionsListKey]);
                }
              }
              const fallbackKey = stableStringify([method, null]);
              if (fallbackKey in rpcMap) return respondGatewayRpc(request.id, rpcMap[fallbackKey]);
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
              return respond(request.id, unwrapLegacyResponse(await resolveHostApiMock(mockConfig.hostApi[typedKey])));
            }
            const typedFallbackKey = stableStringify([
              request?.module ?? null,
              request?.action ?? null,
              null,
            ]);
            if (typedFallbackKey in mockConfig.hostApi) {
              return respond(request.id, unwrapLegacyResponse(await resolveHostApiMock(mockConfig.hostApi[typedFallbackKey])));
            }

            const legacyPath = legacyPathForHostRequest(request ?? {});
            if (legacyPath) {
              const key = stableStringify(legacyPath);
              if (key in mockConfig.hostApi) {
                return respond(request.id, unwrapLegacyResponse(await resolveHostApiMock(mockConfig.hostApi[key])));
              }
            }
          }

          // Mocked UI scenarios must not depend on the developer machine's free
          // space. Explicit system.info fixtures above can still test warnings.
          if (request?.module === 'system' && request.action === 'info') {
            return respond(request.id, {
              success: true,
              ram: { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, appUsedBytes: 256 * 1024 ** 2 },
              disk: [{ root: '/', totalBytes: 100 * 1024 ** 3, freeBytes: 50 * 1024 ** 3 }],
              cpu: { loadPercent: 10, cores: 4, available: true },
              platform: process.platform,
              arch: process.arch,
            });
          }

          if (request?.module === 'files') {
            const payload = request.payload ?? {};
            const path = typeof payload.path === 'string' ? payload.path : '';
            const typedFilePath = (seam: Record<string, unknown> | undefined) => (
              seam ? (path in seam ? seam[path] : seam['*']) : undefined
            );
            if (request.action === 'stat') {
              const typedStat = typedFilePath(mockConfig.fileStat);
              if (typedStat !== undefined) return respond(request.id, typedStat);
            }
            if (request.action === 'readText') {
              const typedReadText = typedFilePath(mockConfig.fileReadText);
              if (typedReadText !== undefined) return respond(request.id, typedReadText);
            }
          }

          return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
        });
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
