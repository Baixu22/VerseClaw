import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentBrowserArtifactRef,
  AgentBrowserAuthPersistenceMode,
  AgentBrowserCommandPayload,
  AgentBrowserConnectionMode,
  AgentBrowserConnectionSnapshot,
  AgentBrowserNetworkClearPayload,
  AgentBrowserNetworkClearResult,
  AgentBrowserNetworkComparePayload,
  AgentBrowserNetworkCompareResult,
  AgentBrowserNetworkDetailPayload,
  AgentBrowserNetworkDetailResult,
  AgentBrowserNetworkExtractJsPayload,
  AgentBrowserNetworkExtractJsResult,
  AgentBrowserNetworkFilter,
  AgentBrowserNetworkFindParamsPayload,
  AgentBrowserNetworkFindParamsResult,
  AgentBrowserNetworkListPayload,
  AgentBrowserNetworkListResult,
  AgentBrowserNetworkWaitPayload,
  AgentBrowserNetworkWaitResult,
  AgentBrowserNewPagePayload,
  AgentBrowserNavigatePagePayload,
  AgentBrowserClosePagePayload,
  AgentBrowserListPagesResult,
  AgentBrowserSelectPagePayload,
  AgentBrowserJsListResourcesPayload,
  AgentBrowserJsListResourcesResult,
  AgentBrowserJsSearchSourcesPayload,
  AgentBrowserJsSearchSourcesResult,
  AgentBrowserJsExtractContextPayload,
  AgentBrowserJsExtractContextResult,
  AgentBrowserSourceMapListCandidatesPayload,
  AgentBrowserSourceMapListCandidatesResult,
  AgentBrowserSourceMapResolveLocationPayload,
  AgentBrowserSourceMapResolveLocationResult,
  AgentBrowserSourceMapExtractOriginalContextPayload,
  AgentBrowserSourceMapExtractOriginalContextResult,
  AgentBrowserRuntimeInspectGlobalsPayload,
  AgentBrowserRuntimeInspectGlobalsResult,
  AgentBrowserRuntimeSearchModulesPayload,
  AgentBrowserRuntimeSearchModulesResult,
  AgentBrowserRuntimeDescribeFunctionPayload,
  AgentBrowserRuntimeDescribeFunctionResult,
  AgentBrowserReplayPrepareRequestPayload,
  AgentBrowserReplayPrepareRequestResult,
  AgentBrowserReplaySendRequestPayload,
  AgentBrowserReplaySendRequestResult,
  AgentBrowserReplayCompareResponsesPayload,
  AgentBrowserReplayCompareResponsesResult,
  AgentBrowserConsoleMessagesPayload,
  AgentBrowserConsoleMessagesResult,
  AgentBrowserFullAccessExecuteScriptPayload,
  AgentBrowserFullAccessExecuteScriptResult,
  AgentBrowserFullAccessFetchPayload,
  AgentBrowserFullAccessFetchResult,
  AgentBrowserFullAccessGetNetworkDetailsPayload,
  AgentBrowserFullAccessGetNetworkDetailsResult,
  AgentBrowserFullAccessReadStoragePayload,
  AgentBrowserFullAccessReadStorageResult,
  AgentBrowserFullAccessRevokePayload,
  AgentBrowserFullAccessRevokeResult,
  AgentBrowserExtractPageTextPayload,
  AgentBrowserExtractPageTextResult,
  AgentBrowserValidateExtractionRulePayload,
  AgentBrowserValidateExtractionRuleResult,
  AgentBrowserOpenPayload,
  AgentBrowserProfileEntry,
  AgentBrowserProfileSavePayload,
  AgentBrowserRequestModeUpgradePayload,
  AgentBrowserRequestModeUpgradeResult,
  AgentBrowserRuntimeMode,
  AgentBrowserSession,
  AgentBrowserSessionMode,
  AgentBrowserValidatePayload,
  AgentBrowserValidateResult,
  BrowserAutomationRunResult,
  BrowserAutomationRunStep,
} from '@shared/host-api/contract';
import type { BrowserControlToolCall, NetworkHeader, NetworkRequestDetail, NetworkRequestMeta } from '@shared/agent-browser/types';
import { redactNetworkRequestDetail, redactNetworkRequestMeta } from '@shared/agent-browser/network-context';
import { truncateText } from '@shared/agent-browser/text';
import { getOriginFromUrl, type ToolAuthorizationContext } from '@shared/agent-browser/tool-authorization';
import {
  agentBrowserProfilePartition,
  agentBrowserRunArtifactDir,
  agentBrowserScreenshotDir,
  sanitizeAgentBrowserPathSegment,
} from '@shared/agent-browser/filesystem-boundary';
import { isBrowserControlRestrictedUrl } from '@shared/agent-browser/browser-control';
import { BrowserControlActionExecutor } from './agent-browser/browser-control/actions';
import { BoundaryChoiceToolExecutor } from './agent-browser/browser-control/boundary-choice-tool-executor';
import { BrowserDebuggerConnection } from './agent-browser/browser-control/browser-debugger-connection';
import { BrowserControlSnapshotManager } from './agent-browser/browser-control/snapshot-manager';
import { AgentBrowserTabManager } from './agent-browser/browser-control/tab-manager';
import { JsSourceToolExecutor } from './agent-browser/browser-control/js-source-tool-executor';
import { SourceMapToolExecutor } from './agent-browser/browser-control/source-map-tool-executor';
import { RuntimeReadToolExecutor } from './agent-browser/browser-control/runtime-read-tool-executor';
import { ReplayToolExecutor } from './agent-browser/browser-control/replay-tool-executor';
import { BrowserConsoleRecorder } from './agent-browser/browser-control/console-recorder';
import { FullAccessToolExecutor } from './agent-browser/browser-control/full-access-tool-executor';
import { PageTextExtractor } from './agent-browser/browser-control/page-text-extractor';
import { validateExtractionRuleDraft } from '@shared/agent-browser/extraction-rules/validation';
import { BrowserNetworkRecorder, type NetworkRequestFilter, type NetworkWaitFilter } from './agent-browser/browser-control/network-recorder';
import type { AgentBrowserRunner } from './agent-browser-cli-runner';

type AgentBrowserWindow = Pick<
  BrowserWindow,
  | 'close'
  | 'focus'
  | 'hide'
  | 'isDestroyed'
  | 'isMinimized'
  | 'isVisible'
  | 'loadURL'
  | 'restore'
  | 'setBounds'
  | 'show'
  | 'webContents'
>;

type AgentBrowserWebContents = BrowserWindow['webContents'];

type AgentBrowserRecord = {
  session: AgentBrowserSession;
  window?: AgentBrowserWindow;
  engine: 'browser-window' | 'agent-browser-cli';
  runtimeMode: AgentBrowserRuntimeMode;
  runtimeExpiresAt?: number;
  /** P1-7：多标签页管理器，仅 browser-window 引擎可用。 */
  tabManager?: AgentBrowserTabManager;
};

type AgentBrowserControlState = {
  connection: BrowserDebuggerConnection;
  snapshotManager: BrowserControlSnapshotManager;
  actionExecutor: BrowserControlActionExecutor;
  boundaryExecutor: BoundaryChoiceToolExecutor;
  networkRecorder: BrowserNetworkRecorder;
  consoleRecorder: BrowserConsoleRecorder;
  jsSourceExecutor: JsSourceToolExecutor;
  sourceMapExecutor: SourceMapToolExecutor;
  runtimeReadExecutor: RuntimeReadToolExecutor;
  replayExecutor: ReplayToolExecutor;
  fullAccessExecutor: FullAccessToolExecutor;
  pageTextExtractor: PageTextExtractor;
};

type AgentBrowserServiceOptions = {
  cliRunner?: AgentBrowserRunner;
  createWindow?: (options: Electron.BrowserWindowConstructorOptions) => AgentBrowserWindow;
  now?: () => Date;
  userDataPath?: string;
};

type AgentBrowserProfileMetadataFile = {
  profiles?: Record<string, Omit<AgentBrowserProfileEntry, 'profile' | 'source' | 'activeSessions'>>;
};

type AgentBrowserValidationSnapshot = {
  url?: string;
  title?: string;
  text?: string;
  links?: Array<{ text: string; href: string }>;
  buttons?: string[];
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 900;
const DEFAULT_PROFILE = 'default';
const MAX_TEXT_SAMPLE = 4000;
const MAX_ARTIFACT_TEXT = 120_000;
const CONTROLLED_CLI_FLAGS = new Set([
  '--json',
  '--session',
  '--profile',
  '--headed',
  '--max-output',
  '--session-name',
  '--state',
  '--auto-connect',
  '--cdp',
  '--executable-path',
]);

function normalizeMode(value: unknown): AgentBrowserSessionMode {
  return value === 'visible' ? 'visible' : 'headless';
}

/**
 * 规范化运行态模式。默认 normal_restricted（最受限）。
 * 抄写自 browser-ai-assistant-master 的 BrowserAutomationMode 语义。
 */
function normalizeRuntimeMode(value: unknown): AgentBrowserRuntimeMode {
  return value === 'controlled_enhanced' || value === 'full_access'
    ? value
    : 'normal_restricted';
}

function normalizeDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(320, Math.min(4096, Math.floor(value)))
    : fallback;
}

function normalizeTimeoutMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1000, Math.min(300_000, Math.floor(value)))
    : undefined;
}

function normalizeProfile(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PROFILE;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) return DEFAULT_PROFILE;
  // Fail closed on residual path-like tokens after normalization.
  try {
    return sanitizeAgentBrowserPathSegment(normalized, 'profile');
  } catch {
    return DEFAULT_PROFILE;
  }
}

function normalizeAuthStateName(value: unknown, profile: string): string | undefined {
  const source = typeof value === 'string' && value.trim() ? value.trim() : profile;
  const normalized = source.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || undefined;
}

function normalizeAuthPersistence(value: unknown): AgentBrowserAuthPersistenceMode {
  return value === 'profile' || value === 'off' ? value : 'session-name';
}

function normalizeExternalValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Agent browser ${label} is required`);
  }
  const normalized = value.trim();
  if (/[\r\n\0]/.test(normalized) || normalized.length > 1024) {
    throw new Error(`Agent browser ${label} is invalid`);
  }
  return normalized;
}

function normalizeConnection(payload: {
  connectionMode?: AgentBrowserConnectionMode;
  cdpEndpoint?: string;
  externalProfile?: string;
  executablePath?: string;
  allowExternalBrowser?: boolean;
}): AgentBrowserConnectionSnapshot {
  const mode = payload.connectionMode ?? 'managed';
  if (mode !== 'managed' && payload.allowExternalBrowser !== true) {
    throw new Error('Agent browser external browser access requires allowExternalBrowser=true');
  }
  switch (mode) {
    case 'managed':
      return { mode };
    case 'auto-connect':
      return { mode };
    case 'cdp':
      return {
        mode,
        cdpEndpoint: normalizeExternalValue(payload.cdpEndpoint, 'cdpEndpoint'),
      };
    case 'external-profile':
      return {
        mode,
        externalProfile: normalizeExternalValue(payload.externalProfile, 'externalProfile'),
        ...(payload.executablePath
          ? { executablePath: normalizeExternalValue(payload.executablePath, 'executablePath') }
          : {}),
      };
    default:
      throw new Error(`Unsupported agent browser connection mode: ${String(mode)}`);
  }
}

function hasExplicitSafetyPayload(payload: AgentBrowserCommandPayload): boolean {
  return payload.profile !== undefined
    || payload.mode !== undefined
    || payload.authPersistence !== undefined
    || payload.authStateName !== undefined
    || payload.connectionMode !== undefined
    || payload.cdpEndpoint !== undefined
    || payload.externalProfile !== undefined
    || payload.executablePath !== undefined
    || payload.allowExternalBrowser !== undefined;
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Agent browser URL must use http or https');
  }
  return parsed.toString();
}

function normalizeCliArgs(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Agent browser ${label} must be an array`);
  }
  const args = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`Agent browser ${label} entries must be strings`);
    }
    const arg = entry.trim();
    if (!arg) {
      throw new Error(`Agent browser ${label} cannot include empty entries`);
    }
    return arg;
  });
  for (const arg of args) {
    const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (CONTROLLED_CLI_FLAGS.has(flag)) {
      throw new Error(`Agent browser command cannot override managed CLI flag: ${flag}`);
    }
  }
  return args;
}

function normalizeMaxOutput(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1000, Math.min(2_000_000, Math.floor(value)))
    : undefined;
}

async function waitForWebContents(
  webContents: AgentBrowserWebContents,
  eventName: 'did-finish-load' | 'dom-ready',
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const events = webContents as unknown as {
      once: (eventName: string, listener: (...args: unknown[]) => void) => void;
      removeListener: (eventName: string, listener: (...args: unknown[]) => void) => void;
    };
    const cleanup = () => {
      events.removeListener(eventName, onReady);
      events.removeListener('did-fail-load', onFail);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onFail = (...args: unknown[]) => {
      const errorCode = typeof args[1] === 'number' ? args[1] : 0;
      const errorDescription = typeof args[2] === 'string' ? args[2] : 'unknown error';
      cleanup();
      reject(new Error(`Agent browser navigation failed (${errorCode}): ${errorDescription}`));
    };
    events.once(eventName, onReady);
    events.once('did-fail-load', onFail);
  });
}

const WAIT_FOR_SELECTOR_SCRIPT = `(selector, timeoutMs) => new Promise((resolve) => {
  const started = Date.now();
  const tick = () => {
    if (document.querySelector(selector)) {
      resolve(true);
      return;
    }
    if (Date.now() - started >= timeoutMs) {
      resolve(false);
      return;
    }
    setTimeout(tick, 100);
  };
  tick();
})`;

export class AgentBrowserService {
  private readonly sessions = new Map<string, AgentBrowserRecord>();
  private readonly browserControlStates = new Map<string, AgentBrowserControlState>();
  private readonly cliRunner: AgentBrowserRunner | undefined;
  private readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => AgentBrowserWindow;
  private readonly now: () => Date;
  private readonly userDataPath: string | undefined;
  private boundaryChoiceNotifier: ((sessionId: string, message: import('@shared/agent-browser/browser-control').BrowserControlBoundaryChoiceRequestMessage) => void) | undefined;
  /**
   * 全局浏览器控制开关。默认关闭，刷新/重载后回退到关闭（不持久化）。
   * P1-1：browserControlEnabled 是全局运行态授权开关，不属于 chatPreferences。
   */
  private browserControlEnabled = false;

  constructor(options: AgentBrowserServiceOptions = {}) {
    this.cliRunner = options.cliRunner;
    this.createWindow = options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions));
    this.now = options.now ?? (() => new Date());
    this.userDataPath = options.userDataPath;
  }

  list(): AgentBrowserSession[] {
    return [...this.sessions.values()].map((record) => ({ ...record.session }));
  }

  async listProfiles(): Promise<AgentBrowserProfileEntry[]> {
    const metadata = await this.readProfileMetadata();
    const profiles = new Map<string, AgentBrowserProfileEntry>();
    for (const [profile, entry] of Object.entries(metadata.profiles ?? {})) {
      profiles.set(profile, {
        profile,
        ...entry,
        source: 'metadata',
      });
    }

    const profileRoot = this.profileRootDir();
    const dirs = await readdir(profileRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(dirs.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const profile = normalizeProfile(entry.name);
      const profileStat = await stat(join(profileRoot, entry.name)).catch(() => undefined);
      const current = profiles.get(profile);
      profiles.set(profile, {
        ...current,
        profile,
        lastUsedAt: current?.lastUsedAt ?? profileStat?.mtime?.toISOString(),
        source: current?.source ?? 'profile-dir',
      });
    }));

    for (const session of this.list()) {
      const current = profiles.get(session.profile);
      profiles.set(session.profile, {
        ...current,
        profile: session.profile,
        authStateName: current?.authStateName ?? session.authStateName,
        lastUsedAt: session.updatedAt,
        activeSessions: (current?.activeSessions ?? 0) + 1,
        source: current?.source ?? 'session',
      });
    }

    if (!profiles.has(DEFAULT_PROFILE)) {
      profiles.set(DEFAULT_PROFILE, {
        profile: DEFAULT_PROFILE,
        label: 'Default',
        authStateName: DEFAULT_PROFILE,
        activeSessions: 0,
        source: 'metadata',
      });
    }

    return [...profiles.values()].sort((left, right) => {
      if (left.profile === DEFAULT_PROFILE) return -1;
      if (right.profile === DEFAULT_PROFILE) return 1;
      return (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
        || left.profile.localeCompare(right.profile);
    });
  }

  async saveProfile(payload: AgentBrowserProfileSavePayload): Promise<AgentBrowserProfileEntry> {
    const profile = normalizeProfile(payload.profile);
    const authStateName = normalizeAuthStateName(payload.authStateName, profile);
    const now = this.now().toISOString();
    const metadata = await this.readProfileMetadata();
    const current = metadata.profiles?.[profile];
    metadata.profiles = {
      ...(metadata.profiles ?? {}),
      [profile]: {
        ...current,
        label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : undefined,
        description: typeof payload.description === 'string' && payload.description.trim() ? payload.description.trim() : undefined,
        authStateName,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: current?.lastUsedAt,
      },
    };
    await mkdir(join(this.getUserDataPath(), 'agent-browser'), { recursive: true });
    await writeFile(this.profileMetadataPath(), JSON.stringify(metadata, null, 2), 'utf8');
    const profileEntry = (await this.listProfiles()).find((entry) => entry.profile === profile);
    if (!profileEntry) {
      throw new Error(`Agent browser profile not found after save: ${profile}`);
    }
    return profileEntry;
  }

  async validate(payload: AgentBrowserValidatePayload = {}): Promise<AgentBrowserValidateResult> {
    let sessionId: string | undefined;
    const runId = randomUUID();
    const startedAt = this.now().toISOString();
    const steps: BrowserAutomationRunStep[] = [];
    const markStep = (
      id: string,
      label: string,
      status: BrowserAutomationRunStep['status'],
      detail?: string,
    ) => {
      const timestamp = this.now().toISOString();
      steps.push({
        id,
        label,
        status,
        ...(detail ? { detail } : {}),
        startedAt: timestamp,
        endedAt: timestamp,
      });
    };
    try {
      const opened = await this.open(payload);
      sessionId = opened.session.id;
      const session = opened.session;
      markStep('open', 'Open page', 'passed', session.url);
      const expectedDomains = Array.isArray(payload.expectedDomains)
        ? payload.expectedDomains.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
        : [];
      if (expectedDomains.length > 0 && session.url) {
        const hostname = new URL(session.url).hostname.toLowerCase();
        const allowed = expectedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        if (!allowed) {
          throw new Error(`Agent browser validation navigated outside allowed domains: ${hostname}`);
        }
        markStep('domain', 'Check allowed domain', 'passed', hostname);
      } else {
        markStep('domain', 'Check allowed domain', 'skipped');
      }
      const diagnostics: Record<string, unknown> = {};
      if (payload.diagnostics?.snapshot) {
        diagnostics.snapshot = await this.captureValidationSnapshot(session.id);
        markStep('snapshot', 'Capture page snapshot', 'passed');
      }
      if (payload.diagnostics?.console) {
        diagnostics.console = await this.safeCommand(session.id, ['console']);
        markStep('console', 'Collect console diagnostics', 'passed');
      }
      if (payload.diagnostics?.errors) {
        diagnostics.errors = await this.safeCommand(session.id, ['errors']);
        markStep('errors', 'Collect page errors', 'passed');
      }
      if (payload.diagnostics?.network) {
        diagnostics.network = await this.safeCommand(session.id, ['network', 'requests']);
        markStep('network', 'Collect network diagnostics', 'passed');
      }
      const screenshot = payload.diagnostics?.screenshot
        ? await this.screenshot({ sessionId: session.id }).catch(() => undefined)
        : undefined;
      if (screenshot?.dataUrl) {
        markStep('screenshot', 'Capture screenshot', 'passed');
      }
      const runResult = await this.persistBrowserAutomationRunResult({
        runId,
        startedAt,
        session,
        ok: true,
        steps,
        textSample: opened.textSample,
        diagnostics,
        screenshotDataUrl: screenshot?.dataUrl,
      });
      return {
        success: true,
        ok: true,
        session,
        url: session.url,
        title: session.title,
        textSample: opened.textSample,
        ...(screenshot?.dataUrl ? { screenshotDataUrl: screenshot.dataUrl } : {}),
        ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
        runResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markStep('validate', 'Validate browser task', 'failed', message);
      const runResult = await this.persistBrowserAutomationRunResult({
        runId,
        startedAt,
        session: sessionId ? this.snapshot(sessionId) : undefined,
        ok: false,
        steps,
        error: message,
      }).catch(() => undefined);
      return {
        success: true,
        ok: false,
        ...(runResult ? { runResult } : {}),
        error: message,
      };
    } finally {
      if (sessionId) {
        try {
          this.close(sessionId);
        } catch {
          // Validation sessions are best-effort cleanup.
        }
      }
    }
  }

  async open(payload: AgentBrowserOpenPayload = {}): Promise<{ session: AgentBrowserSession; textSample?: string }> {
    const mode = normalizeMode(payload.mode);
    const profile = normalizeProfile(payload.profile);
    const authPersistence = normalizeAuthPersistence(payload.authPersistence);
    const authStateName = authPersistence === 'session-name'
      ? normalizeAuthStateName(payload.authStateName, profile)
      : undefined;
    const connection = normalizeConnection(payload);
    const runtimeMode = normalizeRuntimeMode(payload.runtimeMode);
    const createdAt = this.now().toISOString();
    const width = normalizeDimension(payload.width, DEFAULT_WIDTH);
    const height = normalizeDimension(payload.height, DEFAULT_HEIGHT);
    const session: AgentBrowserSession = {
      id: randomUUID(),
      profile,
      mode,
      authPersistence,
      authStateName,
      connection,
      createdAt,
      updatedAt: createdAt,
      runtimeMode,
    };
    const url = normalizeHttpUrl(payload.url);

    if (this.cliRunner?.isAvailable()) {
      this.sessions.set(session.id, { session, engine: 'agent-browser-cli', runtimeMode });
      const metadata = await this.cliRunner.open({ session, url, width, height });
      await this.refreshCli(session.id, metadata);
      return {
        session: this.snapshot(session.id),
        textSample: await this.cliRunner.textSample(this.snapshot(session.id), MAX_TEXT_SAMPLE),
      };
    }
    if (connection.mode !== 'managed') {
      throw new Error('Agent browser external browser access requires the bundled agent-browser CLI');
    }

    const window = this.createWindow({
      show: mode === 'visible',
      width,
      height,
      title: 'Agent Browser',
      webPreferences: {
        contextIsolation: true,
        javascript: true,
        nodeIntegration: false,
        partition: agentBrowserProfilePartition(profile),
        sandbox: true,
      },
    });
    this.sessions.set(session.id, { session, window, engine: 'browser-window', runtimeMode });
    // P1-7：初始化多标签页管理器，注册主窗口为首页
    const record = this.sessions.get(session.id)!;
    record.tabManager = new AgentBrowserTabManager({
      createWindow: this.createWindow,
      profile,
      mode: mode === 'visible' ? 'visible' : 'hidden',
      width,
      height,
    });
    record.tabManager.registerMainWindow(window, url ?? '', '');
    if (url) {
      await this.navigate({ sessionId: session.id, url, waitUntil: 'load' });
    }
    return { session: this.snapshot(session.id), textSample: await this.textSample(session.id) };
  }

  async navigate(payload: { sessionId: string; url: string; waitUntil?: 'dom-ready' | 'load' }): Promise<AgentBrowserSession> {
    const record = this.getRecord(payload.sessionId);
    const url = normalizeHttpUrl(payload.url);
    if (!url) throw new Error('Agent browser URL is required');
    this.assertUrlNotRestricted(url);
    if (record.engine === 'agent-browser-cli') {
      const metadata = await this.requireCliRunner().navigate(record.session, url);
      return await this.refreshCli(record.session.id, metadata);
    }
    const waitUntil = payload.waitUntil === 'dom-ready' ? 'dom-ready' : 'did-finish-load';
    const window = this.requireWindow(record);
    const wait = waitForWebContents(window.webContents, waitUntil);
    await window.loadURL(url);
    await wait;
    return await this.refresh(record);
  }

  async focus(sessionId: string): Promise<AgentBrowserSession> {
    const record = this.getRecord(sessionId);
    if (record.engine === 'agent-browser-cli') {
      return { ...record.session };
    }
    const window = this.requireWindow(record);
    if (!window.isDestroyed()) {
      if (!window.isVisible()) window.show();
      if (window.isMinimized()) window.restore();
      window.focus();
    }
    return await this.refresh(record);
  }

  async show(sessionId: string): Promise<AgentBrowserSession> {
    const record = this.getRecord(sessionId);
    record.session = { ...record.session, mode: 'visible' };
    if (record.engine === 'agent-browser-cli') {
      return { ...record.session, updatedAt: this.now().toISOString() };
    }
    const window = this.requireWindow(record);
    if (!window.isDestroyed()) window.show();
    return await this.refresh(record);
  }

  async hide(sessionId: string): Promise<AgentBrowserSession> {
    const record = this.getRecord(sessionId);
    record.session = { ...record.session, mode: 'headless' };
    if (record.engine === 'agent-browser-cli') {
      return { ...record.session, updatedAt: this.now().toISOString() };
    }
    const window = this.requireWindow(record);
    if (!window.isDestroyed()) window.hide();
    return await this.refresh(record);
  }

  async waitForSelector(payload: { sessionId: string; selector: string; timeoutMs?: number }): Promise<AgentBrowserSession> {
    const record = this.getRecord(payload.sessionId);
    const selector = this.requireSelector(payload.selector);
    const timeoutMs = normalizeDimension(payload.timeoutMs, 5000);
    if (record.engine === 'agent-browser-cli') {
      const metadata = await this.requireCliRunner().waitForSelector(record.session, selector, timeoutMs);
      return await this.refreshCli(record.session.id, metadata);
    }
    const window = this.requireWindow(record);
    const found = await window.webContents.executeJavaScript(
      `(${WAIT_FOR_SELECTOR_SCRIPT})(${JSON.stringify(selector)}, ${timeoutMs})`,
      true,
    );
    if (!found) throw new Error(`Agent browser selector timed out: ${selector}`);
    return await this.refresh(record);
  }

  async click(payload: { sessionId: string; selector: string; timeoutMs?: number }): Promise<AgentBrowserSession> {
    const record = this.getRecord(payload.sessionId);
    const selector = this.requireSelector(payload.selector);
    if (record.engine === 'agent-browser-cli') {
      const metadata = await this.requireCliRunner().click(record.session, selector, payload.timeoutMs);
      return await this.refreshCli(record.session.id, metadata);
    }
    await this.waitForSelector(payload);
    const window = this.requireWindow(record);
    await window.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Selector not found');
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.click();
        return true;
      })()`,
      true,
    );
    return await this.refresh(record);
  }

  async type(payload: { sessionId: string; selector: string; text: string; clear?: boolean; timeoutMs?: number }): Promise<AgentBrowserSession> {
    const record = this.getRecord(payload.sessionId);
    const selector = this.requireSelector(payload.selector);
    if (record.engine === 'agent-browser-cli') {
      const metadata = await this.requireCliRunner().type({
        session: record.session,
        selector,
        text: payload.text ?? '',
        clear: payload.clear,
        timeoutMs: payload.timeoutMs,
      });
      return await this.refreshCli(record.session.id, metadata);
    }
    await this.waitForSelector(payload);
    const window = this.requireWindow(record);
    await window.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Selector not found');
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.focus();
        const text = ${JSON.stringify(payload.text ?? '')};
        if (${payload.clear === false ? 'false' : 'true'} && 'value' in el) {
          el.value = '';
        }
        if ('value' in el) {
          el.value = (${payload.clear === false ? 'String(el.value ?? "")' : '""'}) + text;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = (${payload.clear === false ? 'String(el.textContent ?? "")' : '""'}) + text;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
        return true;
      })()`,
      true,
    );
    return await this.refresh(record);
  }

  async evaluate(payload: { sessionId: string; expression: string }): Promise<{ session: AgentBrowserSession; value?: unknown }> {
    const record = this.getRecord(payload.sessionId);
    if (!payload.expression.trim()) throw new Error('Agent browser expression is required');
    if (record.engine === 'agent-browser-cli') {
      const result = await this.requireCliRunner().evaluate(record.session, payload.expression);
      return { session: await this.refreshCli(record.session.id, result.session), value: result.value };
    }
    const window = this.requireWindow(record);
    const value = await window.webContents.executeJavaScript(
      `Promise.resolve().then(() => eval(${JSON.stringify(payload.expression)}))`,
      true,
    );
    return { session: await this.refresh(record), value };
  }

  async screenshot(payload: { sessionId: string }): Promise<{ session: AgentBrowserSession; dataUrl: string; format: 'png' }> {
    const record = this.getRecord(payload.sessionId);
    if (record.engine === 'agent-browser-cli') {
      const result = await this.requireCliRunner().screenshot(record.session);
      return {
        session: await this.refreshCli(record.session.id, result.session),
        dataUrl: result.dataUrl,
        format: 'png',
      };
    }
    const window = this.requireWindow(record);
    const image = await window.webContents.capturePage();
    return {
      session: await this.refresh(record),
      dataUrl: image.toDataURL(),
      format: 'png',
    };
  }

  async command(payload: AgentBrowserCommandPayload): Promise<{
    session?: AgentBrowserSession;
    data?: unknown;
    stdout: string;
    stderr: string;
    command: string[];
  }> {
    const args = normalizeCliArgs(payload.args, 'args');
    if (args.length === 0) {
      throw new Error('Agent browser command args are required');
    }
    if (args[0]?.startsWith('-')) {
      throw new Error('Agent browser command args must start with a command; use globalOptions for global flags');
    }
    const globalOptions = payload.globalOptions === undefined
      ? undefined
      : normalizeCliArgs(payload.globalOptions, 'globalOptions');
    const runner = this.requireCliRunner();
    const sessionId = payload.sessionId?.trim();
    if (!sessionId) {
      const session = hasExplicitSafetyPayload(payload)
        ? this.createCliSession(payload)
        : undefined;
      const result = await runner.command({
        session,
        args,
        globalOptions,
        timeoutMs: normalizeTimeoutMs(payload.timeoutMs),
        maxOutput: normalizeMaxOutput(payload.maxOutput),
      });
      if (session) {
        return {
          session: await this.refreshCli(session.id, result.session),
          data: result.data,
          stdout: result.stdout,
          stderr: result.stderr,
          command: result.command,
        };
      }
      return {
        data: result.data,
        stdout: result.stdout,
        stderr: result.stderr,
        command: result.command,
      };
    }
    const record = this.getRecord(sessionId);
    if (record.engine !== 'agent-browser-cli') {
      throw new Error('Agent browser command passthrough requires the bundled agent-browser CLI');
    }
    const result = await runner.command({
      session: record.session,
      args,
      globalOptions,
      timeoutMs: normalizeTimeoutMs(payload.timeoutMs),
      maxOutput: normalizeMaxOutput(payload.maxOutput),
    });
    return {
      session: await this.refreshCli(record.session.id, result.session),
      data: result.data,
      stdout: result.stdout,
      stderr: result.stderr,
      command: result.command,
    };
  }

  /**
   * 获取页面 Accessibility Tree 快照（含 UID 映射）。
   *
   * 仅在 browser-window 引擎下可用。首次调用会 attach webContents.debugger，
   * 后续调用复用同一连接。会话关闭时统一 detach。
   */
  async takeSnapshot(payload: { sessionId: string }): Promise<{ session: AgentBrowserSession; snapshot: string }> {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(payload.sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Agent browser takeSnapshot requires the browser-window engine');
    }
    this.assertActionAllowed(record);
    const control = await this.getBrowserControl(record);
    const snapshot = await control.snapshotManager.takeSnapshot();
    return { session: await this.refresh(record), snapshot };
  }

  /**
   * 通过 UID 点击元素。UID 来自最近一次 takeSnapshot 返回的快照。
   */
  async clickByUid(payload: { sessionId: string; uid: string }): Promise<AgentBrowserSession> {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(payload.sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Agent browser clickByUid requires the browser-window engine');
    }
    this.assertActionAllowed(record);
    const control = await this.getBrowserControl(record);
    const result = await this.executeBrowserAction(control, {
      id: `click-${randomUUID()}`,
      name: 'click',
      arguments: { uid: payload.uid },
    });
    if (result.isError) {
      throw new Error(result.content);
    }
    return await this.refresh(record);
  }

  /**
   * 通过 UID 填充表单元素。
   */
  async fillByUid(payload: {
    sessionId: string;
    uid: string;
    value: string;
    clear?: boolean;
  }): Promise<AgentBrowserSession> {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(payload.sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Agent browser fillByUid requires the browser-window engine');
    }
    this.assertActionAllowed(record);
    const control = await this.getBrowserControl(record);
    const result = await this.executeBrowserAction(control, {
      id: `fill-${randomUUID()}`,
      name: 'fill',
      arguments: { uid: payload.uid, value: payload.value },
    });
    if (result.isError) {
      throw new Error(result.content);
    }
    return await this.refresh(record);
  }

  /**
   * 全局键盘按键（不绑定 UID）。支持修饰键组合，例如 "Control+Enter"。
   */
  async pressKey(payload: { sessionId: string; key: string }): Promise<AgentBrowserSession> {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(payload.sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Agent browser pressKey requires the browser-window engine');
    }
    this.assertActionAllowed(record);
    const control = await this.getBrowserControl(record);
    const result = await this.executeBrowserAction(control, {
      id: `press_key-${randomUUID()}`,
      name: 'press_key',
      arguments: { key: payload.key },
    });
    if (result.isError) {
      throw new Error(result.content);
    }
    return await this.refresh(record);
  }

  close(sessionId: string): void {
    const record = this.getRecord(sessionId);
    this.sessions.delete(sessionId);
    const controlState = this.browserControlStates.get(sessionId);
    if (controlState) {
      this.browserControlStates.delete(sessionId);
      void controlState.connection.detach();
    }
    if (record.engine === 'agent-browser-cli') {
      void this.requireCliRunner().close(record.session);
      return;
    }
    // P1-7：关闭所有标签页窗口（主窗口 + newPage 创建的额外窗口）
    if (record.tabManager) {
      for (const page of record.tabManager.listPages()) {
        const pageWindow = record.tabManager.getPageWindow(page.pageId);
        if (pageWindow && !pageWindow.isDestroyed()) {
          pageWindow.close();
        }
      }
      record.tabManager.clear();
    } else {
      const window = this.requireWindow(record);
      if (!window.isDestroyed()) {
        window.close();
      }
    }
  }

  // ===== P1-7：多标签页受控 =====

  async newPage(payload: AgentBrowserNewPagePayload): Promise<AgentBrowserListPagesResult> {
    const record = this.getRecord(payload.sessionId);
    if (record.engine === 'agent-browser-cli') {
      throw new Error('多标签页操作不支持 CLI 引擎，请使用 browser-window 引擎。');
    }
    const tabManager = this.requireTabManager(record);
    await tabManager.newPage(payload.url, payload.background);
    // 非后台创建时切换活动页：更新 record.window 并重置 control state
    if (!payload.background) {
      const newWindow = tabManager.getActiveWindow();
      if (newWindow) {
        record.window = newWindow as AgentBrowserWindow;
        this.resetBrowserControlState(record.session.id);
      }
    }
    return {
      success: true,
      session: await this.refresh(record),
      pages: tabManager.listPages(),
      activePageId: tabManager.getActivePageId(),
    };
  }

  async listPages(payload: { sessionId: string }): Promise<AgentBrowserListPagesResult> {
    const record = this.getRecord(payload.sessionId);
    if (record.engine === 'agent-browser-cli') {
      throw new Error('多标签页操作不支持 CLI 引擎，请使用 browser-window 引擎。');
    }
    const tabManager = this.requireTabManager(record);
    return {
      success: true,
      session: { ...record.session },
      pages: tabManager.listPages(),
      activePageId: tabManager.getActivePageId(),
    };
  }

  async selectPage(payload: AgentBrowserSelectPagePayload): Promise<AgentBrowserListPagesResult> {
    const record = this.getRecord(payload.sessionId);
    if (record.engine === 'agent-browser-cli') {
      throw new Error('多标签页操作不支持 CLI 引擎，请使用 browser-window 引擎。');
    }
    const tabManager = this.requireTabManager(record);
    const newWindow = tabManager.selectPage(payload.pageId);
    record.window = newWindow as AgentBrowserWindow;
    // P1-7 R4：切换页面后清理旧 UID，重建 control state
    this.resetBrowserControlState(record.session.id);
    return {
      success: true,
      session: await this.refresh(record),
      pages: tabManager.listPages(),
      activePageId: tabManager.getActivePageId(),
    };
  }

  async closePage(payload: AgentBrowserClosePagePayload): Promise<AgentBrowserListPagesResult> {
    const record = this.getRecord(payload.sessionId);
    if (record.engine === 'agent-browser-cli') {
      throw new Error('多标签页操作不支持 CLI 引擎，请使用 browser-window 引擎。');
    }
    const tabManager = this.requireTabManager(record);
    const result = tabManager.closePage(payload.pageId);
    // 如果关闭的是活动页且切换到新页面，更新 record.window 并重置 control state
    if (result.switchedTo) {
      const newWindow = tabManager.getActiveWindow();
      if (newWindow) {
        record.window = newWindow as AgentBrowserWindow;
        this.resetBrowserControlState(record.session.id);
      }
    }
    return {
      success: true,
      session: await this.refresh(record),
      pages: result.remaining,
      activePageId: tabManager.getActivePageId(),
    };
  }

  async navigatePage(payload: AgentBrowserNavigatePagePayload): Promise<AgentBrowserListPagesResult> {
    const record = this.getRecord(payload.sessionId);
    if (record.engine === 'agent-browser-cli') {
      throw new Error('多标签页操作不支持 CLI 引擎，请使用 browser-window 引擎。');
    }
    const tabManager = this.requireTabManager(record);
    const { window, entry } = tabManager.navigatePage(payload.url, payload.pageId);
    const waitUntil = payload.waitUntil === 'dom-ready' ? 'dom-ready' : 'did-finish-load';
    // 先设置 wait promise 再 loadURL，避免竞态
    const wait = waitForWebContents(window.webContents, waitUntil);
    await window.loadURL(payload.url);
    await wait;
    tabManager.updatePageInfo(entry.pageId, {
      url: payload.url,
      title: window.webContents.getTitle(),
    });
    const isActivePage = entry.pageId === tabManager.getActivePageId();
    return {
      success: true,
      session: isActivePage ? await this.refresh(record) : { ...record.session },
      pages: tabManager.listPages(),
      activePageId: tabManager.getActivePageId(),
    };
  }

  /** P1-7：获取 tabManager，未初始化时抛出错误。 */
  private requireTabManager(record: AgentBrowserRecord): AgentBrowserTabManager {
    if (!record.tabManager) {
      throw new Error(`多标签页管理器未初始化，session: ${record.session.id}`);
    }
    return record.tabManager;
  }

  /**
   * P1-7：重置浏览器控制状态（切换/关闭页面时调用）。
   *
   * 断开旧 debugger 连接并清理 browserControlStates 条目，
   * 使下次 getBrowserControl() 调用时懒重新 attach 到新的活动窗口。
   * 这实现了 R4「切换页面后清理旧 UID」的要求。
   */
  private resetBrowserControlState(sessionId: string): void {
    const controlState = this.browserControlStates.get(sessionId);
    if (controlState) {
      this.browserControlStates.delete(sessionId);
      void controlState.connection.detach();
    }
  }

  private getRecord(sessionId: string): AgentBrowserRecord {
    const record = this.sessions.get(sessionId);
    if (!record || (record.window?.isDestroyed() ?? false)) {
      this.sessions.delete(sessionId);
      throw new Error(`Agent browser session not found: ${sessionId}`);
    }
    return record;
  }

  /**
   * 懒初始化并返回会话对应的浏览器控制三件套
   * （BrowserDebuggerConnection + SnapshotManager + ActionExecutor）。
   *
   * 首次调用会 attach webContents.debugger 并启用必要的 CDP 域。
   * 后续调用复用同一连接。会话 close 时统一 detach。
   */
  private async getBrowserControl(record: AgentBrowserRecord): Promise<AgentBrowserControlState> {
    const existing = this.browserControlStates.get(record.session.id);
    if (existing) {
      return existing;
    }

    const window = this.requireWindow(record);
    const webContents = window.webContents;
    const connection = new BrowserDebuggerConnection();
    const attachResult = await connection.attach(webContents);
    if (!attachResult.ok) {
      throw new Error(attachResult.message ?? 'Failed to attach browser debugger');
    }

    // P1-2：attach 成功后安装 CDP 事件与 detach 监听器，
    // 使 NetworkRecorder / SnapshotManager 等能收到 Network.* / Page.* 事件。
    connection.installEventListener();
    connection.installDetachListener(() => {
      // 内部状态清理已在 installDetachListener 中完成；
      // 此处可触发 service 层清理 browserControlStates（当前由 setEnabled/lifecycle 管理）。
    });

    const snapshotManager = new BrowserControlSnapshotManager(connection, async () => ({
      title: webContents.getTitle(),
      url: webContents.getURL(),
    }));
    const actionExecutor = new BrowserControlActionExecutor(connection, snapshotManager);
    const boundaryExecutor = new BoundaryChoiceToolExecutor(
      (message) => {
        this.boundaryChoiceNotifier?.(record.session.id, message);
      },
      () => ({
        tabId: webContents.id,
        origin: getOriginFromUrl(webContents.getURL()),
        enhanced: this.isControlledEnhanced(record),
      }),
    );
    const networkRecorder = new BrowserNetworkRecorder(connection);
    networkRecorder.start(webContents.id);
    const jsSourceExecutor = new JsSourceToolExecutor({
      recorder: networkRecorder,
      getCurrentPageUrl: async () => webContents.getURL(),
    });
    const sourceMapExecutor = new SourceMapToolExecutor({
      recorder: networkRecorder,
      jsSourceIndex: jsSourceExecutor.getIndex(),
      getCurrentPageUrl: async () => webContents.getURL(),
    });
    const runtimeReadExecutor = new RuntimeReadToolExecutor(connection, () => this.getRuntimeReadAuthorization(record));
    const replayExecutor = new ReplayToolExecutor(
      networkRecorder,
      fetch,
      () => ({
        tabId: webContents.id,
        origin: getOriginFromUrl(webContents.getURL()),
        enhanced: this.isControlledEnhanced(record),
        grant: boundaryExecutor.getCurrentGrantContext(),
      }),
    );
    const fullAccessExecutor = new FullAccessToolExecutor(
      connection,
      networkRecorder,
      () => {
        this.refreshRuntimeModeExpiry(record);
        const origin = getOriginFromUrl(webContents.getURL());
        return {
          tabId: webContents.id,
          origin,
          expectedTabId: webContents.id,
          expectedOrigin: origin,
          fullAccess: this.isFullAccess(record),
          expiresAt: record.runtimeExpiresAt,
        };
      },
      () => this.revokeFullAccessRuntime(record),
    );
    const consoleRecorder = new BrowserConsoleRecorder(connection);
    consoleRecorder.start(webContents.id);
    const state: AgentBrowserControlState = { connection, snapshotManager, actionExecutor, boundaryExecutor, networkRecorder, consoleRecorder, jsSourceExecutor, sourceMapExecutor, runtimeReadExecutor, replayExecutor, fullAccessExecutor, pageTextExtractor: new PageTextExtractor(connection) };
    this.browserControlStates.set(record.session.id, state);
    return state;
  }

  private async executeBrowserAction(
    control: AgentBrowserControlState,
    toolCall: BrowserControlToolCall,
  ) {
    return control.actionExecutor.execute(toolCall);
  }

  /**
   * 判断当前会话是否处于受控增强或完全访问模式。
   * 用于 BoundaryChoiceToolExecutor.canExpose() 的 enhanced 上下文。
   */
  private isControlledEnhanced(record: AgentBrowserRecord): boolean {
    this.refreshRuntimeModeExpiry(record);
    return record.runtimeMode === 'controlled_enhanced' || record.runtimeMode === 'full_access';
  }

  /**
   * 检查运行态模式是否已过期，过期则回退到 normal_restricted。
   * runtimeMode 不持久化，刷新/过期即回退，符合 P0-3 适配要点 5。
   */
  private refreshRuntimeModeExpiry(record: AgentBrowserRecord): void {
    if (record.runtimeExpiresAt !== undefined && record.runtimeExpiresAt <= Date.now()) {
      record.runtimeMode = 'normal_restricted';
      record.runtimeExpiresAt = undefined;
      record.session = { ...record.session, runtimeMode: 'normal_restricted' };
    }
  }

  /**
   * 断言当前会话允许执行浏览器控制动作。
   * normal_restricted 模式下所有 browser-control 动作被拒绝，
   * 必须先调用 requestModeUpgrade 升级到 controlled_enhanced 或 full_access。
   */
  private assertActionAllowed(record: AgentBrowserRecord): void {
    this.refreshRuntimeModeExpiry(record);
    if (record.runtimeMode === 'normal_restricted') {
      throw new Error(
        `Agent browser action requires runtime mode upgrade (current: normal_restricted). Call requestModeUpgrade first.`,
      );
    }
  }

  /**
   * 注册 BoundaryChoice 通知回调。Renderer 侧通过此回调接收
   * BoundaryChoiceToolExecutor 发出的用户边界确认请求，并展示 BoundaryChoiceDialog。
   */
  setBoundaryChoiceNotifier(
    notifier: ((sessionId: string, message: import('@shared/agent-browser/browser-control').BrowserControlBoundaryChoiceRequestMessage) => void) | undefined,
  ): void {
    this.boundaryChoiceNotifier = notifier;
  }

  /**
   * 全局浏览器控制开关。P1-1：browserControlEnabled 不持久化，刷新回退关闭。
   * 关闭时立即 detach 所有 session 的 debugger 连接，并清理 browserControlStates。
   * 开启失败时前端必须回滚该运行态（由 UI 层负责）。
   */
  setEnabled(enabled: boolean): { enabled: boolean } {
    if (!enabled) {
      this.browserControlEnabled = false;
      // 立即 detach 所有 session 的 debugger 连接
      for (const control of this.browserControlStates.values()) {
        void control.connection.detach().catch(() => {
          // tab 已关闭或用户取消调试时，Electron 可能拒绝 detach；忽略
        });
      }
      this.browserControlStates.clear();
    } else {
      this.browserControlEnabled = true;
    }
    return { enabled: this.browserControlEnabled };
  }

  isEnabled(): boolean {
    return this.browserControlEnabled;
  }

  /**
   * 断言全局浏览器控制开关已开启。
   * browser-control 动作（takeSnapshot/clickByUid/fillByUid/pressKey）执行前必须校验。
   */
  private assertBrowserControlEnabled(): void {
    if (!this.browserControlEnabled) {
      throw new Error('浏览器控制未开启，请先调用 setEnabled(true) 开启全局运行态开关。');
    }
  }

  /**
   * 校验 URL 不是受限页面。P1-1：默认拒绝 chrome:// / edge:// / about: /
   * chrome-extension:// / view-source: / Chrome Web Store / app:// / clawx:// / file://。
   */
  private assertUrlNotRestricted(url: string | undefined): void {
    if (url && isBrowserControlRestrictedUrl(url)) {
      throw new Error('当前页面属于浏览器受限页面，无法开启浏览器控制。请切换到普通网页后重试。');
    }
  }

  /**
   * 响应 BoundaryChoiceToolExecutor 的 pending 用户边界确认请求。
   * Renderer 侧 BoundaryChoiceDialog 用户选择后通过此方法回传结果。
   */
  respondBoundaryChoice(
    sessionId: string,
    requestId: string,
    response: { selectedChoiceIds: string[]; otherText?: string },
  ): boolean {
    const control = this.browserControlStates.get(sessionId);
    if (!control) {
      return false;
    }
    return control.boundaryExecutor.respond(requestId, response);
  }

  /**
   * 请求升级运行态模式。runtimeMode 不持久化，仅作用于当前会话生命周期。
   * expiresInMs 可选，过期后自动回退到 normal_restricted。
   */
  async requestModeUpgrade(
    payload: AgentBrowserRequestModeUpgradePayload,
  ): Promise<Omit<AgentBrowserRequestModeUpgradeResult, 'success'>> {
    const record = this.getRecord(payload.sessionId);
    const targetMode = normalizeRuntimeMode(payload.targetMode);
    if (targetMode === 'normal_restricted') {
      // 降级回 normal_restricted：清理 grant context 与过期时间
      record.runtimeMode = 'normal_restricted';
      record.runtimeExpiresAt = undefined;
      record.session = { ...record.session, runtimeMode: 'normal_restricted' };
      const control = this.browserControlStates.get(record.session.id);
      control?.boundaryExecutor.clearGrantContext();
      return {
        runtimeMode: 'normal_restricted',
        session: { ...record.session },
      };
    }

    const expiresInMs = typeof payload.expiresInMs === 'number' && Number.isFinite(payload.expiresInMs)
      ? Math.max(10_000, Math.min(3_600_000, Math.floor(payload.expiresInMs)))
      : undefined;
    record.runtimeMode = targetMode;
    record.runtimeExpiresAt = expiresInMs !== undefined ? Date.now() + expiresInMs : undefined;
    record.session = {
      ...record.session,
      runtimeMode: targetMode,
      updatedAt: this.now().toISOString(),
    };
    return {
      runtimeMode: targetMode,
      ...(record.runtimeExpiresAt !== undefined
        ? { expiresAt: new Date(record.runtimeExpiresAt).toISOString() }
        : {}),
      session: { ...record.session },
    };
  }

  private requireSelector(value: string): string {
    const selector = value?.trim();
    if (!selector) throw new Error('Agent browser selector is required');
    return selector;
  }

  private async refresh(record: AgentBrowserRecord): Promise<AgentBrowserSession> {
    const window = this.requireWindow(record);
    const webContents = window.webContents;
    record.session = {
      ...record.session,
      url: webContents.getURL(),
      title: webContents.getTitle(),
      updatedAt: this.now().toISOString(),
    };
    if (record.session.mode === 'visible') {
      window.show();
    }
    return { ...record.session };
  }

  private async refreshCli(
    sessionId: string,
    metadata: Partial<AgentBrowserSession> = {},
  ): Promise<AgentBrowserSession> {
    const record = this.getRecord(sessionId);
    record.session = {
      ...record.session,
      ...metadata,
      id: record.session.id,
      profile: record.session.profile,
      mode: record.session.mode,
      createdAt: record.session.createdAt,
      updatedAt: this.now().toISOString(),
    };
    return { ...record.session };
  }

  private snapshot(sessionId: string): AgentBrowserSession {
    return { ...this.getRecord(sessionId).session };
  }

  private async textSample(sessionId: string): Promise<string | undefined> {
    const record = this.getRecord(sessionId);
    if (record.engine === 'agent-browser-cli') {
      return await this.requireCliRunner().textSample(record.session, MAX_TEXT_SAMPLE);
    }
    try {
      const window = this.requireWindow(record);
      const value = await window.webContents.executeJavaScript(
        `document.body ? document.body.innerText.slice(0, ${MAX_TEXT_SAMPLE}) : ''`,
        true,
      );
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async captureValidationSnapshot(sessionId: string): Promise<unknown> {
    const record = this.getRecord(sessionId);
    if (record.engine === 'agent-browser-cli') {
      const result = await this.command({ sessionId, args: ['snapshot', '-i'], maxOutput: 120_000 });
      return result.data ?? result.stdout;
    }
    const snapshot = await this.evaluate({
      sessionId,
      expression: `(() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        return {
          url: location.href,
          title: document.title,
          text: clean(document.body?.innerText || '').slice(0, ${MAX_TEXT_SAMPLE}),
          links: Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map((link) => ({
            text: clean(link.textContent).slice(0, 120),
            href: link.href,
          })),
          buttons: Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
            .slice(0, 30)
            .map((button) => clean(button.textContent || button.value).slice(0, 120)),
        };
      })()`,
    });
    return snapshot.value as AgentBrowserValidationSnapshot | undefined;
  }

  private async safeCommand(sessionId: string, args: string[]): Promise<unknown> {
    try {
      const result = await this.command({ sessionId, args, maxOutput: 80_000 });
      return result.data ?? result.stdout;
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private getUserDataPath(): string {
    return this.userDataPath ?? app.getPath('userData');
  }

  private profileRootDir(): string {
    return join(this.getUserDataPath(), 'agent-browser', 'profiles');
  }

  private profileMetadataPath(): string {
    return join(this.getUserDataPath(), 'agent-browser', 'profile-metadata.json');
  }

  private async readProfileMetadata(): Promise<AgentBrowserProfileMetadataFile> {
    try {
      const content = await readFile(this.profileMetadataPath(), 'utf8');
      const parsed = JSON.parse(content) as AgentBrowserProfileMetadataFile;
      return parsed && typeof parsed === 'object'
        ? { profiles: parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {} }
        : { profiles: {} };
    } catch {
      return { profiles: {} };
    }
  }

  private runArtifactRootDir(runId: string): string {
    // P4-002 A3: refuse traversal/absolute runIds and stay under agent-browser root.
    return agentBrowserRunArtifactDir(this.getUserDataPath(), runId);
  }

  private detectLoginState(params: {
    finalUrl?: string;
    textSample?: string;
    ok: boolean;
  }): BrowserAutomationRunResult['loginState'] {
    const haystack = `${params.finalUrl ?? ''}\n${params.textSample ?? ''}`.toLowerCase();
    if (/\b(log[\s-]?in|sign[\s-]?in|password|验证码|登录|登入)\b/u.test(haystack)) {
      return 'login-required';
    }
    if (/\b(log[\s-]?out|sign[\s-]?out|account|profile|dashboard|退出登录)\b/u.test(haystack)) {
      return 'authenticated';
    }
    return params.ok ? 'unknown' : 'unknown';
  }

  private extractErrorLines(value: unknown): string[] {
    const source = typeof value === 'string'
      ? value
      : (() => {
        try {
          return JSON.stringify(value) ?? '';
        } catch {
          return String(value ?? '');
        }
      })();
    return source
      .split(/\r?\n|","|", "/)
      .map((entry) => entry.replace(/[{}[]"]/g, '').trim())
      .filter((entry) => /error|failed|exception|ERR_|4\d\d|5\d\d/iu.test(entry))
      .slice(0, 20);
  }

  private async writeJsonArtifact(
    dir: string,
    kind: AgentBrowserArtifactRef['kind'],
    label: string,
    value: unknown,
    createdAt: string,
  ): Promise<AgentBrowserArtifactRef> {
    const fileName = `${kind}.json`;
    const filePath = join(dir, fileName);
    const content = JSON.stringify(value, null, 2).slice(0, MAX_ARTIFACT_TEXT);
    await writeFile(filePath, content, 'utf8');
    return {
      id: `${kind}-${randomUUID()}`,
      kind,
      label,
      path: filePath,
      mimeType: 'application/json',
      size: Buffer.byteLength(content, 'utf8'),
      createdAt,
    };
  }

  private async writeScreenshotArtifact(
    dir: string,
    dataUrl: string,
    createdAt: string,
  ): Promise<AgentBrowserArtifactRef | undefined> {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/u.exec(dataUrl);
    if (!match) return undefined;
    const mimeType = match[1] || 'image/png';
    const ext = mimeType.includes('jpeg') ? 'jpg' : (mimeType.split('/')[1] || 'png');
    const bytes = Buffer.from(match[2] || '', 'base64');
    const filePath = join(dir, `screenshot.${ext}`);
    await writeFile(filePath, bytes);
    return {
      id: `screenshot-${randomUUID()}`,
      kind: 'screenshot',
      label: 'Screenshot',
      path: filePath,
      mimeType,
      size: bytes.byteLength,
      createdAt,
    };
  }

  private async persistBrowserAutomationRunResult(params: {
    runId: string;
    startedAt: string;
    session?: AgentBrowserSession;
    ok: boolean;
    steps: BrowserAutomationRunStep[];
    textSample?: string;
    diagnostics?: Record<string, unknown>;
    screenshotDataUrl?: string;
    error?: string;
  }): Promise<BrowserAutomationRunResult> {
    const endedAt = this.now().toISOString();
    const dir = this.runArtifactRootDir(params.runId);
    await mkdir(dir, { recursive: true });

    const artifacts: AgentBrowserArtifactRef[] = [];
    const diagnostics = params.diagnostics ?? {};
    for (const [key, value] of Object.entries(diagnostics)) {
      if (value === undefined) continue;
      const kind = key === 'snapshot' || key === 'console' || key === 'errors' || key === 'network'
        ? key
        : 'text';
      artifacts.push(await this.writeJsonArtifact(dir, kind, `${kind} diagnostics`, value, endedAt));
    }
    const screenshotArtifact = params.screenshotDataUrl
      ? await this.writeScreenshotArtifact(dir, params.screenshotDataUrl, endedAt)
      : undefined;
    if (screenshotArtifact) artifacts.push(screenshotArtifact);

    const consoleErrors = [
      ...this.extractErrorLines(diagnostics.console),
      ...this.extractErrorLines(diagnostics.errors),
    ];
    const networkErrors = this.extractErrorLines(diagnostics.network);
    const runResult: BrowserAutomationRunResult = {
      schemaVersion: 1,
      runId: params.runId,
      status: params.ok ? 'success' : 'failed',
      startedAt: params.startedAt,
      endedAt,
      ...(params.session?.profile ? { profile: params.session.profile } : {}),
      ...(params.session?.authStateName ? { authStateName: params.session.authStateName } : {}),
      ...(params.session?.url ? { finalUrl: params.session.url } : {}),
      ...(params.session?.title ? { title: params.session.title } : {}),
      loginState: this.detectLoginState({
        finalUrl: params.session?.url,
        textSample: params.textSample,
        ok: params.ok,
      }),
      steps: params.steps,
      evidence: {
        ...(params.textSample ? { textSample: params.textSample } : {}),
        artifacts,
      },
      ...(consoleErrors.length > 0 ? { consoleErrors } : {}),
      ...(networkErrors.length > 0 ? { networkErrors } : {}),
      ...(params.error ? { error: params.error } : {}),
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(runResult, null, 2), 'utf8');
    return runResult;
  }

  private requireCliRunner(): AgentBrowserRunner {
    if (!this.cliRunner) {
      throw new Error('Agent browser CLI runner is not available');
    }
    return this.cliRunner;
  }

  private createCliSession(payload: Pick<
    AgentBrowserCommandPayload,
    | 'profile'
    | 'mode'
    | 'authPersistence'
    | 'authStateName'
    | 'connectionMode'
    | 'cdpEndpoint'
    | 'externalProfile'
    | 'executablePath'
    | 'allowExternalBrowser'
  >): AgentBrowserSession {
    const profile = normalizeProfile(payload.profile);
    const authPersistence = normalizeAuthPersistence(payload.authPersistence);
    const createdAt = this.now().toISOString();
    const session: AgentBrowserSession = {
      id: randomUUID(),
      profile,
      mode: normalizeMode(payload.mode),
      authPersistence,
      authStateName: authPersistence === 'session-name'
        ? normalizeAuthStateName(payload.authStateName, profile)
        : undefined,
      connection: normalizeConnection(payload),
      createdAt,
      updatedAt: createdAt,
    };
    this.sessions.set(session.id, { session, engine: 'agent-browser-cli', runtimeMode: 'normal_restricted' });
    return session;
  }

  // ===== P1-2: Network 工具集服务方法 =====
  // 以下 7 个方法抄写自 browser-ai-assistant-master/src/background/browserControl/networkToolExecutor.ts，
  // 适配点：去掉 ModelToolCall/ModelToolResult 封装，直接以 service 方法暴露；
  // redacted 默认 true，仅当 runtimeMode === 'full_access' 且调用方显式 redacted=false 时返回原始数据。

  /**
   * 列出当前受控页面捕获到的 Network 请求元信息。
   * 元信息不含请求/响应头与 body，即使 redacted=false 也仅返回 meta。
   */
  async networkListRequests(payload: AgentBrowserNetworkListPayload): Promise<Omit<AgentBrowserNetworkListResult, 'success'>> {
    const { recorder, record } = this.getNetworkRecorder(payload.sessionId);
    const filter = normalizeNetworkFilter(payload.filter);
    const revealRaw = this.canRevealRaw(record, payload.redacted);
    const requests = recorder.listRequests(filter, { redacted: !revealRaw });
    return {
      requests: requests.map((meta) => toListMeta(revealRaw ? meta : redactNetworkRequestMeta(meta))),
    };
  }

  /**
   * 获取指定请求的详情（含 headers/body）。
   * redacted=true 或非 full_access 模式下，敏感字段会被脱敏。
   */
  async networkGetRequestDetails(payload: AgentBrowserNetworkDetailPayload): Promise<Omit<AgentBrowserNetworkDetailResult, 'success'>> {
    const { recorder, record } = this.getNetworkRecorder(payload.sessionId);
    const requestIds = normalizeRequestIds(payload.requestIds);
    const revealRaw = this.canRevealRaw(record, payload.redacted);
    const details = await recorder.getDetails(requestIds, { redacted: !revealRaw });
    return { details: revealRaw ? details : details.map(redactNetworkRequestDetail) };
  }

  /**
   * 清空当前受控页面的 Network 请求缓存。
   */
  async networkClearRequests(payload: AgentBrowserNetworkClearPayload): Promise<Omit<AgentBrowserNetworkClearResult, 'success'>> {
    const { recorder } = this.getNetworkRecorder(payload.sessionId);
    recorder.clear();
    return {};
  }

  /**
   * 等待匹配 filter 的 Network 请求出现，超时返回已捕获的匹配项。
   */
  async networkWaitForRequests(payload: AgentBrowserNetworkWaitPayload): Promise<Omit<AgentBrowserNetworkWaitResult, 'success'>> {
    const { recorder, record } = this.getNetworkRecorder(payload.sessionId);
    const filter = normalizeNetworkWaitFilter(payload.filter);
    const revealRaw = this.canRevealRaw(record, payload.redacted);
    const requests = await recorder.waitForRequests(filter, { redacted: !revealRaw });
    return {
      requests: requests.map((meta) => toListMeta(revealRaw ? meta : redactNetworkRequestMeta(meta))),
    };
  }

  /**
   * 对比多个请求的稳定字段与变化字段，输出疑似关键参数候选。
   * 至少需要 2 个请求才能对比。
   */
  async networkCompareRequests(payload: AgentBrowserNetworkComparePayload): Promise<Omit<AgentBrowserNetworkCompareResult, 'success'>> {
    const { recorder, record } = this.getNetworkRecorder(payload.sessionId);
    const requestIds = normalizeRequestIds(payload.requestIds);
    const revealRaw = this.canRevealRaw(record, payload.redacted);
    const details = await recorder.getDetails(requestIds, { redacted: !revealRaw });
    return { comparison: compareNetworkRequests(details) };
  }

  /**
   * 从请求详情中提取疑似签名/时间戳/nonce/凭据参数候选。
   */
  async networkFindParameterCandidates(payload: AgentBrowserNetworkFindParamsPayload): Promise<Omit<AgentBrowserNetworkFindParamsResult, 'success'>> {
    const { recorder, record } = this.getNetworkRecorder(payload.sessionId);
    const requestIds = normalizeRequestIds(payload.requestIds);
    const revealRaw = this.canRevealRaw(record, payload.redacted);
    const details = await recorder.getDetails(requestIds, { redacted: !revealRaw });
    return { candidates: formatParameterCandidates(findParameterCandidates(details)) };
  }

  /**
   * 从 JS 资源响应体中按 keywords 提取候选片段。
   * 不依赖 jsSourceIndex/P2 模块，仅对 Script 资源做正则匹配。
   */
  async networkExtractJsCandidates(payload: AgentBrowserNetworkExtractJsPayload): Promise<Omit<AgentBrowserNetworkExtractJsResult, 'success'>> {
    const { recorder, record } = this.getNetworkRecorder(payload.sessionId);
    const requestIds = payload.requestIds && payload.requestIds.length > 0
      ? normalizeRequestIds(payload.requestIds)
      : [];
    const revealRaw = this.canRevealRaw(record, payload.redacted);
    const details = requestIds.length > 0
      ? await recorder.getDetails(requestIds, { redacted: !revealRaw })
      : recorder.listRequests({}, { redacted: !revealRaw })
          .filter((meta) => isJavaScriptMeta(meta))
          .map((meta) => ({ ...meta, truncated: false, redacted: !revealRaw }) as NetworkRequestDetail);
    return { candidates: extractJsCandidates(details, { keywords: payload.keywords, urlIncludes: payload.urlIncludes }) };
  }

  // ===== P2-1：JS 资源索引 =====

  async jsListResources(payload: AgentBrowserJsListResourcesPayload): Promise<Omit<AgentBrowserJsListResourcesResult, 'success'>> {
    const { jsSourceExecutor } = this.getJsSourceExecutor(payload.sessionId);
    return jsSourceExecutor.listResources();
  }

  async jsSearchSources(payload: AgentBrowserJsSearchSourcesPayload): Promise<Omit<AgentBrowserJsSearchSourcesResult, 'success'>> {
    const { jsSourceExecutor, record } = this.getJsSourceExecutor(payload.sessionId);
    // 仅 controlled_enhanced / full_access 模式允许同源 JS 补位抓取
    const allowSameOriginFetch = payload.allowSameOriginFetch === true
      && (record.runtimeMode === 'controlled_enhanced' || record.runtimeMode === 'full_access');
    return jsSourceExecutor.searchSources({
      keywords: payload.keywords,
      urls: payload.urls,
      limit: payload.limit,
      allowSameOriginFetch,
    });
  }

  async jsExtractContext(payload: AgentBrowserJsExtractContextPayload): Promise<Omit<AgentBrowserJsExtractContextResult, 'success'>> {
    const { jsSourceExecutor } = this.getJsSourceExecutor(payload.sessionId);
    return jsSourceExecutor.extractContext({
      resourceId: payload.resourceId,
      position: payload.position,
    });
  }

  /**
   * 获取指定 session 的 JS 源码执行器，复用 getNetworkRecorder 的安全校验链。
   */
  private getJsSourceExecutor(sessionId: string): { jsSourceExecutor: JsSourceToolExecutor; record: AgentBrowserRecord } {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('JS 源码工具仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { jsSourceExecutor: state.jsSourceExecutor, record };
  }

  async sourceMapListCandidates(payload: AgentBrowserSourceMapListCandidatesPayload): Promise<Omit<AgentBrowserSourceMapListCandidatesResult, 'success'>> {
    const { sourceMapExecutor, record } = this.getSourceMapExecutor(payload.sessionId);
    const allowSameOriginFetch = payload.allowSameOriginFetch === true
      && (record.runtimeMode === 'controlled_enhanced' || record.runtimeMode === 'full_access');
    return sourceMapExecutor.listCandidates({
      resourceIds: payload.resourceIds,
      limit: payload.limit,
      allowSameOriginFetch,
    });
  }

  async sourceMapResolveLocation(payload: AgentBrowserSourceMapResolveLocationPayload): Promise<Omit<AgentBrowserSourceMapResolveLocationResult, 'success'>> {
    const { sourceMapExecutor, record } = this.getSourceMapExecutor(payload.sessionId);
    const allowSameOriginFetch = payload.allowSameOriginFetch === true
      && (record.runtimeMode === 'controlled_enhanced' || record.runtimeMode === 'full_access');
    return sourceMapExecutor.resolveLocation({
      resourceId: payload.resourceId,
      line: payload.line,
      column: payload.column,
      allowSameOriginFetch,
    });
  }

  async sourceMapExtractOriginalContext(payload: AgentBrowserSourceMapExtractOriginalContextPayload): Promise<Omit<AgentBrowserSourceMapExtractOriginalContextResult, 'success'>> {
    const { sourceMapExecutor, record } = this.getSourceMapExecutor(payload.sessionId);
    const allowSameOriginFetch = payload.allowSameOriginFetch === true
      && (record.runtimeMode === 'controlled_enhanced' || record.runtimeMode === 'full_access');
    return sourceMapExecutor.extractOriginalContext({
      resourceId: payload.resourceId,
      line: payload.line,
      column: payload.column,
      radius: payload.radius,
      allowSameOriginFetch,
    });
  }

  /**
   * 获取指定 session 的 Source Map 执行器，复用 getJsSourceExecutor 的安全校验链。
   */
  private getSourceMapExecutor(sessionId: string): { sourceMapExecutor: SourceMapToolExecutor; record: AgentBrowserRecord } {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Source Map 工具仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { sourceMapExecutor: state.sourceMapExecutor, record };
  }

  async runtimeInspectGlobals(payload: AgentBrowserRuntimeInspectGlobalsPayload): Promise<Omit<AgentBrowserRuntimeInspectGlobalsResult, 'success'>> {
    const { runtimeReadExecutor } = this.getRuntimeReadExecutor(payload.sessionId);
    return runtimeReadExecutor.inspectGlobals({
      paths: payload.paths,
      maxDepth: payload.maxDepth,
      limit: payload.limit,
    });
  }

  async runtimeSearchModules(payload: AgentBrowserRuntimeSearchModulesPayload): Promise<Omit<AgentBrowserRuntimeSearchModulesResult, 'success'>> {
    const { runtimeReadExecutor } = this.getRuntimeReadExecutor(payload.sessionId);
    return runtimeReadExecutor.searchModules({
      keywords: payload.keywords,
      limit: payload.limit,
      radius: payload.radius,
    });
  }

  async runtimeDescribeFunction(payload: AgentBrowserRuntimeDescribeFunctionPayload): Promise<Omit<AgentBrowserRuntimeDescribeFunctionResult, 'success'>> {
    const { runtimeReadExecutor } = this.getRuntimeReadExecutor(payload.sessionId);
    return runtimeReadExecutor.describeFunction({
      path: payload.path,
      keywords: payload.keywords,
      radius: payload.radius,
    });
  }

  /**
   * 获取指定 session 的 Runtime 只读执行器，复用安全校验链。
   */
  private getRuntimeReadExecutor(sessionId: string): { runtimeReadExecutor: RuntimeReadToolExecutor; record: AgentBrowserRecord } {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Runtime 只读工具仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { runtimeReadExecutor: state.runtimeReadExecutor, record };
  }

  /**
   * 构造 Runtime 只读授权上下文。
   * controlled_enhanced 模式映射为 controlled_enhanced（允许 runtime read）；
   * normal_restricted 映射为 normal（fail-closed）；full_access 映射为 full_access（fail-closed，必须走 full_access.*）。
   */
  private getRuntimeReadAuthorization(record: AgentBrowserRecord): ToolAuthorizationContext {
    const mode: ToolAuthorizationContext['mode'] = record.runtimeMode === 'controlled_enhanced'
      ? 'controlled_enhanced'
      : record.runtimeMode === 'full_access'
        ? 'full_access'
        : 'normal';
    return {
      mode,
      createdAt: record.runtimeExpiresAt ? record.runtimeExpiresAt - 60000 : Date.now(),
      expiresAt: record.runtimeExpiresAt,
      reason: `runtimeMode=${record.runtimeMode}`,
    };
  }

  async replayPrepareRequest(payload: AgentBrowserReplayPrepareRequestPayload): Promise<Omit<AgentBrowserReplayPrepareRequestResult, 'success'>> {
    const { replayExecutor } = this.getReplayExecutor(payload.sessionId);
    return replayExecutor.prepareRequest({ requestId: payload.requestId });
  }

  async replaySendRequest(payload: AgentBrowserReplaySendRequestPayload): Promise<Omit<AgentBrowserReplaySendRequestResult, 'success'>> {
    const { replayExecutor } = this.getReplayExecutor(payload.sessionId);
    return replayExecutor.sendRequest({ draftId: payload.draftId });
  }

  async replayCompareResponses(payload: AgentBrowserReplayCompareResponsesPayload): Promise<Omit<AgentBrowserReplayCompareResponsesResult, 'success'>> {
    const { replayExecutor } = this.getReplayExecutor(payload.sessionId);
    return replayExecutor.compareResponses({ draftId: payload.draftId });
  }

  private getReplayExecutor(sessionId: string): { replayExecutor: ReplayToolExecutor; record: AgentBrowserRecord } {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('请求重放沙箱仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { replayExecutor: state.replayExecutor, record };
  }

  async fullAccessExecuteScript(payload: AgentBrowserFullAccessExecuteScriptPayload): Promise<Omit<AgentBrowserFullAccessExecuteScriptResult, 'success'>> {
    const { fullAccessExecutor } = this.getFullAccessExecutor(payload.sessionId);
    return fullAccessExecutor.executeScript({ script: payload.script, awaitPromise: payload.awaitPromise });
  }

  async fullAccessFetch(payload: AgentBrowserFullAccessFetchPayload): Promise<Omit<AgentBrowserFullAccessFetchResult, 'success'>> {
    const { fullAccessExecutor } = this.getFullAccessExecutor(payload.sessionId);
    return fullAccessExecutor.fetchFromPage({
      url: payload.url,
      method: payload.method,
      headers: payload.headers,
      body: payload.body,
      credentials: payload.credentials,
    });
  }

  async fullAccessGetNetworkDetails(payload: AgentBrowserFullAccessGetNetworkDetailsPayload): Promise<Omit<AgentBrowserFullAccessGetNetworkDetailsResult, 'success'>> {
    const { fullAccessExecutor } = this.getFullAccessExecutor(payload.sessionId);
    return fullAccessExecutor.getNetworkDetails({ requestIds: payload.requestIds });
  }

  async fullAccessReadStorage(payload: AgentBrowserFullAccessReadStoragePayload): Promise<Omit<AgentBrowserFullAccessReadStorageResult, 'success'>> {
    const { fullAccessExecutor } = this.getFullAccessExecutor(payload.sessionId);
    return fullAccessExecutor.readStorage();
  }

  fullAccessRevoke(payload: AgentBrowserFullAccessRevokePayload): Omit<AgentBrowserFullAccessRevokeResult, 'success'> {
    const { fullAccessExecutor } = this.getFullAccessExecutor(payload.sessionId);
    return fullAccessExecutor.revokeFullAccess();
  }

  private getFullAccessExecutor(sessionId: string): { fullAccessExecutor: FullAccessToolExecutor; record: AgentBrowserRecord } {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('完全访问模式仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { fullAccessExecutor: state.fullAccessExecutor, record };
  }

  /**
   * 判断当前会话是否处于完全访问模式（fail-closed：过期或未升级均返回 false）。
   */
  private isFullAccess(record: AgentBrowserRecord): boolean {
    this.refreshRuntimeModeExpiry(record);
    return record.runtimeMode === 'full_access';
  }

  /**
   * 撤销完全访问运行态：回退到 normal_restricted 并清理 grant context。
   * 不持久化，仅作用于当前会话生命周期。
   */
  private revokeFullAccessRuntime(record: AgentBrowserRecord): void {
    record.runtimeMode = 'normal_restricted';
    record.runtimeExpiresAt = undefined;
    record.session = { ...record.session, runtimeMode: 'normal_restricted' };
    const control = this.browserControlStates.get(record.session.id);
    control?.boundaryExecutor.clearGrantContext();
  }

  async extractPageText(payload: AgentBrowserExtractPageTextPayload): Promise<Omit<AgentBrowserExtractPageTextResult, 'success'>> {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(payload.sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('页面文本提取仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    const window = record.window;
    if (!window) {
      throw new Error('浏览器窗口不可用。');
    }
    return state.pageTextExtractor.extract({
      url: window.webContents.getURL(),
      rules: payload.rules,
      maxLength: payload.maxLength,
      extractMode: payload.extractMode,
      selectorType: payload.selectorType,
      allowFallback: payload.allowFallback,
    });
  }

  validateExtractionRule(payload: AgentBrowserValidateExtractionRulePayload): Omit<AgentBrowserValidateExtractionRuleResult, 'success'> {
    const result = validateExtractionRuleDraft({
      alias: payload.alias,
      urlPattern: payload.urlPattern,
      selectorsText: payload.selectorsText,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  }

  /**
   * 获取指定 session 的 Network 录制器与 record，校验浏览器控制开关 + 运行态模式 + 会话存在性 + engine。
   * 调用顺序遵循 P1-1 安全优先设计：先 enabled，再 record，再 runtime mode，最后 control state。
   */
  private getNetworkRecorder(sessionId: string): { recorder: BrowserNetworkRecorder; record: AgentBrowserRecord } {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Network 工具仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { recorder: state.networkRecorder, record };
  }

  /**
   * 获取 browser-window 引擎下累积的 Console 消息摘要。
   * 通过 BrowserConsoleRecorder 状态化累积 Runtime.consoleAPICalled / Runtime.exceptionThrown / Log.entryAdded 事件。
   */
  async getConsoleMessages(payload: AgentBrowserConsoleMessagesPayload): Promise<Omit<AgentBrowserConsoleMessagesResult, 'success'>> {
    this.assertBrowserControlEnabled();
    const record = this.getRecord(payload.sessionId);
    if (record.engine !== 'browser-window') {
      throw new Error('Console 消息工具仅支持 browser-window 引擎，当前会话使用 agent-browser-cli 引擎。');
    }
    this.assertActionAllowed(record);
    const state = this.browserControlStates.get(record.session.id);
    if (!state) {
      throw new Error('浏览器控制尚未初始化，请先调用 takeSnapshot 触发 CDP attach。');
    }
    return { content: state.consoleRecorder.formatMessages() };
  }

  /**
   * 判断当前会话是否可以返回原始（未脱敏）的 Network 数据。
   * 仅当 runtimeMode === 'full_access' 且调用方显式 redacted=false 时为 true。
   * normal_restricted / controlled_enhanced 模式下永远返回 false（脱敏）。
   */
  private canRevealRaw(record: AgentBrowserRecord, redacted: boolean | undefined): boolean {
    if (redacted !== false) return false;
    this.refreshRuntimeModeExpiry(record);
    return record.runtimeMode === 'full_access';
  }

  private requireWindow(record: AgentBrowserRecord): AgentBrowserWindow {
    if (!record.window) {
      throw new Error(`Agent browser window is not available for session: ${record.session.id}`);
    }
    return record.window;
  }
}

// ===== P1-2: Network 工具集模块级辅助函数 =====
// 抄写自 browser-ai-assistant-master/src/background/browserControl/networkToolExecutor.ts，
// 适配点：去掉 ModelToolCall 相关引用，直接以纯函数形式服务于 service 方法。

const NETWORK_MAX_DETAIL_IDS = 100;
const NETWORK_MAX_REQUEST_ID_LENGTH = 256;
const NETWORK_MAX_LIST_LIMIT = 200;
const NETWORK_MAX_FILTER_TEXT_LENGTH = 200;
const NETWORK_MAX_METHOD_LENGTH = 32;
const NETWORK_MAX_RESOURCE_TYPE_LENGTH = 64;
const NETWORK_MAX_KEYWORDS = 20;
const NETWORK_JS_SNIPPET_RADIUS = 120;
const NETWORK_DEFAULT_JS_KEYWORDS = ['sign', 'signature', 'encrypt', 'crypto', 'md5', 'sha', 'aes', 'nonce', 'timestamp', 'token'];
const NETWORK_REQUEST_IDS_INVALID_MESSAGE = 'requestIds 必须是包含 1 到 100 个非空字符串的数组。';

interface NetworkParameterCandidate {
  location: string;
  name: string;
  value: string;
  reason: string;
}

function normalizeNetworkFilter(filter: AgentBrowserNetworkFilter | undefined): NetworkRequestFilter {
  if (!filter) return {};
  return {
    urlIncludes: normalizeOptionalString(filter.urlIncludes, NETWORK_MAX_FILTER_TEXT_LENGTH),
    method: normalizeOptionalString(filter.method, NETWORK_MAX_METHOD_LENGTH),
    resourceType: normalizeOptionalString(filter.resourceType, NETWORK_MAX_RESOURCE_TYPE_LENGTH),
    status: typeof filter.status === 'number' && Number.isInteger(filter.status) ? filter.status : undefined,
    limit: normalizeLimit(filter.limit),
  };
}

function normalizeNetworkWaitFilter(filter: AgentBrowserNetworkFilter | undefined): NetworkWaitFilter {
  const base = normalizeNetworkFilter(filter);
  const timeoutMs = filter && typeof filter.timeoutMs === 'number' ? filter.timeoutMs : undefined;
  return timeoutMs !== undefined ? { ...base, timeoutMs } : base;
}

function normalizeRequestIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > NETWORK_MAX_DETAIL_IDS) {
    throw new Error(NETWORK_REQUEST_IDS_INVALID_MESSAGE);
  }
  const requestIds = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (requestIds.some((item) => !item || item.length > NETWORK_MAX_REQUEST_ID_LENGTH)) {
    throw new Error(NETWORK_REQUEST_IDS_INVALID_MESSAGE);
  }
  return Array.from(new Set(requestIds));
}

function normalizeOptionalString(value: unknown, maxLength = NETWORK_MAX_FILTER_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.floor(value), 1), NETWORK_MAX_LIST_LIMIT);
}

function toListMeta(meta: NetworkRequestMeta): {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  resourceType?: string;
  failed?: boolean;
  error?: string;
} {
  return {
    id: meta.id,
    url: meta.url,
    method: meta.method,
    ...(meta.status !== undefined ? { status: meta.status } : {}),
    ...(meta.statusText !== undefined ? { statusText: meta.statusText } : {}),
    ...(meta.mimeType !== undefined ? { mimeType: meta.mimeType } : {}),
    ...(meta.resourceType !== undefined ? { resourceType: meta.resourceType } : {}),
    ...(meta.failed !== undefined ? { failed: meta.failed } : {}),
    ...(meta.error !== undefined ? { error: meta.error } : {}),
  };
}

function isJavaScriptMeta(meta: { url: string; mimeType?: string; resourceType?: string }): boolean {
  const pathname = safeUrl(meta.url).pathname.toLowerCase();
  const mimeType = meta.mimeType?.toLowerCase() ?? '';
  const resourceType = meta.resourceType?.toLowerCase() ?? '';
  return resourceType === 'script' || /\.(?:m?js)$/i.test(pathname) || isTrustedJavaScriptMime(mimeType);
}

function isTrustedJavaScriptMime(mimeType: string): boolean {
  const normalized = mimeType.split(';', 1)[0]?.trim() ?? '';
  return normalized === 'application/javascript' ||
    normalized === 'text/javascript' ||
    normalized === 'application/ecmascript' ||
    normalized === 'text/ecmascript' ||
    normalized === 'application/x-javascript';
}

function compareNetworkRequests(details: NetworkRequestDetail[]): string {
  if (details.length < 2) {
    return '至少需要两个请求才能进行对比。';
  }
  const fieldsByRequest = details.map(flattenRequestFields);
  const allKeys = Array.from(new Set(fieldsByRequest.flatMap((fields) => Array.from(fields.keys())))).sort();
  const stableFields: string[] = [];
  const changedFields: string[] = [];
  for (const key of allKeys) {
    const values = fieldsByRequest.map((fields) => fields.get(key) ?? '');
    const uniqueValues = Array.from(new Set(values));
    if (uniqueValues.length <= 1) {
      stableFields.push(`${key}=${truncateText(uniqueValues[0] ?? '', 160).text}`);
    } else {
      changedFields.push(`${key}: ${uniqueValues.map((value) => truncateText(value, 80).text).join(' -> ')}`);
    }
  }
  const candidates = findParameterCandidates(details);
  return [
    'Network 请求对比结果',
    '',
    '稳定字段：',
    stableFields.slice(0, 30).map((item) => `- ${item}`).join('\n') || '- 无',
    '',
    '变化字段：',
    changedFields.slice(0, 50).map((item) => `- ${item}`).join('\n') || '- 无',
    '',
    '疑似关键参数：',
    formatParameterCandidates(candidates),
  ].join('\n');
}

function flattenRequestFields(detail: NetworkRequestDetail): Map<string, string> {
  const fields = new Map<string, string>();
  fields.set('method', detail.method);
  fields.set('path', safeUrl(detail.url).pathname);
  for (const [key, value] of safeUrl(detail.url).searchParams.entries()) {
    fields.set(`query.${key}`, value);
  }
  for (const header of detail.requestHeaders ?? []) {
    fields.set(`requestHeader.${header.name.toLowerCase()}`, header.value);
  }
  for (const [key, value] of parseBodyFields(detail.requestBody, detail.requestHeaders)) {
    fields.set(`body.${key}`, value);
  }
  return fields;
}

function findParameterCandidates(details: NetworkRequestDetail[]): NetworkParameterCandidate[] {
  const candidates: NetworkParameterCandidate[] = [];
  for (const detail of details) {
    for (const [key, value] of safeUrl(detail.url).searchParams.entries()) {
      appendParameterCandidate(candidates, 'query', key, value);
    }
    for (const header of detail.requestHeaders ?? []) {
      appendParameterCandidate(candidates, 'requestHeader', header.name, header.value);
    }
    for (const [key, value] of parseBodyFields(detail.requestBody, detail.requestHeaders)) {
      appendParameterCandidate(candidates, 'body', key, value);
    }
  }
  return candidates;
}

function appendParameterCandidate(candidates: NetworkParameterCandidate[], location: string, name: string, value: string): void {
  const lowerName = name.toLowerCase();
  const lowerValue = value.toLowerCase();
  const reasons: string[] = [];
  if (/sign|signature|sig|x-sign/.test(lowerName)) reasons.push('疑似签名字段');
  if (/timestamp|time|ts|_t/.test(lowerName)) reasons.push('疑似时间戳字段');
  if (/nonce|uuid|requestid|traceid|random/.test(lowerName)) reasons.push('疑似随机数或请求标识字段');
  if (/token|authorization|cookie/.test(lowerName)) reasons.push('疑似凭据字段');
  if (/^[a-f0-9]{24,}$/i.test(value) || /^[a-z0-9_-]{32,}$/i.test(value) || /[+/=]{2,}/.test(value) || lowerValue.includes('%3d')) {
    reasons.push('疑似加密或编码载荷');
  }
  for (const reason of reasons) {
    candidates.push({ location, name, value: truncateText(value, 160).text, reason });
  }
}

function formatParameterCandidates(candidates: NetworkParameterCandidate[]): string {
  if (candidates.length === 0) return '未发现明显的参数候选。';
  return candidates
    .slice(0, 80)
    .map((candidate) => `- ${candidate.reason}: ${candidate.location}.${candidate.name}=${candidate.value}`)
    .join('\n');
}

function extractJsCandidates(details: NetworkRequestDetail[], args: { keywords?: string[]; urlIncludes?: string }): string {
  const keywords = normalizeStringArray(args.keywords);
  const urlIncludes = normalizeOptionalString(args.urlIncludes);
  const searchTerms = keywords.length ? keywords : NETWORK_DEFAULT_JS_KEYWORDS;
  const sections: string[] = [];
  for (const detail of details) {
    if (!isJavaScriptMeta(detail)) continue;
    const body = detail.responseBody ?? '';
    const matches = [...searchTerms, ...(urlIncludes ? [urlIncludes] : [])].flatMap((term) => findSnippets(body, term));
    if (matches.length === 0) continue;
    sections.push([
      `JS 候选资源：${detail.url}`,
      ...matches.slice(0, 8).map((match) => `- 命中 ${match.term}: ${match.snippet}`),
    ].join('\n'));
  }
  return sections.length ? sections.join('\n\n') : '未找到匹配的 JS 候选资源。';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => (typeof item === 'string' ? item.trim().slice(0, NETWORK_MAX_FILTER_TEXT_LENGTH) : '')).filter(Boolean))).slice(0, NETWORK_MAX_KEYWORDS);
}

function findSnippets(text: string, term: string): Array<{ term: string; snippet: string }> {
  if (!text || !term) return [];
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const index = lowerText.indexOf(lowerTerm);
  if (index < 0) return [];
  const start = Math.max(0, index - NETWORK_JS_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + term.length + NETWORK_JS_SNIPPET_RADIUS);
  return [{ term, snippet: truncateText(text.slice(start, end).replace(/\s+/g, ' '), 320).text }];
}

function parseBodyFields(body: string | undefined, requestHeaders: NetworkHeader[] | undefined): Array<[string, string]> {
  if (!body) return [];
  if (isJsonBody(requestHeaders)) {
    try {
      const parsed = JSON.parse(body) as unknown;
      return flattenJson(parsed);
    } catch {
      return [['body', truncateText(body, 320).text]];
    }
  }
  if (isFormUrlEncoded(requestHeaders)) {
    const params = new URLSearchParams(body);
    return Array.from(params.entries());
  }
  return [['body', truncateText(body, 320).text]];
}

function isJsonBody(headers: NetworkHeader[] | undefined): boolean {
  return headers?.some((header) => header.name.toLowerCase() === 'content-type' && header.value.toLowerCase().includes('json')) ?? false;
}

function isFormUrlEncoded(headers: NetworkHeader[] | undefined): boolean {
  return headers?.some((header) => header.name.toLowerCase() === 'content-type' && header.value.toLowerCase().includes('application/x-www-form-urlencoded')) ?? false;
}

function flattenJson(value: unknown, prefix = ''): Array<[string, string]> {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [[prefix || 'value', String(value)]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, item]) => flattenJson(item, prefix ? `${prefix}.${key}` : key));
}

function safeUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return new URL(value, 'https://example.invalid');
  }
}
