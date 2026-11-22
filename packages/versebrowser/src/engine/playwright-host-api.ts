/**
 * Standalone playwright-core driver — TF-0020 Live MCP without host injection.
 *
 * Implements the open/nav/act/observe/console/network/close subset of
 * AgentBrowserHostApi. Other methods throw a stable E_NOT_IMPLEMENTED so the
 * MCP surface can stay complete while Drive stays thin (borrow Playwright).
 */
import { randomUUID } from 'node:crypto';
import { getWorkspaceRoot } from '../host/workspace-paths.ts';
import { assertInsideRoot } from '../evidence/path-guard.ts';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertAgentBrowserNavigateUrl } from '../security/url-policy.ts';
import { redactNetworkRequestDetail, redactNetworkRequestMeta } from '../core/network-context.ts';
import { PageTextExtractor } from './browser-control/page-text-extractor.ts';
import { RuntimeReadToolExecutor } from './browser-control/runtime-read-tool-executor.ts';
import { assertBrowserRuntime } from './runtime-compatibility.ts';
import { assertTransferTimeoutMs } from './upstream-control.ts';
import {
  assertKitesurfLoopback,
  assertKitesurfMethod,
  connectKitesurfOverCDP,
  isKitesurfVersion,
  readCdpVersion,
} from './kitesurf-cdp.ts';
import type { createUpstreamPageControl } from './upstream-control.ts';
import type { Page as UpstreamPage } from 'playwright';
import type { SemanticGateway, attachSemanticBrowser, prepareSemanticBrowser } from './semantic-browser.ts';
import {
  allocatePort,
  cdpEndpoint,
  closeBrowserThroughCdp,
  launchDetachedBrowser,
  loadSessionRecord,
  loadWindow,
  removeSession,
  saveSessionRecord,
  saveWindow,
  sessionDir,
  waitForCdpEndpoint,
  waitForEndpointDown,
  type DetachedBrowserProcess,
} from './persistent-sessions.ts';
import {
  buildCollectInteractiveExpression,
  observeFieldAction,
  assertSelectValues,
  assertFieldFocused,
  dragWithNativeStart,
  formatActionableSnapshot,
  resolveClickableDiscovery,
  resolveRefSelector,
  type InteractiveElement,
} from './interactive-snapshot.ts';
import type {
  AgentBrowserHostApi,
  AgentBrowserSemanticPayload,
  AgentBrowserSemanticResult,
  AgentBrowserNavigatePayload,
  AgentBrowserNetworkListPayload,
  AgentBrowserNetworkListResult,
  AgentBrowserNetworkDetailPayload,
  AgentBrowserNetworkDetailResult,
  AgentBrowserNetworkWaitPayload,
  AgentBrowserNetworkWaitResult,
  AgentBrowserOpenPayload,
  AgentBrowserScreenshotPayload,
  AgentBrowserScreenshotResult,
  AgentBrowserSelectorPayload,
  AgentBrowserSession,
  AgentBrowserSessionMode,
  AgentBrowserSessionPayload,
  AgentBrowserSessionResult,
  AgentBrowserActionResult,
  AgentBrowserExtractPageTextPayload,
  AgentBrowserExtractPageTextResult,
  AgentBrowserTakeSnapshotPayload,
  AgentBrowserTakeSnapshotResult,
  AgentBrowserFindPayload,
  AgentBrowserFindResult,
  AgentBrowserConsoleMessagesPayload,
  AgentBrowserConsoleMessagesResult,
  AgentBrowserTypePayload,
  AgentBrowserPressKeyPayload,
  AgentBrowserClickPayload,
  AgentBrowserDownloadPayload,
  AgentBrowserDownloadResult,
  AgentBrowserUploadPayload,
  AgentBrowserUploadResult,
  AgentBrowserPointerPayload,
  AgentBrowserDragPayload,
  AgentBrowserClickByUidPayload,
  AgentBrowserFillByUidPayload,
  AgentBrowserEvaluatePayload,
  AgentBrowserEvaluateResult,
  AgentBrowserPdfPayload,
  AgentBrowserPdfResult,
  AgentBrowserRuntimeInspectGlobalsPayload,
  AgentBrowserRuntimeInspectGlobalsResult,
  AgentBrowserStatusResult,
  HostSuccess,
} from '../types/host-api.ts';
import type { ToolAuthorizationContext } from '../core/tool-authorization.ts';

type PlaywrightContext = {
  pages: () => PlaywrightPage[];
  newPage: (options?: { viewport?: { width: number; height: number } }) => Promise<PlaywrightPage>;
};

type PlaywrightBrowser = {
  newPage: (options?: { viewport?: { width: number; height: number }; serviceWorkers?: 'block'; acceptDownloads?: boolean }) => Promise<PlaywrightPage>;
  contexts: () => PlaywrightContext[];
  newContext: (options?: { viewport?: { width: number; height: number }; serviceWorkers?: 'block'; acceptDownloads?: boolean }) => Promise<PlaywrightContext>;
  close: () => Promise<void>;
  isConnected: () => boolean;
};

type PlaywrightPage = {
  mouse: UpstreamPage['mouse'];
  goto: (url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' }) => Promise<unknown>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  click: (selector: string, options?: { timeout?: number }) => Promise<void>;
  fill: (selector: string, text: string) => Promise<void>;
  locator: UpstreamPage['locator'];
  selectOption: (selector: string, option: { label: string }, options?: { timeout?: number }) => Promise<string[]>;
  setChecked: (selector: string, checked: boolean, options?: { timeout?: number }) => Promise<void>;
  screenshot: (options?: { fullPage?: boolean; timeout?: number }) => Promise<Buffer>;
  content: () => Promise<string>;
  url: () => string;
  title: () => Promise<string>;
  evaluate: (expression: string) => Promise<unknown>;
  close: () => Promise<void>;
  bringToFront?: () => Promise<void>;
  on: (event: string, handler: (...args: never[]) => void) => void;
  isClosed: () => boolean;
  mainFrame?: () => unknown;
  /** TF-0113: keyboard input for Enter-submit forms and keyboard-driven widgets. */
  focus?: (selector: string, options?: { timeout?: number }) => Promise<void>;
  keyboard?: PlaywrightKeyboard;
};

type PlaywrightKeyboard = {
  press: (key: string, options?: { delay?: number }) => Promise<void>;
};

type PlaywrightChromium = {
  launch: (options?: {
    headless?: boolean;
    executablePath?: string;
    chromiumSandbox?: boolean;
    downloadsPath?: string;
    ignoreDefaultArgs?: string[];
    args?: string[];
  }) => Promise<PlaywrightBrowser>;
  /** Attach to a browser that is already running (detached or external). */
  connectOverCDP: (endpoint: string) => Promise<PlaywrightBrowser>;
  /** Absolute path of the bundled browser binary (used to launch it detached). */
  executablePath: () => string;
};

type NetRow = AgentBrowserNetworkListResult['requests'][number];
type ConsoleLine = { type?: string; text?: string; message?: unknown };

/** Per-request capture for `networkGetRequestDetails` (TF-0103). */
type NetworkCapture = {
  completion?: 'pending' | 'complete' | 'failed';
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
  mimeType?: string;
  /** Resolves to the body, or null when it was not captured or is no longer available. */
  body?: () => Promise<Buffer | null>;
};

/** Only textual, bounded responses get their body read eagerly. */
const CAPTURE_BODY_MAX_BYTES = 256 * 1024;
const CAPTURE_BODY_TEXTUAL = /json|text|xml|javascript|urlencoded/i;
/** Body characters handed back per request (same budget as the recorder). */
const DETAIL_BODY_LIMIT = 12_000;

/**
 * TF-0105: the thin driver only ever reads the page the caller opened itself, so
 * the executor's read-only authorization is satisfied locally; the *elevation*
 * gate (session mode ≥ `controlled_enhanced`) is enforced one layer up in
 * `AgentBrowserFacade.runtimeRead`. Arbitrary script execution remains
 * unavailable here — only the fixed runtime-read template runs.
 */
const RUNTIME_READ_AUTHORIZATION: ToolAuthorizationContext = {
  mode: 'runtime_readonly',
  createdAt: 0,
};

function headerList(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

type PageSignals = {
  fileDownloadPending?: boolean;
  partialReason?: string;
  pendingNavigationId?: string;
  consoleLines: ConsoleLine[];
  network: NetRow[];
  captureEpoch: string;
  /** Request-id → captured headers/body (TF-0103). */
  networkCaptures: Map<string, NetworkCapture>;
  netSeq: number;
  /**
   * Where the persisted "current page" window starts inside `network` /
   * `consoleLines`. Reset on every navigation, so a later process judges the
   * page it did not itself drive (TF-0097).
   */
  windowStart: { network: number; console: number };
  observationWindowMissing?: boolean;
};

type SessionState = {
  upstream?: Awaited<ReturnType<typeof createUpstreamPageControl>>;
  semantic?: Awaited<ReturnType<typeof attachSemanticBrowser>>;
  session: AgentBrowserSession;
  browser: PlaywrightBrowser;
  page: PlaywrightPage;
  signals: PageSignals;
  pageSignals?: Map<PlaywrightPage,PageSignals>;
  /** Detached browser kept alive across CLI processes (TF-0097). */
  persistent?: { pid: number; profileDir: string; endpoint: string; external?: boolean };
  /** Loopback Kitesurf CDP. Methods outside the one-shot subset are refused. */
  kitesurf?: boolean;
};

function observeNativeAction(state: SessionState, timeoutMs = 5000, after?: AgentBrowserClickPayload['after']) {
  let beforeUrl = '', networkStart = 0, sinceCursor = '';
  let page = state.page as unknown as UpstreamPage;
  let signals = state.signals;
  const deadline = Date.now() + (timeoutMs ?? 5000);
  let eventDone!: () => void;
  const eventPromise = new Promise<void>(resolve=>{eventDone=resolve;});
  let closedDuringAction = false;
  const closed = () => { closedDuringAction = true; eventDone(); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const events: Array<{type:string}> = [];
  let eventsTruncated = false;
  const record = (type:string) => { if (events.length < 8) events.push({type}); else eventsTruncated = true; if(type===after) eventDone(); };
  const navigation = (frame: import('playwright').Frame) => record(frame === page.mainFrame() ? 'navigation' : 'frame-navigation');
  const popup = () => record('popup');
  const download = () => record('download');
  // Upstream owns and retains dialogs already; observing them does not accept them.
  const dialog = () => record('dialog');
  const beforeExecute = () => {
    page = state.page as unknown as UpstreamPage; signals = state.signals;
    beforeUrl = page.url(); networkStart = signals.network.length; sinceCursor = `${signals.captureEpoch}:${networkStart}`;
    page.on('framenavigated',navigation); page.on('popup',popup); page.on('download',download);
    page.on('close',closed);
    if (state.upstream) page.on('dialog',dialog);
  };
  const afterExecute = async () => {
    if (after) await Promise.race([eventPromise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`E_AFTER_TIMEOUT: ${after} was not observed; click is not replayed`)),Math.max(0,deadline-Date.now()));})]);
    if (closedDuringAction) throw new Error('E_PAGE_CLOSED: page closed during click observation; action is not replayed');
  };
  const capture = (failed = false): NonNullable<AgentBrowserActionResult['observation']> => ({
    changed: !failed && beforeUrl !== page.url() ? true : 'unknown', beforeUrl, afterUrl: page.url(), sinceCursor,
    networkObserved: Math.max(0,signals.network.length-networkStart), scope:'session-window', businessOutcome:'unknown', events, eventsTruncated,
  });
  const failure = (error: unknown) => sinceCursor ? Object.assign(error instanceof Error ? error : new Error(String(error)), {observation:capture(true)}) : error;
  const dispose = () => {clearTimeout(timer);page.off('framenavigated',navigation);page.off('popup',popup);page.off('download',download);page.off('close',closed);if(state.upstream)page.off('dialog',dialog);};
  return { beforeExecute, afterExecute, capture, failure, dispose };
}

export type PlaywrightHostApiOptions = {
  /** Select the complete Playwright runtime for the Kitesurf CDP adapter. */
  kitesurf?: boolean;
  /** Session identity reserved by the standalone Kitesurf control worker. */
  kitesurfSessionId?: string;
  semanticGateway?: SemanticGateway;
  /** Host-owned exact origins; supported only by the upstream driver. */
  allowedOrigins?: readonly string[];
  /** Host-authorized source files, resolved within this workspace. */
  allowedUploadPaths?: readonly string[];
  /** Host-authorized destinations, never overwritten. */
  allowedDownloadPaths?: readonly string[];
  /**
   * Single-request budget for the controlled upstream transport. Defaults to 10000 ms; raise it
   * only for a host that knowingly reads large/slow documents. Never settable from tool arguments.
   */
  transferTimeoutMs?: number;
  /** Experimental: borrow upstream snapshot/click in this dedicated MCP worker. */
  upstream?: boolean;
  workspaceRoot?: string;
  executablePath?: string;
  /** Prefer headless unless mode=visible. Default true. */
  defaultHeadless?: boolean;
  /**
   * TF-0097: launch Chromium **detached**, record its CDP endpoint under
   * `<workspace>/.ae/sessions/<id>/`, and re-attach on demand so a session
   * survives the process that opened it. Off by default (in-process sessions).
   */
  persistent?: boolean;
};

function notImplemented(method: string): never {
  const error = new Error(
    `${method} is not available on the standalone playwright driver (Drive is thin; use core open/nav/act/observe).`,
  ) as Error & { code?: string };
  error.code = 'E_NOT_IMPLEMENTED';
  throw error;
}

function normalizeMode(mode: AgentBrowserSessionMode | undefined): AgentBrowserSessionMode {
  return mode === 'visible' ? 'visible' : 'headless';
}

/**
 * TF-0113: the keys `pressKey` will send. An explicit allow-list keeps this a
 * bounded input primitive — the caller names a key, it cannot inject an
 * arbitrary keyboard sequence or a modifier combo nobody reviewed.
 */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** Modifier combos stay limited to the reviewed set above plus Ctrl/Meta+A. */
const ALLOWED_COMBOS: ReadonlySet<string> = new Set([
  'Shift+Tab',
  'Control+A',
  'Meta+A',
]);

export class KeyNotAllowedError extends Error {
  readonly code = 'E_KEY_NOT_ALLOWED';
  constructor(key: string) {
    super(
      `key "${key}" is not in the allowed set (${[...ALLOWED_KEYS].join(', ')}, ${[...ALLOWED_COMBOS].join(', ')})`,
    );
    this.name = 'KeyNotAllowedError';
  }
}

/** Validate/normalise a caller-supplied key or modifier combo. */
export function normalizeKeyName(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new KeyNotAllowedError('');
  // Normalise a few spellings, then match case-insensitively against the allow-lists.
  const aliased = trimmed
    .replace(/^Esc$/iu, 'Escape')
    .replace(/^Spacebar$/iu, 'Space')
    .replace(/\bCtrl\b/giu, 'Control');
  const canonical =
    [...ALLOWED_KEYS].find((k) => k.toLowerCase() === aliased.toLowerCase()) ??
    [...ALLOWED_COMBOS].find((k) => k.toLowerCase() === aliased.toLowerCase());
  if (!canonical) throw new KeyNotAllowedError(trimmed);
  return canonical;
}

function baseSession(
  id: string,
  mode: AgentBrowserSessionMode,
  url?: string,
): AgentBrowserSession {
  const now = new Date().toISOString();
  return {
    id,
    profile: 'standalone',
    mode,
    connection: { mode: 'managed' },
    createdAt: now,
    updatedAt: now,
    runtimeMode: 'normal_restricted',
    ...(url ? { url } : {}),
  };
}

/**
 * Create a standalone AgentBrowserHostApi backed by playwright-core chromium.
 * Requires `playwright-core` and a Chromium binary (bundled or executablePath).
 */
export async function createPlaywrightHostApi(
  options: PlaywrightHostApiOptions = {},
): Promise<AgentBrowserHostApi> {
  assertBrowserRuntime();
  const workspaceRoot = getWorkspaceRoot(options.workspaceRoot);
  if (options.semanticGateway !== undefined && !options.upstream) throw new Error('E_SEMANTIC_CONFIG: semantic gateway requires the upstream backend');
  const semanticGateway = options.semanticGateway ? { ...options.semanticGateway } : undefined;
  if (options.allowedUploadPaths !== undefined && (!options.upstream || !Array.isArray(options.allowedUploadPaths))) throw new Error('E_UPSTREAM_CONFIG: upload grants require an upstream host and a path array');
  const allowedUploadPaths=options.allowedUploadPaths===undefined?undefined:[...options.allowedUploadPaths];
  if (options.allowedDownloadPaths !== undefined && (!options.upstream || !Array.isArray(options.allowedDownloadPaths))) throw new Error('E_UPSTREAM_CONFIG: download grants require an upstream host and a path array');
  const allowedDownloadPaths=options.allowedDownloadPaths===undefined?undefined:[...options.allowedDownloadPaths];
  const downloadsDirectory=(id:string)=>assertInsideRoot(workspaceRoot,join(sessionDir(id,workspaceRoot),'downloads'),'download staging');
  if (options.allowedOrigins !== undefined && !options.upstream) throw new Error('E_UPSTREAM_CONFIG: origin grants require upstream backend');
  const allowedOrigins = options.allowedOrigins === undefined ? undefined : [...(await import('./upstream-control.ts')).authorizedBrowserOrigins(options.allowedOrigins)];
  if (options.upstream && options.persistent) throw new Error('E_UPSTREAM_CONFIG: persistent sessions are not enabled for this slice');
  if (options.transferTimeoutMs !== undefined && !options.upstream) throw new Error('E_UPSTREAM_CONFIG: transferTimeoutMs applies to the upstream transport only');
  const transferTimeoutMs = assertTransferTimeoutMs(options.transferTimeoutMs);
  const playwright = options.upstream || options.kitesurf ? await import('playwright') : await import('playwright-core');
  const chromium = playwright.chromium as unknown as PlaywrightChromium;
  const sessions = new Map<string, SessionState>();
  const sessionAttachments = new Map<string, Promise<SessionState>>();
  const sessionClosures = new Map<string, Promise<HostSuccess>>();
  /**
   * 本实例最近关闭的 1024 个会话 id，按首次关闭顺序淘汰。
   *
   * 2026-10-03：`close` 过去对任何找不到的 id 都回 `{ success: true }`，于是「id 写错」与「真的关掉了一个会话」
   * 在返回上完全一样——CLI `vb close --session <typo>` 会报成功而浏览器仍在跑（本轮实测清理过 85 个泄漏浏览器）。
   * 现在：从未见过的 id → `E_NO_SESSION`；本进程关过的 id（或记录存在但浏览器已死）→ 维持幂等成功。
   * ponytail: 幂等窗口有界；被淘汰的 id 按未知会话处理，不保留永久历史。
   */
  const closedSessions = new Set<string>();
  function rememberClosedSession(sessionId: string): void {
    closedSessions.add(sessionId);
    if (closedSessions.size > 1024) {
      closedSessions.delete(closedSessions.values().next().value!);
    }
  }
  const sharedBrowsers = new Map<boolean | string, Promise<PlaywrightBrowser>>();
  const browserClosures = new Map<PlaywrightBrowser, Promise<void>>();
  let openingSessions = 0;

  async function ensureBrowser(headless: boolean, key: boolean | string = headless, semantic?: Awaited<ReturnType<typeof prepareSemanticBrowser>> ): Promise<PlaywrightBrowser> {
    const existing = sharedBrowsers.get(key);
    if (existing) {
      const browser = await existing;
      const closing = browserClosures.get(browser);
      if (closing) {
        await closing.catch(() => undefined);
        return ensureBrowser(headless, key, semantic);
      }
      if (browser.isConnected()) return browser;
      if (sharedBrowsers.get(key) === existing) sharedBrowsers.delete(key);
      return ensureBrowser(headless, key, semantic);
    }
    const pending = chromium.launch({
      headless,
      ...((options.executablePath || semantic) ? { executablePath: options.executablePath ?? chromium.executablePath() } : {}),
      ...(options.upstream ? { chromiumSandbox: true } : {}),
      ...(options.upstream && allowedDownloadPaths?.length ? {downloadsPath:downloadsDirectory(String(key))}:{}),
      ...(semantic ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
      // Browser traffic is fulfilled by the bounded, origin-checked Node transport.
      // Port zero cannot host a proxy; do not allow Chromium a direct-network fallback.
      args: options.upstream ? ['--disable-dev-shm-usage', '--proxy-server=http://127.0.0.1:0', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic', ...(semantic?.args ?? [])] : ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    sharedBrowsers.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (sharedBrowsers.get(key) === pending) sharedBrowsers.delete(key);
      throw error;
    }
  }

  function discardDisconnectedSessions(): void {
    for (const [id, state] of sessions) {
      // Dedicated upstream controls still own logs/transports after native disconnect.
      // Observation must not destroy the state needed by the existing close/retry path.
      if (!options.upstream && !state.kitesurf && !state.browser.isConnected()) sessions.delete(id);
    }
  }

  async function closeUnusedSharedBrowser(onlyKey?: string): Promise<void> {
    if (openingSessions > 0 && onlyKey === undefined) return;
    discardDisconnectedSessions();
    for (const [headless, pending] of sharedBrowsers) {
      if (onlyKey !== undefined && headless !== onlyKey) continue;
      const browser = await pending;
      if (openingSessions > 0 && onlyKey === undefined) return;
      if (sharedBrowsers.get(headless) !== pending || [...sessions.values()].some(state => state.browser === browser)) continue;
      let closing = browserClosures.get(browser);
      if (!closing) {
        closing = browser.close();
        browserClosures.set(browser, closing);
      }
      try {
        await closing;
        if (sharedBrowsers.get(headless) === pending) sharedBrowsers.delete(headless);
      } catch (error) {
        if (typeof headless === 'string') throw Object.assign(new Error(`browser cleanup unconfirmed: ${error instanceof Error ? error.message : String(error)}`), { recoverySessionId: headless });
        throw error;
      } finally {
        if (browserClosures.get(browser) === closing) browserClosures.delete(browser);
      }
    }
  }

  function unknownSession(sessionId: string): never {
    const err = new Error(
      options.persistent
        ? `unknown session: ${sessionId || '(empty)'} — no persistent session record found; run \`vb open\` (or \`vb sessions\` to list)`
        : `unknown session: ${sessionId || '(empty)'}`,
    ) as Error & { code?: string };
    err.code = 'E_NO_SESSION';
    throw err;
  }

  function consoleLineText(line: ConsoleLine): string {
    return typeof line.text === 'string'
      ? line.text
      : line.message !== undefined
        ? String(line.message)
        : JSON.stringify(line);
  }

  /**
   * TF-0108: keep the session's page identity in step with the real page.
   *
   * `navigate` and `open` used to be the only writers of `session.url`/`title`,
   * so a click that caused a navigation left the session reporting the old page —
   * an agent reading `data.session.url` could judge the wrong document. Refresh
   * after any action that can move the page; the title probe is skipped when the
   * URL is unchanged so a normal click does not pay for it.
   */
  async function refreshLocation(state: SessionState): Promise<void> {
    const url = state.page.url();
    state.session.updatedAt = new Date().toISOString();
    if (url === state.session.url) return;
    state.session.url = url;
    state.session.title = await state.page.title();
  }

  function activatePage(state:SessionState,selected:UpstreamPage,info:{title:string;titleUnavailable?:boolean}):void {
    const page=selected as unknown as PlaywrightPage;
    const signals=state.pageSignals?.get(page);
    if(!signals)throw new Error('E_PAGE_ID: page observation ownership unavailable');
    state.page=page;state.signals=signals;
    state.session.url=page.url();
    if(info.titleUnavailable)delete state.session.title;else state.session.title=info.title;
    state.session.updatedAt=new Date().toISOString();
  }

  /**
   * Persist the *current page* window (TF-0095 semantics) so a later process can
   * judge the page it did not itself drive. Never fatal: a failed write only
   * costs a later process its preloaded window.
   */
  async function persistWindow(state: SessionState): Promise<void> {
    if (!state.persistent || state.signals.observationWindowMissing) return;
    await saveWindow(state.session.id, {
      schemaVersion: 1,
      at: new Date().toISOString(),
      url: state.page.url(),
      requests: state.signals.network.slice(state.signals.windowStart.network),
      consoleLines: state.signals.consoleLines
        .slice(state.signals.windowStart.console)
        .map((line) => ({
          ...(line.type ? { type: line.type } : {}),
          text: consoleLineText(line),
        })),
    }, workspaceRoot).catch(() => undefined);
  }

  async function changeField(state: SessionState, selector: string, timeoutMs: number | undefined, action: (target: ReturnType<UpstreamPage['locator']>, remaining: () => number) => Promise<unknown>) {
    const timeout = timeoutMs ?? 5000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60000) throw new Error('E_ARG: timeoutMs must be within (0, 60000]');
    const deadline = Date.now() + timeout;
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error('E_ACTION_TIMEOUT: field action deadline expired');
      return ms;
    };
    const target = state.page.locator(selector);
    return observeFieldAction(target, remaining(), () => action(target, remaining));
  }

  /**
   * In-memory session, or — in persistent mode — re-attach to the detached
   * browser recorded for that session id. This is what makes `vb nav --session`
   * work from a different process (TF-0097).
   */
  async function ensureState(sessionId: string, method = 'close'): Promise<SessionState> {
    const closing = sessionClosures.get(sessionId);
    if (closing) {
      await closing;
      return ensureState(sessionId, method);
    }
    discardDisconnectedSessions();
    const existing = sessions.get(sessionId);
    if (existing) {
      if (existing.kitesurf) assertKitesurfMethod(method);
      if (!existing.browser.isConnected()) return unknownSession(sessionId);
      return existing;
    }
    if (!options.persistent) return unknownSession(sessionId);

    if (options.persistent) {
      const record = await loadSessionRecord(sessionId, workspaceRoot);
      if (record?.engine === 'kitesurf') assertKitesurfMethod(method);
    }
    const attaching = sessionAttachments.get(sessionId);
    if (attaching) return attaching;
    const pending = restoreState(sessionId);
    sessionAttachments.set(sessionId, pending);
    try {
      const state = await pending;
      if (state.kitesurf) assertKitesurfMethod(method);
      return state;
    } finally {
      sessionAttachments.delete(sessionId);
    }
  }

  async function nativePageTargetId(page: PlaywrightPage): Promise<string> {
    const native = page as unknown as UpstreamPage;
    const cdp = await native.context().newCDPSession(native);
    try {
      const id = (await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
      if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new Error('E_PAGE_ID: native page identity unavailable');
      return id;
    } finally { await cdp.detach(); }
  }

  async function restoreState(sessionId: string): Promise<SessionState> {
    const record = await loadSessionRecord(sessionId, workspaceRoot);
    if (!record) return unknownSession(sessionId);
    if (record.engine === 'kitesurf') {
      assertKitesurfLoopback(record.endpoint);
      if (!isKitesurfVersion(await readCdpVersion(record.endpoint))) {
        throw new Error('E_KITESURF_ENDPOINT: persistent endpoint no longer identifies Kitesurf');
      }
      throw new Error('E_KITESURF_CONTROL: Kitesurf targets belong to their original WebSocket; use the live CLI control session');
    }
    const remote = await chromium.connectOverCDP(record.endpoint);
    try {
      const pages = remote.contexts().flatMap(context => context.pages());
      let page: PlaywrightPage | undefined;
      if (record.targetId !== undefined) {
        for (const candidate of pages) {
          if (candidate.isClosed?.()) continue;
          try { if (await nativePageTargetId(candidate) === record.targetId) { page = candidate; break; } }
          catch (error) { if (!candidate.isClosed?.()) throw error; }
        }
        if (!page) throw new Error('E_PAGE_CLOSED: recorded persistent page is unavailable; no replacement page selected');
      } else {
        if (!pages.length) throw new Error('E_PAGE_CLOSED: legacy persistent record has no live page; no page created');
        if (pages.length !== 1) throw new Error('E_PAGE_ID: legacy persistent record has multiple pages without target identity; reopen instead of guessing');
        page = pages[0]!;
      }
      const savedWindow = await loadWindow(sessionId, workspaceRoot);
      const windowMismatch = savedWindow?.url !== undefined && savedWindow.url !== page.url();
      const window = windowMismatch ? null : savedWindow;
      const restored = window?.requests ?? [];
      const maxSeq = restored.reduce((max, row) => {
        const parsed = Number(String(row.id).replace(/\D/gu, ''));
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0);
      const state: SessionState = {
        session: {
          ...baseSession(sessionId, record.mode),
          connection: { mode: 'cdp' },
          createdAt: record.createdAt,
          url: page.url(),
          title: await page.title(),
        },
        browser: remote,
        page,
        // Preload the last persisted page window; listeners append from here on.
        signals: {
        consoleLines: (window?.consoleLines ?? []).map((line) => ({ type: line.type, text: line.text })),
        network: [...restored],
        captureEpoch: randomUUID(),
        networkCaptures: new Map(),
        netSeq: maxSeq,
        windowStart: { network: 0, console: 0 },
        observationWindowMissing: windowMismatch,
        },
        persistent: { pid: record.pid, profileDir: record.profileDir, endpoint: record.endpoint, external: record.external },
        ...(record.engine === 'kitesurf' ? { kitesurf: true } : {}),
      };
      attachPageListeners(state.page,state.signals);
      sessions.set(sessionId, state);
      return state;
    } catch (error) {
      // A failed reattachment owns only this CDP client, not the recorded browser.
      await remote.close().catch(() => undefined);
      throw error;
    }
  }

  function attachPageListeners(page: PlaywrightPage, signals: PageSignals): void {
    page.on('close',()=>{signals.observationWindowMissing=true;});
    page.on('console', ((msg: unknown) => {
      const m = msg as {
        type?: string | (() => string);
        text?: string | (() => string);
      };
      const type = typeof m.type === 'function' ? m.type() : (m.type ?? 'log');
      const text = typeof m.text === 'function' ? m.text() : (m.text ?? String(msg));
      signals.consoleLines.push({ type, text });
    }) as never);
    page.on('pageerror', ((err: { message?: string; stack?: string }) => {
      const text = err?.stack || err?.message || String(err);
      signals.consoleLines.push({ type: 'error', text });
    }) as never);
    page.on('response', ((response: {
      url: () => string;
      status: () => number;
      headers: () => Record<string, string>;
      body: () => Promise<Buffer>;
      finished: () => Promise<Error | null>;
      request: () => { method: () => string; headers: () => Record<string, string>; isNavigationRequest?: () => boolean; frame?: () => unknown };
    }) => {
      const request = response.request();
      if (request.isNavigationRequest?.() && page.mainFrame && request.frame?.() === page.mainFrame()) {
        // A document response precedes its scripts. Keep this response (including
        // a 404), while excluding signals from the document it replaced.
        signals.windowStart = { network: signals.network.length, console: signals.consoleLines.length };
        signals.observationWindowMissing = false;
        signals.partialReason = signals.pendingNavigationId ? 'Navigation is waiting for dialog completion' : undefined;
      }
      signals.netSeq += 1;
      const id = `${options.upstream ? signals.captureEpoch + ':' : ''}n-${signals.netSeq}`;
      const status = response.status();
      signals.network.push({
        id,
        url: response.url(),
        method: response.request().method(),
        status,
        failed: status >= 400,
        ...(status >= 400 ? { error: `HTTP ${status}` } : {}),
      });
      // TF-0103: keep headers always, and read the body eagerly only when it is
      // textual and bounded (a lazy read after navigation can be gone).
      const responseHeaders = response.headers();
      const contentType = responseHeaders['content-type'];
      const declaredLength = Number(responseHeaders['content-length'] ?? Number.NaN);
      const bounded = !Number.isFinite(declaredLength) || declaredLength <= CAPTURE_BODY_MAX_BYTES;
      const textual = contentType !== undefined && CAPTURE_BODY_TEXTUAL.test(contentType);
      const capture: NetworkCapture = {
        requestHeaders: headerList(response.request().headers()),
        responseHeaders: headerList(responseHeaders),
        ...(contentType ? { mimeType: contentType.split(';')[0]?.trim() ?? contentType } : {}),
      };
      if (textual && bounded && (!options.upstream || (!signals.fileDownloadPending && !/\battachment\b/i.test(responseHeaders['content-disposition']??'')))) {
        const pending = response.body().then(buffer => buffer.length <= CAPTURE_BODY_MAX_BYTES ? buffer : null).catch(() => null);
        capture.body = async () => await pending;
      }
      signals.networkCaptures.set(id, capture);
      capture.completion = 'pending';
      void response.finished().then(error => { capture.completion = error ? 'failed' : 'complete'; }, () => { capture.completion = 'failed'; });
    }) as never);
    page.on('requestfailed', ((request: { url: () => string; method: () => string; failure: () => { errorText?: string } | null }) => {
      signals.netSeq += 1;
      signals.network.push({
        id: `${options.upstream ? signals.captureEpoch + ':' : ''}n-${signals.netSeq}`,
        url: request.url(),
        method: request.method(),
        failed: true,
        error: request.failure()?.errorText ?? 'requestfailed',
      });
    }) as never);
  }

  async function closeSession(sessionId: string): Promise<HostSuccess> {
    // Even a failed attachment must finish releasing its client before removal.
    await sessionAttachments.get(sessionId)?.catch(() => undefined);
    const state = sessions.get(sessionId);
    // Upstream browsers are keyed by their session id before a page exists.
    // Keep failed startup ownership addressable without inventing a fake Page.
    const starting = !state && options.upstream ? sharedBrowsers.get(sessionId) : undefined;
    if (starting) {
      const browser = await starting;
      await browser.close();
      sharedBrowsers.delete(sessionId);
      rememberClosedSession(sessionId);
      return { success: true };
    }
    if (!state && options.persistent) {
      const record = await loadSessionRecord(sessionId, workspaceRoot);
      if (!record) {
        if (closedSessions.has(sessionId)) return { success: true };
        return unknownSession(sessionId);
      }
      // Closing needs the ownership record, not a successful Playwright reattach.
      if (!record.external && !(await closeBrowserThroughCdp(record.endpoint))) {
        throw new Error('browser shutdown was not confirmed; persistent session retained for retry');
      }
      await removeSession(sessionId, workspaceRoot);
      rememberClosedSession(sessionId);
      return { success: true };
    }
    if (state?.persistent) {
      if (!state.persistent.external) {
        // Playwright's browser.close() on a CDP connection only disconnects;
        // ask the browser itself to exit, then clean up its profile.
        if (!(await closeBrowserThroughCdp(state.persistent.endpoint))) {
          throw new Error('browser shutdown was not confirmed; persistent session retained for retry');
        }
      }
      await state.browser.close();
      await removeSession(sessionId, workspaceRoot);
      sessions.delete(sessionId);
      rememberClosedSession(sessionId);
      return { success: true };
    }
    if (!state) {
      if (closedSessions.has(sessionId)) return { success: true };
      return unknownSession(sessionId);
    }
    state.upstream?.abortPending();
    await state.semantic?.close();
    try { await state.page.close(); }
    catch (error) { if (state.browser.isConnected()) throw error; }
    await state.upstream?.close();
    sessions.delete(sessionId);
    try { await closeUnusedSharedBrowser(); }
    catch (error) { sessions.set(sessionId, state); throw error; }
    rememberClosedSession(sessionId);
    return { success: true };
  }

  const upstreamReads = {
    readForms: async (payload: AgentBrowserSessionPayload & { selector?: string }) => {
      const state = await ensureState(payload.sessionId, 'readForms');
      if (!state.upstream) return notImplemented('readForms');
      return { success: true, ...await state.upstream.forms(payload.selector) };
    },
    findElement: async (payload: AgentBrowserFindPayload): Promise<AgentBrowserFindResult> => {
      const state = await ensureState(payload.sessionId, 'findElement');
      if (!state.upstream) throw new Error('E_NOT_IMPLEMENTED: exact reference queries require the upstream backend');
      const result = await state.upstream.findElement(payload);
      await refreshLocation(state);
      return { success: true, session: state.session, ...result, scope: { ...result.scope, sessionId: payload.sessionId } };
    },
  };
  const api = {
    open: async (payload: AgentBrowserOpenPayload = {}, request?: { signal?: AbortSignal }): Promise<AgentBrowserSessionResult> => {
      const signal = options.upstream ? request?.signal : undefined;
      signal?.throwIfAborted();
      for (const dimension of ['width', 'height'] as const) {
        const value = payload[dimension];
        if (value !== undefined && (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 4096)) {
          throw new Error(`E_ARG: viewport ${dimension} must be an integer from 1 to 4096`);
        }
      }
      if ((payload.width !== undefined || payload.height !== undefined) &&
          (options.persistent || payload.connectionMode === 'cdp' || payload.cdpEndpoint !== undefined)) {
        throw new Error('E_ARG: explicit viewport is only supported for new managed, non-persistent sessions');
      }
      const mode = normalizeMode(payload.mode);
      const headless = options.defaultHeadless === false ? false : mode === 'headless';
      const externalEndpoint =
        payload.connectionMode === 'cdp' && payload.cdpEndpoint ? payload.cdpEndpoint : undefined;
      if (payload.browser !== undefined && payload.browser !== 'kitesurf') {
        throw new Error('E_ARG: browser must be "kitesurf"');
      }
      if (payload.browser === 'kitesurf' && !externalEndpoint) {
        throw new Error('E_KITESURF_ENDPOINT: kitesurf requires `vb open --kitesurf --cdp <loopback>`; Chromium will not be launched');
      }
      if (payload.browser === 'kitesurf') assertKitesurfLoopback(externalEndpoint!);
      let kitesurf = false;
      const id = payload.browser === 'kitesurf' && !options.persistent ? options.kitesurfSessionId ?? randomUUID() : randomUUID();
      if (options.upstream && (!payload.url || mode !== 'headless' || payload.cdpEndpoint || payload.profile)) throw new Error('E_UPSTREAM_CONFIG: this slice requires a URL and a new headless session without external profile/CDP');
      // An explicit attach only exists on the persistent (detached CDP) path. In-process this driver
      // has none, so before this guard an endpoint was silently dropped and a managed browser was
      // launched instead - the caller got a browser it never asked for and no signal. Same
      // "rejected rather than silently ignored" rule as the viewport check above.
      const explicitAttach =
        payload.cdpEndpoint !== undefined
        || payload.connectionMode === 'cdp'
        || payload.connectionMode === 'auto-connect'
        || payload.connectionMode === 'external-profile';
      if (explicitAttach && !options.persistent && payload.browser !== 'kitesurf') {
        throw new Error(
          'E_ARG: explicit CDP/external attach needs persistent sessions; this in-process driver opens managed sessions only. Use `vb open --cdp`, or createStandaloneFacade({persistentSessions:true}) / createPlaywrightHostApi({persistent:true}).',
        );
      }
      // Named profiles (and their per-profile login state) are a host-engine capability; this driver
      // runs exactly one `standalone` profile and cannot isolate or persist another. It used to
      // accept the name and ignore it, so a caller asking for profile `work` silently shared the
      // default browser state. Reject like the attach/viewport cases above; the upstream backend
      // already rejects `profile` too. `docs/integration/harness-toolbox.md`: login reuse is a
      // host-enabled capability, not a property of every browsing task.
      if (typeof payload.profile === 'string' && payload.profile.trim()) {
        throw new Error(
          'E_ARG: named profiles are a host-engine capability; this standalone driver runs a single `standalone` profile. Omit `profile`, or use the host engine (OpenClaw `browser.open`) for profile isolation.',
        );
      }
      const target = payload.url ? assertAgentBrowserNavigateUrl(payload.url, { allowLocalDocuments: !options.upstream }) : undefined;

      let browser: PlaywrightBrowser | undefined;
      let semanticConfig: Awaited<ReturnType<typeof prepareSemanticBrowser>> | undefined;
      let abortClose: Promise<void> | undefined;
      // Only upstream owns a dedicated browser per open; never close a shared legacy browser.
      // Failed close is retried by the existing startup cleanup/recovery path below.
      const abort = () => {
        // Stop guarded HTTP immediately; native browser shutdown may finish later.
        sessions.get(id)?.upstream?.abortPending();
        abortClose ??= browser!.close().catch(() => undefined);
      };
      let page: PlaywrightPage;
      let persistent: SessionState['persistent'];
      let launched: DetachedBrowserProcess | undefined;
      let ownedEndpoint: string | undefined;
      const session = baseSession(id, mode, payload.url);

      openingSessions += 1;
      try {
        if (options.persistent || payload.browser === 'kitesurf') {
          // Detached Chromium + CDP so the session outlives this process (TF-0097).
          // An explicitly supplied endpoint is attached to instead of launched, and
          // is never killed on close (we do not own that browser).
          const dir = sessionDir(id, workspaceRoot);
          const profileDir = join(dir, 'profile');
          let endpoint: string;
          let pid: number;
          if (externalEndpoint) {
            endpoint = externalEndpoint;
            pid = 0;
          } else {
            await mkdir(profileDir, { recursive: true });
            const port = await allocatePort();
            endpoint = cdpEndpoint(port);
            ownedEndpoint = endpoint;
            launched = await launchDetachedBrowser({
              executablePath: options.executablePath ?? chromium.executablePath(),
              profileDir,
              port,
              headless,
            });
            pid = launched.pid;
            await waitForCdpEndpoint(endpoint, 20_000, launched);
          }
          if (externalEndpoint) {
            try {
              const identified = isKitesurfVersion(await readCdpVersion(endpoint));
              if (payload.browser === 'kitesurf' && !identified) {
                throw new Error('E_KITESURF_ENDPOINT: /json/version did not identify Kitesurf');
              }
              kitesurf = identified;
            } catch (error) {
              if (payload.browser === 'kitesurf') throw error;
            }
          }
          browser = kitesurf
            ? await connectKitesurfOverCDP(chromium as unknown as { connectOverCDP: (transport: unknown) => Promise<PlaywrightBrowser> }, endpoint)
            : await chromium.connectOverCDP(endpoint);
          const existingContext = browser.contexts()[0];
          if (kitesurf && !existingContext) throw new Error('E_KITESURF_ENDPOINT: Kitesurf supplied no context; no replacement context was created');
          const context = existingContext ?? (await browser.newContext());
          page = context.pages()[0]!;
          if (!page) {
            if (kitesurf) throw new Error('E_KITESURF_ENDPOINT: Kitesurf supplied no page; no page or context was created');
            page = await context.newPage();
          }
          persistent = { pid, profileDir, endpoint, external: Boolean(externalEndpoint) };
        } else {
          semanticConfig = semanticGateway ? await (await import('./semantic-browser.ts')).prepareSemanticBrowser(semanticGateway) : undefined;
          signal?.throwIfAborted();
          browser = await ensureBrowser(headless, options.upstream ? id : headless, semanticConfig);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) { abort(); signal.throwIfAborted(); }
          const contextOptions = {
            ...(options.upstream ? { serviceWorkers: 'block' as const, acceptDownloads: Boolean(allowedDownloadPaths?.length) } : {}),
            viewport: {
              width: payload.width ?? 1280,
              height: payload.height ?? 720,
            },
          };
          page = options.upstream ? await (await browser.newContext(contextOptions)).newPage() : await browser.newPage(contextOptions);
        }
        if (persistent) session.connection = { mode: 'cdp' };
        const state: SessionState = {
          session,
          browser,
          page,
          signals: {
          consoleLines: [],
          network: [],
          captureEpoch: randomUUID(),
          networkCaptures: new Map(),
          netSeq: 0,
          windowStart: { network: 0, console: 0 },
          },
          ...(persistent ? { persistent } : {}),
          ...(kitesurf ? { kitesurf: true } : {}),
        };
        attachPageListeners(state.page,state.signals);
        sessions.set(id, state);
        if (options.upstream || state.kitesurf) {
          state.pageSignals=new Map([[page,state.signals]]);
          const observedPages = new WeakSet<PlaywrightPage>([page]);
          const signalsForChild = (childPage: PlaywrightPage) => {
            const existing = state.pageSignals!.get(childPage);
            if (existing) return existing;
            const signals:PageSignals={consoleLines:[],network:[],captureEpoch:randomUUID(),networkCaptures:new Map(),netSeq:0,windowStart:{network:0,console:0},partialReason:'Page attached after its initial document response; earlier observations are unavailable'};
            state.pageSignals!.set(childPage,signals);
            (childPage as unknown as UpstreamPage).once('close',()=>state.pageSignals!.delete(childPage));
            return signals;
          };
          const ownerContext = (page as unknown as UpstreamPage).context();
          ownerContext.on('console',message=>{
            const owner = message.page() as unknown as PlaywrightPage | null;
            if (!owner || observedPages.has(owner)) return;
            const signals = signalsForChild(owner);
            signals.consoleLines.push({type:message.type(),text:message.text()});
          });
          ownerContext.on('page',child=>{
            const childPage=child as unknown as PlaywrightPage;
            attachPageListeners(childPage,signalsForChild(childPage));
            observedPages.add(childPage);
          });
          const { createUpstreamPageControl } = await import('./upstream-control.ts');
          state.upstream = await createUpstreamPageControl(page as unknown as UpstreamPage, target ?? state.page.url(), workspaceRoot, () => api.close({ sessionId: id }), allowedOrigins,(owner,navigation)=>{
            const signals=state.pageSignals?.get(owner as unknown as PlaywrightPage);
            if(!signals)return;
            if(navigation.pending){signals.pendingNavigationId=navigation.id;signals.partialReason='Navigation is waiting for dialog completion';}
            else if(signals.pendingNavigationId===navigation.id){
              delete signals.pendingNavigationId;
              if(signals.partialReason==='Navigation is waiting for dialog completion')signals.partialReason=navigation.failed?'Navigation did not complete after the dialog response; inspect the current page':undefined;
            }
            if(state.page===(owner as unknown as PlaywrightPage)){state.session.url=owner.url();delete state.session.title;state.session.updatedAt=new Date().toISOString();}
          },allowedUploadPaths,allowedDownloadPaths?.length?{allowedPaths:allowedDownloadPaths,directory:downloadsDirectory(id)}:undefined,transferTimeoutMs,Boolean(state.kitesurf));
        }
        if (semanticConfig) state.semantic = await (await import('./semantic-browser.ts')).attachSemanticBrowser(browser as unknown as import('playwright').Browser, semanticConfig);
        if (kitesurf) Object.assign(api, upstreamReads);
        signal?.throwIfAborted();
        let pendingDialog:AgentBrowserSessionResult['pendingDialog'];
        if (target) {
          const openWaitUntil = payload.waitUntil === 'dom-ready' ? 'domcontentloaded' : 'load';
        if(state.upstream)pendingDialog=(await state.upstream.navigate(target,openWaitUntil)).pendingDialog;
          else await page.goto(target, { waitUntil: openWaitUntil });
          session.url = page.url();
          if(!pendingDialog)session.title = await page.title();
          session.updatedAt = new Date().toISOString();
        }
        signal?.throwIfAborted();
        if (persistent) {
          await saveSessionRecord({
            schemaVersion: 1,
            id,
            targetId: await nativePageTargetId(page),
            pid: persistent.pid,
            endpoint: persistent.endpoint,
            port: Number(new URL(persistent.endpoint).port || 0),
            mode,
            createdAt: session.createdAt,
            profileDir: persistent.profileDir,
            ...(persistent.external ? { external: true } : {}),
            ...(kitesurf ? { engine: 'kitesurf' as const } : {}),
            ...(session.url ? { url: session.url } : {}),
            ...(session.title ? { title: session.title } : {}),
          }, workspaceRoot);
          await persistWindow(state);
        }
        return { success: true, session,...(pendingDialog?{pendingDialog}:{}) };
      } catch (error) {
        const recovery = persistent ?? (ownedEndpoint && launched ? {
          pid: launched.pid, endpoint: ownedEndpoint, profileDir: join(sessionDir(id, workspaceRoot), 'profile'),
        } : undefined);
        const retainForRetry = async (): Promise<never> => {
          let recordError = '';
          try {
            if (recovery) {
              await saveSessionRecord({
                schemaVersion: 1, id, pid: recovery.pid, endpoint: recovery.endpoint,
                port: Number(new URL(recovery.endpoint).port), mode, createdAt: session.createdAt,
                profileDir: recovery.profileDir, ...('external' in recovery && recovery.external ? { external: true } : {}),
                ...(kitesurf ? { engine: 'kitesurf' as const } : {}),
              }, workspaceRoot);
            }
          } catch { recordError = '; recovery record could not be saved'; }
          throw Object.assign(new Error(`${error instanceof Error ? error.message : String(error)}; startup cleanup unconfirmed; recovery session ${id}${recordError}`), { recoverySessionId: id });
        };
        // Failed navigation/recording must not leave a session the caller never received.
        if (sessions.has(id)) {
          try { await api.close({ sessionId: id }); }
          catch { await retainForRetry(); }
        } else if (options.persistent) {
          let shutdownConfirmed = true;
          if (ownedEndpoint && launched) {
            // `closeBrowserThroughCdp` reports an explicit "CDP shutdown was not
            // confirmed" as `false`. Discarding that and re-deriving confirmation from
            // the endpoint/pid made an unconfirmed cleanup look confirmed: a launcher
            // exits 0 on handoff (see `waitForCdpEndpoint`) and an unbound port reads as
            // "down", so the only addressable record of a possibly live browser was
            // deleted. A false result must retain the recovery record.
            const cdpClosed = await closeBrowserThroughCdp(ownedEndpoint).catch(() => false);
            const child = launched.child;
            if (child.exitCode === null && child.signalCode === null) {
              // Only the process handle acquired by this open may be terminated.
              const exited = once(child, 'exit', { signal: AbortSignal.timeout(2000) }).catch(() => undefined);
              child.kill();
              await exited;
            }
            shutdownConfirmed = cdpClosed && await waitForEndpointDown(ownedEndpoint, 2000) &&
              (child.exitCode !== null || child.signalCode !== null);
          }
          await browser?.close().catch(() => undefined); // CDP disconnect only, including external browsers.
          if (shutdownConfirmed) {
            await removeSession(id, workspaceRoot);
          } else if (ownedEndpoint && launched) {
            // Keep an addressable recovery record instead of losing a possibly live browser.
            await retainForRetry();
          }
        }
        throw error;
      } finally {
        signal?.removeEventListener('abort', abort);
        await abortClose;
        openingSessions -= 1;
        if (!kitesurf) await closeUnusedSharedBrowser(options.upstream ? id : undefined);
      }
    },

    navigate: async (payload: AgentBrowserNavigatePayload): Promise<AgentBrowserActionResult> => {
      const state = await ensureState(payload.sessionId, 'navigate');
      const target = assertAgentBrowserNavigateUrl(payload.url);
      // The persisted window is the *current page*: everything from this
      // navigation on, so a later process judges this page, not the last one.
      let pendingDialog:AgentBrowserActionResult['pendingDialog'];
      if (state.upstream) pendingDialog=(await state.upstream.navigate(target, payload.waitUntil === 'dom-ready' ? 'domcontentloaded' : 'load')).pendingDialog;
      else {state.signals.windowStart = { network: state.signals.network.length, console: state.signals.consoleLines.length };
        await state.page.goto(target, {
        waitUntil: payload.waitUntil === 'dom-ready' ? 'domcontentloaded' : 'load',
      });}
      if(!pendingDialog)state.signals.observationWindowMissing = false;
      state.session.url = state.page.url();
      if(!pendingDialog)state.session.title = await state.page.title();
      state.session.updatedAt = new Date().toISOString();
      await persistWindow(state);
      return { success: true, session: state.session,...(pendingDialog?{pendingDialog}:{}) };
    },

    waitForSelector: async (payload: AgentBrowserSelectorPayload): Promise<AgentBrowserActionResult> => {
      const state = await ensureState(payload.sessionId, 'waitForSelector');
      if (state.upstream) { await state.upstream.wait(payload.selector, payload.timeoutMs); return { success: true, session: state.session }; }
      await state.page.waitForSelector(payload.selector, {
        timeout: payload.timeoutMs ?? 5000,
      });
      return { success: true, session: state.session };
    },

    click: async (payload: AgentBrowserClickPayload): Promise<AgentBrowserActionResult> => {
      if (payload.after !== undefined && !['navigation','popup','download'].includes(payload.after)) throw new Error('E_ARG: unsupported after event');
      if (payload.timeoutMs !== undefined && (!Number.isFinite(payload.timeoutMs) || payload.timeoutMs <= 0 || payload.timeoutMs > 60000)) throw new Error('E_ARG: timeoutMs must be within (0,60000]');
      const state = await ensureState(payload.sessionId, 'click');
      const observer = observeNativeAction(state, payload.timeoutMs, payload.after);
      const {beforeExecute,afterExecute} = observer;
      const page = state.page as unknown as UpstreamPage;
      const deadline = Date.now() + (payload.timeoutMs ?? 5000);
      let fieldChange: AgentBrowserActionResult['fieldChange'];
      try {
        if (state.upstream) fieldChange = await state.upstream.click(payload.selector, payload.timeoutMs, beforeExecute, afterExecute);
        else {
          beforeExecute();
          const target = page.locator(payload.selector);
          if (await target.evaluate(element=>element.matches('input,select,textarea,[contenteditable="true"]'),undefined,{timeout:Math.max(1,deadline-Date.now())})) {
            fieldChange = await observeFieldAction(target,Math.max(1,deadline-Date.now()),()=>target.click({timeout:Math.max(1,deadline-Date.now())}));
          } else await state.page.click(payload.selector, { timeout: Math.max(1,deadline-Date.now()) });
          await afterExecute();
        }
      } catch (error) { throw observer.failure(error); }
      finally { observer.dispose(); }
      await refreshLocation(state);
      await persistWindow(state);
      return { success:true, session:state.session, ...(fieldChange ? {fieldChange}:{}), observation:observer.capture() };
    },

    downloadFile: async (payload:AgentBrowserDownloadPayload):Promise<AgentBrowserDownloadResult> => {
      const state=await ensureState(payload.sessionId, 'downloadFile'),signals=state.signals;
      if (!state.upstream) return notImplemented('downloadFile');
      const observer=observeNativeAction(state,payload.timeoutMs);
      try {
        const result=await state.upstream!.downloadFile(payload.selector,payload.path,payload.timeoutMs,()=>{signals.fileDownloadPending=true;observer.beforeExecute();});
        await refreshLocation(state);
        return {success:true,session:state.session,...result,observation:observer.capture()};
      } catch(error){throw observer.failure(error);}finally{signals.fileDownloadPending=false;observer.dispose();}
    },

    uploadFiles: async (payload:AgentBrowserUploadPayload):Promise<AgentBrowserUploadResult> => {
      const state=await ensureState(payload.sessionId, 'uploadFiles');
      if (!state.upstream) return notImplemented('uploadFiles');
      const observer=observeNativeAction(state,payload.timeoutMs);
      try {
        const result=await state.upstream!.uploadFiles(payload.selector,payload.paths,payload.timeoutMs,observer.beforeExecute);
        await refreshLocation(state);
        return {success:true,session:state.session,...result,observation:observer.capture()};
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
    },

    type: async (payload: AgentBrowserTypePayload): Promise<AgentBrowserActionResult> => {
      const state = await ensureState(payload.sessionId, 'type');
      const observer=observeNativeAction(state,payload.timeoutMs);
      let fieldChange:AgentBrowserActionResult['fieldChange'];
      try {
      fieldChange = state.upstream ? await state.upstream.type(payload.selector, payload.text, payload.timeoutMs,observer.beforeExecute)
        : await changeField(state, payload.selector, payload.timeoutMs, async (target, remaining) => {
          observer.beforeExecute();
          await target.focus({ timeout: remaining() });
          await target.evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          if (payload.clear) await target.fill('', { timeout: remaining() });
          await target.fill(payload.text, { timeout: remaining() });
        });
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
      await refreshLocation(state);
      await persistWindow(state);
      return { success: true, session: state.session, fieldChange, observation:observer.capture() };
    },

    pointer: async (payload: AgentBrowserPointerPayload): Promise<AgentBrowserActionResult> => {
      if (!['hover', 'double-click', 'right-click', 'scroll', 'scroll-into-view'].includes(payload.action)) throw new Error('E_ARG: unknown pointer action');
      if ((payload.selector !== undefined && (typeof payload.selector !== 'string' || !payload.selector.trim())) || (payload.action !== 'scroll' && !payload.selector)) throw new Error('E_ARG: pointer action requires a selector');
      if (payload.timeoutMs !== undefined && (!Number.isFinite(payload.timeoutMs) || payload.timeoutMs <= 0 || payload.timeoutMs > 60000)) throw new Error('E_ARG: timeoutMs must be within (0, 60000]');
      if ([payload.deltaX, payload.deltaY].some(delta => delta !== undefined && (!Number.isFinite(delta) || Math.abs(delta) > 10000)) || (payload.action !== 'scroll' && (payload.deltaX !== undefined || payload.deltaY !== undefined))) throw new Error('E_ARG: deltas are finite scroll-only values within +/-10000');
      if (payload.action === 'scroll' && !(payload.deltaX || payload.deltaY)) throw new Error('E_ARG: scroll requires a nonzero delta');
      const state = await ensureState(payload.sessionId, 'pointer');
      const observer = observeNativeAction(state,payload.timeoutMs);
      try {
      if (state.upstream) await state.upstream.pointer(payload,observer.beforeExecute);
      else {
        await state.page.bringToFront?.();
        observer.beforeExecute();
        const options = { timeout: payload.timeoutMs ?? 5000 };
        const target = payload.selector ? state.page.locator(payload.selector) : undefined;
        if (payload.action === 'hover') await target!.hover(options);
        else if (payload.action === 'double-click') await target!.dblclick(options);
        else if (payload.action === 'right-click') await target!.click({ ...options, button: 'right' });
        else if (payload.action === 'scroll-into-view') await target!.scrollIntoViewIfNeeded(options);
        else {
          if (target) await target.hover(options); else await state.page.mouse.move(0, 0);
          await state.page.mouse.wheel(payload.deltaX ?? 0, payload.deltaY ?? 0);
        }
      }
      } catch(error) { throw observer.failure(error); } finally { observer.dispose(); }
      await refreshLocation(state); await persistWindow(state);
      return { success: true, session: state.session, observation:observer.capture() };
    },

    drag: async (payload: AgentBrowserDragPayload): Promise<AgentBrowserActionResult> => {
      if ([payload.sourceSelector, payload.targetSelector].some(selector => typeof selector !== 'string' || !selector.trim())) throw new Error('E_ARG: drag requires sourceSelector and targetSelector');
      if (payload.timeoutMs !== undefined && (!Number.isFinite(payload.timeoutMs) || payload.timeoutMs <= 0 || payload.timeoutMs > 60000)) throw new Error('E_ARG: timeoutMs must be within (0, 60000]');
      const state = await ensureState(payload.sessionId, 'drag');
      const observer = observeNativeAction(state,payload.timeoutMs);
      try {
      if (state.upstream) await state.upstream.drag(payload.sourceSelector, payload.targetSelector, payload.timeoutMs,observer.beforeExecute);
      else {
        observer.beforeExecute();
        const deadline = Date.now() + (payload.timeoutMs ?? 5000);
        await dragWithNativeStart(state.page as unknown as UpstreamPage, state.page.locator(payload.sourceSelector), state.page.locator(payload.targetSelector), () => {
          const ms = deadline - Date.now();
          if (ms <= 0) throw new Error('E_ACTION_TIMEOUT: drag deadline expired');
          return ms;
        });
      }
      } catch(error) { throw observer.failure(error); } finally { observer.dispose(); }
      await refreshLocation(state); await persistWindow(state);
      return { success: true, session: state.session, observation:observer.capture() };
    },

    selectOption: async (payload: AgentBrowserSelectorPayload & { label: string }): Promise<AgentBrowserActionResult> => {
      if (typeof payload.label !== 'string') throw new Error('E_ARG: label must be a string');
      const state = await ensureState(payload.sessionId, 'selectOption');
      const observer=observeNativeAction(state,payload.timeoutMs);
      let fieldChange:AgentBrowserActionResult['fieldChange'];
      try {
      if (!state.upstream) observer.beforeExecute();
      fieldChange = state.upstream ? await state.upstream.setField(payload.selector, 'combobox', payload.label, payload.timeoutMs,observer.beforeExecute)
        : await changeField(state, payload.selector, payload.timeoutMs, async (target, remaining) => {
        if (await target.evaluate((element, label) => Array.from((element as HTMLSelectElement).options ?? []).filter(option => option.label === label).length, payload.label, { timeout: remaining() }) > 1) {
          throw new Error('E_AMBIGUOUS_OPTION: more than one option has this label; no selection performed');
        }
        await target.selectOption({ label: payload.label }, { timeout: remaining() });
      });
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
      await refreshLocation(state); await persistWindow(state);
      return { success: true, session: state.session, fieldChange, observation:observer.capture() };
    },
    setChecked: async (payload: AgentBrowserSelectorPayload & { checked: boolean }): Promise<AgentBrowserActionResult> => {
      if (typeof payload.checked !== 'boolean') throw new Error('E_ARG: checked must be a boolean');
      const state = await ensureState(payload.sessionId, 'setChecked');
      const observer=observeNativeAction(state,payload.timeoutMs);
      let fieldChange:AgentBrowserActionResult['fieldChange'];
      try {
      if (!state.upstream) observer.beforeExecute();
      fieldChange = state.upstream ? await state.upstream.setField(payload.selector, 'checkbox', String(payload.checked), payload.timeoutMs,observer.beforeExecute)
        : await changeField(state, payload.selector, payload.timeoutMs, (target, remaining) => target.setChecked(payload.checked, { timeout: remaining() }));
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
      await refreshLocation(state); await persistWindow(state);
      return { success: true, session: state.session, fieldChange, observation:observer.capture() };
    },
    selectValues: async (payload: AgentBrowserSelectorPayload & { values: string[] }): Promise<AgentBrowserActionResult> => {
      if (!Array.isArray(payload.values) || payload.values.length > 80 || payload.values.some(value => typeof value !== 'string') || new Set(payload.values).size !== payload.values.length) throw new Error('E_ARG: values must be up to 80 unique strings');
      const state = await ensureState(payload.sessionId, 'selectValues');
      const observer=observeNativeAction(state,payload.timeoutMs);
      let fieldChange:AgentBrowserActionResult['fieldChange'];
      try {
      if (!state.upstream) observer.beforeExecute();
      fieldChange = state.upstream ? await state.upstream.selectValues(payload.selector, payload.values, payload.timeoutMs,observer.beforeExecute)
        : await changeField(state, payload.selector, payload.timeoutMs, async (target, remaining) => {
          await target.evaluate(assertSelectValues, payload.values, { timeout: remaining() });
          await target.selectOption(payload.values.map(value => ({ value })), { timeout: remaining() });
        });
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
      await refreshLocation(state); await persistWindow(state);
      return { success: true, session: state.session, fieldChange, observation:observer.capture() };
    },
    appendText: async (payload: AgentBrowserTypePayload): Promise<AgentBrowserActionResult> => {
      if (typeof payload.text !== 'string') throw new Error('E_ARG: text must be a string');
      const state = await ensureState(payload.sessionId, 'appendText');
      const observer=observeNativeAction(state,payload.timeoutMs);
      let fieldChange:AgentBrowserActionResult['fieldChange'];
      try {
      if (!state.upstream) observer.beforeExecute();
      fieldChange = state.upstream ? await state.upstream.appendText(payload.selector, payload.text, payload.timeoutMs,observer.beforeExecute)
        : await changeField(state, payload.selector, payload.timeoutMs, async (target, remaining) => {
          if (!await target.isEditable({ timeout: remaining() })) throw new Error('E_FIELD_READONLY: field is not editable');
          await target.focus({ timeout: remaining() });
          await target.evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          await target.press('ControlOrMeta+End', { timeout: remaining() });
          await target.evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          await target.pressSequentially(payload.text, { timeout: remaining() });
        });
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
      await refreshLocation(state); await persistWindow(state);
      return { success: true, session: state.session, fieldChange, observation:observer.capture() };
    },
    screenshot: async (payload: AgentBrowserScreenshotPayload): Promise<AgentBrowserScreenshotResult> => {
      if (payload.selector !== undefined && (typeof payload.selector !== 'string' || !payload.selector.trim() || payload.fullPage)) {
        throw new Error('E_ARG: screenshot selector must be nonempty and cannot be combined with fullPage');
      }
      const state = await ensureState(payload.sessionId, 'screenshot');
      if (payload.selector !== undefined && !state.upstream) throw new Error('E_NOT_IMPLEMENTED: element screenshots require the upstream backend');
      const shot: { buffer: Buffer; capture?: AgentBrowserScreenshotResult['capture'] } = state.upstream
        ? await state.upstream.screenshot(payload)
        : { buffer: await state.page.screenshot({ fullPage: payload.fullPage ?? false, timeout: 10000 }) };
      const { buffer } = shot;
      return {
        success: true,
        session: state.session,
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        format: 'png',
        ...(shot.capture ? { capture: shot.capture } : {}),
      };
    },

    ...(semanticGateway || options.persistent || options.kitesurf ? { semanticRead: async (payload: AgentBrowserSemanticPayload, request?: { signal?: AbortSignal }): Promise<AgentBrowserSemanticResult> => {
      const state = await ensureState(payload.sessionId, 'semanticRead');
      if (!state.semantic || !state.upstream) throw new Error('E_SEMANTIC_CONFIG: no semantic adapter for this session');
      try {
        const read = await state.upstream.semanticRead((page, remaining) => state.semantic!.read(page, { ...payload, timeoutMs: remaining() }, request?.signal), payload.timeoutMs);
        return { success: true, session: state.session, value: read.result.data, model: read.result.model, source: { ...read.source, sessionId: payload.sessionId } };
      } catch (error) {
        if (!state.browser.isConnected()) await api.close({ sessionId: payload.sessionId });
        throw error;
      }
    },

    } : {}),
    pdf: async (payload: AgentBrowserPdfPayload): Promise<AgentBrowserPdfResult> => {
      const state = await ensureState(payload.sessionId, 'pdf');
      if (!state.kitesurf) return notImplemented('pdf');
      const cdp = await (state.page as unknown as UpstreamPage).context().newCDPSession(state.page as unknown as UpstreamPage);
      try {
        const result = await cdp.send('Page.printToPDF', {
          printBackground: payload.printBackground ?? true,
          ...(payload.landscape !== undefined ? { landscape: payload.landscape } : {}),
          ...(payload.scale !== undefined ? { scale: payload.scale } : {}),
          ...(payload.paperWidth !== undefined ? { paperWidth: payload.paperWidth } : {}),
          ...(payload.paperHeight !== undefined ? { paperHeight: payload.paperHeight } : {}),
          ...(payload.margin ? { marginTop: payload.margin.top, marginBottom: payload.margin.bottom, marginLeft: payload.margin.left, marginRight: payload.margin.right } : {}),
        });
        const buffer = Buffer.from(result.data, 'base64');
        return { success: true, dataUrl: `data:application/pdf;base64,${result.data}`, bytes: buffer.length, format: 'pdf' };
      } finally { await cdp.detach(); }
    },
    ...(options.upstream || options.kitesurf ? upstreamReads : {}),
    takeSnapshot: async (payload: AgentBrowserTakeSnapshotPayload): Promise<AgentBrowserTakeSnapshotResult> => {
      const state = await ensureState(payload.sessionId, 'takeSnapshot');
      if (payload.selector !== undefined && (typeof payload.selector !== 'string' || !payload.selector.trim())) throw new Error('E_ARG: snapshot selector must be nonempty');
      if ((payload.selector !== undefined || payload.paged || payload.cursor !== undefined) && !state.upstream) throw new Error('E_NOT_IMPLEMENTED: scoped/paged snapshots require upstream');
      const html = state.kitesurf ? String(await state.page.evaluate('document.documentElement.outerHTML')) : await state.page.content();
      const title = await state.page.title();
      const textLen = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
      if (state.upstream) {
        const slice = payload.paged || payload.cursor !== undefined ? await state.upstream.snapshotPage({ selector: payload.selector, cursor: payload.cursor }) : undefined;
        const items = slice?.items ?? await state.upstream.snapshot(payload.selector); await refreshLocation(state);
        const snapshot = formatActionableSnapshot({ title: state.session.title ?? title, url: state.page.url(), htmlBytes: Buffer.byteLength(html), textChars: textLen }, items, 'vb_click / vb_type / vb_press / vb_select / vb_check');
        return { success: true, session: state.session, snapshot, items, ...(slice ? { page: slice.page } : {}) };
      }
      let items: InteractiveElement[];
      try {
        // TF-0092：可点击元素发现规则默认 off（保持既有快照面与已发布读数）；
        // `VERSEBROWSER_SNAPSHOT_CLICKABLE=pointer` 才额外收录 cursor:pointer 的叶子式元素。
        items = (await state.page.evaluate(
          buildCollectInteractiveExpression({ clickable: resolveClickableDiscovery() }),
        )) as InteractiveElement[];
      } catch {
        items = [];
      }
      const snapshot = formatActionableSnapshot(
        {
          title,
          url: state.page.url(),
          htmlBytes: Buffer.byteLength(html, 'utf8'),
          textChars: textLen,
        },
        items,
      );
      // TF-0108: the snapshot already reads the live url/title — make the session
      // agree with it instead of leaving a stale identity on the same result.
      state.session.url = state.page.url();
      state.session.title = title;
      state.session.updatedAt = new Date().toISOString();
      return {
        success: true,
        session: state.session,
        snapshot,
        // Structured items let the facade diff what actually changed (TF-0102).
        items: items.map((item) => ({
          ref: item.ref,
          value: item.value,
          valueRedacted: item.valueRedacted,
          disabled: item.disabled,
          readOnly: item.readOnly,
          checked: item.checked,
          selected: item.selected,
          ...(item.tag ? { tag: item.tag } : {}),
          role: item.role,
          name: item.name,
          ...(item.href ? { href: item.href } : {}),
          // TF-0107: disclosure state travels with the structured item too, so the
          // facade can see a collapse→expand flip in a diff.
          ...(item.expanded !== undefined ? { expanded: item.expanded } : {}),
          ...(item.controls ? { controls: item.controls } : {}),
        })),
      };
    },

    evaluate: async (
      payload: AgentBrowserEvaluatePayload,
    ): Promise<AgentBrowserEvaluateResult> => {
      const state = await ensureState(payload.sessionId, 'evaluate');
      const value = await state.page.evaluate(payload.expression);
      // TF-0108: arbitrary JS can navigate; keep the session identity honest.
      await refreshLocation(state);
      return { success: true, session: state.session, value };
    },

    getConsoleMessages: async (
      payload: AgentBrowserConsoleMessagesPayload,
    ): Promise<AgentBrowserConsoleMessagesResult> => {
      const state = await ensureState(payload.sessionId, 'getConsoleMessages');
      if (state.signals.observationWindowMissing) {
        return { success: false, content: '', error: 'current page observation window is unavailable after the live URL changed; navigate again to collect it' };
      }
      const lines = state.signals.consoleLines.map((line) => {
        const text =
          typeof line.text === 'string'
            ? line.text
            : line.message !== undefined
              ? String(line.message)
              : JSON.stringify(line);
        return `[${line.type ?? 'log'}] ${text}`;
      });
      return { success: true, content: lines.join('\n'), currentPageStart: lines.slice(0, state.signals.windowStart.console).join('\n').split('\n').filter(Boolean).length,
        ...(state.signals.partialReason?{collection:'degraded',collectionError:state.signals.partialReason}:{}) };
    },

    networkListRequests: async (
      payload: AgentBrowserNetworkListPayload,
    ): Promise<AgentBrowserNetworkListResult> => {
      const state = await ensureState(payload.sessionId, 'networkListRequests');
      if (state.signals.observationWindowMissing) {
        return { success: false, requests: [], error: 'current page observation window is unavailable after the live URL changed; navigate again to collect it' };
      }
      const filter = payload.filter;
      let rows = [...state.signals.network];
      if (filter?.urlIncludes) rows = rows.filter((r) => r.url.includes(filter.urlIncludes!));
      if (filter?.method) rows = rows.filter((r) => r.method === filter.method);
      if (typeof filter?.status === 'number') rows = rows.filter((r) => r.status === filter.status);
      if (typeof filter?.limit === 'number') rows = rows.slice(0, filter.limit);
      // TF-0104: list rows are redacted like the detail method (URL query params
      // can carry credentials; status/method are unaffected).
      return { success: true, requests: rows.map((row) => redactNetworkRequestMeta(row)), cursor: `${state.signals.captureEpoch}:${state.signals.network.length}`, ...(!filter ? { currentPageStart: state.signals.windowStart.network } : {}),
        ...(state.signals.partialReason?{collection:'degraded',collectionError:state.signals.partialReason}:{}) };
    },

    /**
     * TF-0104: wait until a matching request appears, or (without a filter) until
     * the page goes quiet. Returns rows redacted like the request list; an empty
     * list means "nothing matched/observed inside the window".
     */
    networkWaitForRequests: async (
      payload: AgentBrowserNetworkWaitPayload,
    ): Promise<AgentBrowserNetworkWaitResult> => {
      const state = await ensureState(payload.sessionId, 'networkWaitForRequests');
      const signals=state.signals, observedPage=state.page;
      const timeoutMs = Math.min(Math.max(Math.trunc(payload.timeoutMs ?? 5_000), 1), 30_000);
      const filter = payload.filter;
      if (payload.responseComplete && !filter) return { success: false, requests: [], error: 'E_ARG: responseComplete requires a filter' };
      const matches = (row: NetRow): boolean => {
        if (payload.responseComplete && signals.networkCaptures.get(row.id)?.completion !== 'complete') return false;
        if (filter?.urlIncludes && !row.url.includes(filter.urlIncludes)) return false;
        if (filter?.method && row.method !== filter.method) return false;
        if (typeof filter?.status === 'number' && row.status !== filter.status) return false;
        return true;
      };
      let startLength = signals.network.length;
      if (payload.sinceCursor !== undefined) {
        const [epoch, index, extra] = payload.sinceCursor.split(':');
        if (epoch !== signals.captureEpoch || !/^\d+$/u.test(index ?? '') || extra !== undefined || Number(index) > signals.network.length) {
          return { success: false, requests: [], error: 'network cursor unavailable: foreign session, expired capture or invalid index; obtain a fresh cursor before the action' };
        }
        startLength = Number(index);
      }
      const deadline = Date.now() + timeoutMs;
      const idleMs = 500;
      let lastLength = startLength;
      let quietSince = Date.now();
      for (;;) {
        if (!sessions.has(payload.sessionId) || state.signals !== signals || observedPage.isClosed?.() || signals.observationWindowMissing) {
          return { success: false, requests: [], error: 'network collection unavailable: session/page changed or observation window lost' };
        }
        const fresh = signals.network.slice(startLength);
        if (filter) {
          const matched = fresh.filter(matches);
          if (matched.length > 0) {
            return {
              success: true,
              requests: matched.map((row) => redactNetworkRequestMeta(row)),
              ...(payload.responseComplete ? { responseComplete: true } : {}),
            };
          }
        } else if (signals.network.length === lastLength) {
          if (Date.now() - quietSince >= idleMs) {
            return {
              success: true,
              requests: fresh.map((row) => redactNetworkRequestMeta(row)),
            };
          }
        } else {
          lastLength = signals.network.length;
          quietSince = Date.now();
        }
        if (Date.now() >= deadline) {
          return {
            success: true,
            requests: (filter ? fresh.filter(matches) : fresh).map((row) => redactNetworkRequestMeta(row)),
            ...(payload.responseComplete ? { responseComplete: true } : {}),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, Math.max(1, deadline - Date.now()))));
      }
    },

    close: async (payload: AgentBrowserSessionPayload): Promise<HostSuccess> => {
      const sessionId = payload.sessionId;
      const closing = sessionClosures.get(sessionId);
      if (closing) return closing;
      const pending = closeSession(sessionId);
      sessionClosures.set(sessionId, pending);
      try {
        return await pending;
      } finally {
        sessionClosures.delete(sessionId);
      }
    },

    status: (): AgentBrowserStatusResult => {
      discardDisconnectedSessions();
      return {
        success: true,
        sessions: [...sessions.values()].filter(s => s.browser.isConnected()).map(s => s.session),
        browserControlEnabled: true,
      };
    },

    setEnabled: (payload: { enabled: boolean }) => ({
      success: true,
      enabled: payload.enabled,
    }),

    // Thin Drive: everything else is explicitly out of scope on this driver.
    focus: () => notImplemented('focus'),    command: () => notImplemented('command'),
    tasks: () => notImplemented('tasks'),
    createTask: () => notImplemented('createTask'),
    runTask: () => notImplemented('runTask'),
    retryTask: () => notImplemented('retryTask'),
    cancelTask: () => notImplemented('cancelTask'),
    requestTaskApproval: () => notImplemented('requestTaskApproval'),
    approveTask: () => notImplemented('approveTask'),
    rejectTask: () => notImplemented('rejectTask'),
    show: () => notImplemented('show'),
    hide: () => notImplemented('hide'),
    vault: () => notImplemented('vault'),
    vaultHealth: () => notImplemented('vaultHealth'),
    saveCredential: () => notImplemented('saveCredential'),
    deleteCredential: () => notImplemented('deleteCredential'),
    clickByUid: async (payload: AgentBrowserClickByUidPayload): Promise<AgentBrowserActionResult> => {
      const state = await ensureState(payload.sessionId, 'clickByUid');
      const selector = resolveRefSelector(payload.uid);
      await state.page.waitForSelector(selector, { timeout: 5000 });
      await state.page.click(selector, { timeout: 5000 });
      state.session.updatedAt = new Date().toISOString();
      return { success: true, session: state.session };
    },

    fillByUid: async (payload: AgentBrowserFillByUidPayload): Promise<AgentBrowserActionResult> => {
      const state = await ensureState(payload.sessionId, 'fillByUid');
      const selector = resolveRefSelector(payload.uid);
      if (payload.clear) {
        await state.page.fill(selector, '');
      }
      await state.page.fill(selector, payload.value);
      state.session.updatedAt = new Date().toISOString();
      return { success: true, session: state.session };
    },

    /**
     * TF-0113: keyboard input. The engine already had `press_key` in the
     * browser-control action layer, but the thin driver returned
     * E_NOT_IMPLEMENTED and no MCP tool exposed it — so an Enter-to-submit form
     * or a keyboard-driven widget was undrivable: `vb_type` fills a field and
     * never presses a key. Keys are validated against a fixed map, so this stays
     * a bounded input primitive rather than "send any key string".
     */
    pressKey: async (payload: AgentBrowserPressKeyPayload): Promise<AgentBrowserActionResult> => {
      const state = await ensureState(payload.sessionId, 'pressKey');
      const key = normalizeKeyName(payload.key);
      const observer=observeNativeAction(state,10000);
      let fieldChange: AgentBrowserActionResult['fieldChange'];
      try {
      if (state.upstream) fieldChange = await state.upstream.press(key, payload.selector,observer.beforeExecute);
      else {
        observer.beforeExecute();
        const keyboard = state.page.keyboard;
        if (!keyboard || typeof keyboard.press !== 'function') {
          return notImplemented('pressKey');
        }
        if (payload.selector) fieldChange = await changeField(state, payload.selector, 5000, async (target, remaining) => {
          await target.focus({ timeout: remaining() });
          await target.evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          await keyboard.press(key);
        });
        else await keyboard.press(key);
      }
      } catch(error) {throw observer.failure(error);} finally {observer.dispose();}
      // A key can submit a form or trigger navigation; keep the session honest.
      await refreshLocation(state);
      await persistWindow(state);
      return { success: true, session: state.session, ...(fieldChange ? { fieldChange } : {}), observation:observer.capture() };
    },
    requestModeUpgrade: () => notImplemented('requestModeUpgrade'),
    respondBoundaryChoice: () => notImplemented('respondBoundaryChoice'),
    /**
     * TF-0103: request/response details for ids from `vb_network_list`. Headers
     * are always captured; bodies only for textual responses within the capture
     * cap. Sensitive fields are **always** redacted here — the thin driver has no
     * full-access path, so `redacted: false` cannot reveal raw values.
     */
    networkGetRequestDetails: async (
      payload: AgentBrowserNetworkDetailPayload,
    ): Promise<AgentBrowserNetworkDetailResult> => {
      const state = await ensureState(payload.sessionId, 'networkGetRequestDetails');
      const details: unknown[] = [];
      for (const id of payload.requestIds) {
        const row = state.signals.network.find((entry) => entry.id === id);
        if (!row) continue;
        const capture = state.signals.networkCaptures.get(id);
        const buffer = capture?.body ? await capture.body() : null;
        const truncated = buffer ? buffer.length > DETAIL_BODY_LIMIT : false;
        const detail = {
          id: row.id,
          url: row.url,
          method: row.method,
          ...(row.status !== undefined ? { status: row.status } : {}),
          ...(row.failed ? { failed: true } : {}),
          ...(row.error ? { error: row.error } : {}),
          ...(capture?.mimeType ? { mimeType: capture.mimeType } : {}),
          ...(capture
            ? { requestHeaders: capture.requestHeaders, responseHeaders: capture.responseHeaders }
            : {}),
          ...(buffer
            ? { responseBody: buffer.toString('utf8').slice(0, DETAIL_BODY_LIMIT), responseBodyEncoding: 'utf8' }
            : {}),
          truncated,
          redacted: false,
        };
        details.push(redactNetworkRequestDetail(detail as never));
      }
      state.session.updatedAt = new Date().toISOString();
      return { success: true, details };
    },
    networkClearRequests: () => notImplemented('networkClearRequests'),
    networkCompareRequests: () => notImplemented('networkCompareRequests'),
    networkFindParameterCandidates: () => notImplemented('networkFindParameterCandidates'),
    networkExtractJsCandidates: () => notImplemented('networkExtractJsCandidates'),
    newPage: async (payload:import('../types/host-api.ts').AgentBrowserNewPagePayload) => {
      const state=await ensureState(payload.sessionId, 'newPage');
      if(!state.upstream)return notImplemented('newPage');
      return {success:true,...await state.upstream.newPage(payload.url,payload.background,(page,info)=>activatePage(state,page,info))};
    },
    listPages: async (payload: AgentBrowserSessionPayload) => {
      const state=await ensureState(payload.sessionId, 'listPages');
      if(!state.upstream)return notImplemented('listPages');
      return {success:true,...await state.upstream.listPages()};
    },
    readDialogs: async (payload:AgentBrowserSessionPayload) => {
      const state=await ensureState(payload.sessionId, 'readDialogs');
      if(!state.upstream)return notImplemented('readDialogs');
      return {success:true,...state.upstream.readDialogs()};
    },
    respondDialog: async (payload:import('../types/host-api.ts').AgentBrowserDialogResponsePayload) => {
      const state=await ensureState(payload.sessionId, 'respondDialog');
      if(!state.upstream)return notImplemented('respondDialog');
      return {success:true,...await state.upstream.respondDialog(payload.dialogId,payload.accept,payload.promptText)};
    },
    selectPage: async (payload: import('../types/host-api.ts').AgentBrowserSelectPagePayload) => {
      const state=await ensureState(payload.sessionId, 'selectPage');
      if(!state.upstream)return notImplemented('selectPage');
      const result=await state.upstream.selectPage(payload.pageId,(page,info)=>activatePage(state,page,info));
      return {success:true,...result};
    },
    closePage: async (payload:import('../types/host-api.ts').AgentBrowserClosePagePayload) => {
      const state=await ensureState(payload.sessionId, 'closePage');
      if(!state.upstream)return notImplemented('closePage');
      return {success:true,...await state.upstream.closePage(payload.pageId,(page,info)=>activatePage(state,page,info))};
    },
    navigatePage: () => notImplemented('navigatePage'),
    jsListResources: () => notImplemented('jsListResources'),
    jsSearchSources: () => notImplemented('jsSearchSources'),
    jsExtractContext: () => notImplemented('jsExtractContext'),
    sourceMapListCandidates: () => notImplemented('sourceMapListCandidates'),
    sourceMapResolveLocation: () => notImplemented('sourceMapResolveLocation'),
    sourceMapExtractOriginalContext: () => notImplemented('sourceMapExtractOriginalContext'),
    /**
     * TF-0105: bounded runtime-globals read. Reuses the product's
     * RuntimeReadToolExecutor, so the only thing that can run on the page is its
     * **fixed** `Runtime.evaluate` template over an allow-listed dotted path —
     * arbitrary JavaScript stays behind `full_access.*`, which this driver does
     * not serve. Depth / entry / byte budgets are enforced, accessors are
     * skipped (a read must not fire page getters), and sensitive keys/values are
     * redacted before they leave the page.
     *
     * The deep-read gate (mode ≥ `controlled_enhanced`) lives in the facade,
     * which is this method's only caller; the executor's own authorization check
     * is satisfied here with the read-only context.
     */
    runtimeInspectGlobals: async (
      payload: AgentBrowserRuntimeInspectGlobalsPayload,
    ): Promise<AgentBrowserRuntimeInspectGlobalsResult> => {
      const state = await ensureState(payload.sessionId, 'runtimeInspectGlobals');
      const executor = new RuntimeReadToolExecutor(
        {
          evaluate: async (params) => {
            const value = await state.page.evaluate(String(params.expression));
            // RuntimeReadToolExecutor parses the CDP Runtime.evaluate shape.
            return { result: { value } };
          },
        },
        () => RUNTIME_READ_AUTHORIZATION,
      );
      const result = await executor.inspectGlobals({
        paths: payload.paths,
        ...(payload.maxDepth !== undefined ? { maxDepth: payload.maxDepth } : {}),
        ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
      });
      state.session.updatedAt = new Date().toISOString();
      return {
        success: true,
        content: result.content,
        ...(result.isError ? { isError: true } : {}),
        ...(result.redacted !== undefined ? { redacted: result.redacted } : {}),
        ...(result.truncated !== undefined ? { truncated: result.truncated } : {}),
      };
    },
    // Host-engine capabilities: module search and function-source reads need the
    // credentialed host runtime, not the thin driver.
    runtimeSearchModules: () => notImplemented('runtimeSearchModules'),
    runtimeDescribeFunction: () => notImplemented('runtimeDescribeFunction'),
    replayPrepareRequest: () => notImplemented('replayPrepareRequest'),
    replaySendRequest: () => notImplemented('replaySendRequest'),
    replayCompareResponses: () => notImplemented('replayCompareResponses'),
    fullAccessExecuteScript: () => notImplemented('fullAccessExecuteScript'),
    fullAccessFetch: () => notImplemented('fullAccessFetch'),
    fullAccessGetNetworkDetails: () => notImplemented('fullAccessGetNetworkDetails'),
    fullAccessReadStorage: () => notImplemented('fullAccessReadStorage'),
    fullAccessRevoke: () => notImplemented('fullAccessRevoke'),
    /**
     * TF-0098: budgeted page-text read. Reuses the product's existing
     * PageTextExtractor (visible-text walker, whitespace-normalized, truncating)
     * so an agent can quote a page verbatim instead of guessing from the
     * interactive snapshot, which carries no body text.
     */
    extractPageText: async (
      payload: AgentBrowserExtractPageTextPayload,
    ): Promise<AgentBrowserExtractPageTextResult> => {
      const state = await ensureState(payload.sessionId, 'extractPageText');
      // TF-0164: an explicit frame scope is served by the upstream control, which resolves the
      // same frame identity the snapshot stamps into its refs and refuses an unknown, detached or
      // unauthorized frame. The main frame (omitted or "main") keeps the existing path below.
      if (payload.frameId !== undefined && payload.frameId !== 'main') {
        if (!state.upstream) throw new Error('E_NOT_IMPLEMENTED: frame-scoped text requires the upstream driver');
        const read = await state.upstream.frameText({
          frameId: payload.frameId,
          ...(payload.maxLength !== undefined ? { maxLength: payload.maxLength } : {}),
        });
        state.session.updatedAt = new Date().toISOString();
        return {
          success: true,
          text: read.text,
          truncated: read.truncated,
          usedFallback: false,
          sourceUrl: read.scope.url,
          observation: { sessionId: payload.sessionId, pageId: read.scope.pageId, frameId: read.scope.frameId, observationId: read.scope.observationId, capturedAt: state.session.updatedAt },
        };
      }
      const extractor = new PageTextExtractor({
        evaluate: async (params) => {
          const value = await state.page.evaluate(String(params.expression));
          // PageTextExtractor parses the CDP Runtime.evaluate shape.
          return { result: { value } };
        },
      });
      const result = await extractor.extract({
        metadata: payload.metadata,
        rows: payload.rows,
        structured: payload.structured,
        url: state.page.url(),
        rules: payload.rules,
        extractMode: payload.extractMode ?? 'text',
        selectorType: payload.selectorType ?? 'css',
        allowFallback: payload.allowFallback ?? true,
        ...(payload.maxLength !== undefined ? { maxLength: payload.maxLength } : {}),
      });
      state.session.updatedAt = new Date().toISOString();
      return { success: true, ...result, observation: { sessionId: payload.sessionId, pageId: state.signals.captureEpoch, frameId: 'main', observationId: randomUUID(), capturedAt: state.session.updatedAt } };
    },
    validateExtractionRule: () => notImplemented('validateExtractionRule'),
    profiles: () => notImplemented('profiles'),
    saveProfile: () => notImplemented('saveProfile'),
    validate: () => notImplemented('validate'),
  };

  const status: AgentBrowserStatusResult = api.status();
  void status;
  return api as unknown as AgentBrowserHostApi;
}

/** True when this process can attempt playwright-core auto-start. */
export function isPlaywrightDriverAvailable(): boolean {
  if (process.env.VERSEBROWSER_NO_DRIVER === '1') return false;
  return true;
}
