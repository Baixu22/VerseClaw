/**
 * Electron multi-process host API — TF-0028/0029 named workflow driver.
 *
 * Launches a fixture Electron app via playwright-core `_electron`, discovers
 * main/renderer targets, attaches to the app renderer, captures console stacks,
 * and supports verify_flow via the shared facade contract.
 */
import { randomUUID } from 'node:crypto';
import {
  classifyTarget,
  createAttachState,
  formatAttachFailure,
  planReconnect,
  recordAttachEvent,
  selectRendererTarget,
  type ElectronAttachState,
  type ElectronTargetDescriptor,
} from './electron-attach.ts';
import type {
  AgentBrowserHostApi,
  AgentBrowserSession,
  AgentBrowserSessionResult,
  AgentBrowserActionResult,
  AgentBrowserScreenshotResult,
  AgentBrowserTakeSnapshotResult,
  AgentBrowserConsoleMessagesResult,
  AgentBrowserNetworkListResult,
  AgentBrowserOpenPayload,
  AgentBrowserNavigatePayload,
  AgentBrowserSelectorPayload,
  AgentBrowserTypePayload,
  AgentBrowserScreenshotPayload,
  AgentBrowserTakeSnapshotPayload,
  AgentBrowserConsoleMessagesPayload,
  AgentBrowserNetworkListPayload,
  AgentBrowserSessionPayload,
  AgentBrowserClickPayload,
  AgentBrowserStatusResult,
  HostSuccess,
} from '../types/host-api.ts';

type ElectronAppLike = {
  firstWindow: (options?: { timeout?: number }) => Promise<ElectronPageLike>;
  windows: () => ElectronPageLike[];
  evaluate: (fn: (electron: unknown) => unknown) => Promise<unknown>;
  close: () => Promise<void>;
  process: () => { stdout: { on: (e: string, cb: (d: Buffer) => void) => void }; stderr: { on: (e: string, cb: (d: Buffer) => void) => void }; on: (e: string, cb: (c: number | null) => void) => void };
  on?: (event: string, cb: (...args: never[]) => void) => void;
};

type ElectronPageLike = {
  url: () => string;
  title: () => Promise<string>;
  goto: (url: string) => Promise<unknown>;
  waitForSelector: (sel: string, opts?: { timeout?: number }) => Promise<unknown>;
  click: (sel: string) => Promise<void>;
  fill: (sel: string, text: string) => Promise<void>;
  screenshot: () => Promise<Buffer>;
  content: () => Promise<string>;
  on: (event: string, cb: (...args: never[]) => void) => void;
  close?: () => Promise<void>;
};

type SessionRec = {
  session: AgentBrowserSession;
  app: ElectronAppLike;
  page: ElectronPageLike;
  state: ElectronAttachState;
  consoleLines: Array<{ type?: string; text?: string }>;
  network: AgentBrowserNetworkListResult['requests'];
  netSeq: number;
  appRoot: string;
};

export type ElectronHostApiOptions = {
  /** Path to Electron main entry (fixture). */
  mainPath: string;
  /** App root for source-map discovery. */
  appRoot: string;
  executablePath?: string;
  args?: string[];
};

function notImplemented(method: string): never {
  const err = new Error(
    `${method} is not available on the electron-loop driver (Drive is thin).`,
  ) as Error & { code?: string };
  err.code = 'E_NOT_IMPLEMENTED';
  throw err;
}

export async function createElectronHostApi(
  options: ElectronHostApiOptions,
): Promise<AgentBrowserHostApi> {
  const { _electron } = await import('playwright-core');
  const electronLauncher = _electron as unknown as {
    launch: (opts: {
      args: string[];
      executablePath?: string;
    }) => Promise<ElectronAppLike>;
  };

  const sessions = new Map<string, SessionRec>();

  function requireRec(sessionId: string): SessionRec {
    const rec = sessions.get(sessionId);
    if (!rec) {
      const err = new Error(`unknown electron session: ${sessionId || '(empty)'}`) as Error & {
        code?: string;
      };
      err.code = 'E_NO_SESSION';
      throw err;
    }
    return rec;
  }

  function listTargets(rec: SessionRec): ElectronTargetDescriptor[] {
    // Synthesize target list from windows + main process handle.
    const targets: ElectronTargetDescriptor[] = [
      classifyTarget({ type: 'main', id: 'main', url: 'node://main', title: 'main' }),
    ];
    const windows = rec.app.windows();
    windows.forEach((win, index) => {
      targets.push(
        classifyTarget({
          type: 'page',
          targetId: `renderer-${index}`,
          url: win.url(),
          title: `window-${index}`,
          attached: win === rec.page,
        }),
      );
    });
    return targets;
  }

  async function attachRenderer(rec: SessionRec): Promise<void> {
    const targets = listTargets(rec);
    rec.state.targets = targets;
    const selection = selectRendererTarget(targets, {
      preferUrlIncludes: rec.session.url ?? 'index',
    });
    if (!selection.target) {
      throw new Error(formatAttachFailure(rec.state, 'E_NO_RENDERER', selection.reason));
    }
    rec.state.selectedId = selection.target.id;
    rec.state.attached = true;
    recordAttachEvent(rec.state, 'attach', selection.reason);
  }

  const api = {
    open: async (payload: AgentBrowserOpenPayload = {}): Promise<AgentBrowserSessionResult> => {
      const app = await electronLauncher.launch({
        args: [
          options.mainPath,
          ...(options.args ?? []),
          ...(payload.url ? [`--open-url=${payload.url}`] : []),
        ],
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      });
      // Wait for the first renderer window (main is ready after whenReady + createWindow).
      // Short per-attempt timeout — never burn 30s inside firstWindow retries.
      let page: ElectronPageLike | undefined;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        try {
          page = await app.firstWindow({ timeout: 400 });
          break;
        } catch {
          const wins = app.windows();
          if (wins.length > 0) {
            page = wins[0];
            break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (!page) {
        void app.close().catch(() => undefined);
        throw new Error(
          formatAttachFailure(
            createAttachState('open'),
            'E_NO_WINDOW',
            'Electron launched but no BrowserWindow appeared within 8s',
          ),
        );
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      const session: AgentBrowserSession = {
        id,
        profile: 'electron-loop',
        mode: 'visible',
        connection: { mode: 'auto-connect' },
        createdAt: now,
        updatedAt: now,
        runtimeMode: 'normal_restricted',
        url: page.url(),
      };
      const rec: SessionRec = {
        session,
        app,
        page,
        state: createAttachState(id),
        consoleLines: [],
        network: [],
        netSeq: 0,
        appRoot: options.appRoot,
      };
      page.on('console', ((msg: unknown) => {
        const m = msg as { type?: string | (() => string); text?: string | (() => string) };
        rec.consoleLines.push({
          type: typeof m.type === 'function' ? m.type() : (m.type ?? 'log'),
          text: typeof m.text === 'function' ? m.text() : (m.text ?? String(msg)),
        });
      }) as never);
      page.on('pageerror', ((err: { message?: string; stack?: string }) => {
        rec.consoleLines.push({ type: 'error', text: err?.stack || err?.message || String(err) });
      }) as never);

      sessions.set(id, rec);
      await attachRenderer(rec);
      try {
        session.title = await page.title();
      } catch {
        /* ignore */
      }
      return { success: true, session };
    },

    navigate: async (payload: AgentBrowserNavigatePayload): Promise<AgentBrowserActionResult> => {
      const rec = requireRec(payload.sessionId);
      await rec.page.goto(payload.url);
      rec.session.url = rec.page.url();
      rec.session.updatedAt = new Date().toISOString();
      recordAttachEvent(rec.state, 'nav', payload.url);
      return { success: true, session: rec.session };
    },

    waitForSelector: async (payload: AgentBrowserSelectorPayload): Promise<AgentBrowserActionResult> => {
      const rec = requireRec(payload.sessionId);
      await rec.page.waitForSelector(payload.selector, { timeout: payload.timeoutMs ?? 5000 });
      return { success: true, session: rec.session };
    },

    click: async (payload: AgentBrowserClickPayload): Promise<AgentBrowserActionResult> => {
      const rec = requireRec(payload.sessionId);
      await rec.page.click(payload.selector);
      return { success: true, session: rec.session };
    },

    type: async (payload: AgentBrowserTypePayload): Promise<AgentBrowserActionResult> => {
      const rec = requireRec(payload.sessionId);
      await rec.page.fill(payload.selector, payload.text);
      return { success: true, session: rec.session };
    },

    screenshot: async (payload: AgentBrowserScreenshotPayload): Promise<AgentBrowserScreenshotResult> => {
      if (payload.selector !== undefined) throw new Error('E_NOT_IMPLEMENTED: Electron does not declare element screenshots');
      const rec = requireRec(payload.sessionId);
      const buffer = await rec.page.screenshot();
      return {
        success: true,
        session: rec.session,
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        format: 'png',
      };
    },

    takeSnapshot: async (payload: AgentBrowserTakeSnapshotPayload): Promise<AgentBrowserTakeSnapshotResult> => {
      const rec = requireRec(payload.sessionId);
      const html = await rec.page.content();
      const title = await rec.page.title();
      const targets = listTargets(rec);
      const snapshot = [
        '# electron snapshot',
        `- title: ${title}`,
        `- url: ${rec.page.url()}`,
        `- targets: ${targets.map((t) => `${t.kind}:${t.id}`).join(', ')}`,
        `- html_bytes: ${Buffer.byteLength(html, 'utf8')}`,
      ].join('\n');
      return { success: true, session: rec.session, snapshot };
    },

    getConsoleMessages: async (
      payload: AgentBrowserConsoleMessagesPayload,
    ): Promise<AgentBrowserConsoleMessagesResult> => {
      const rec = requireRec(payload.sessionId);
      const content = rec.consoleLines
        .map((l) => `[${l.type ?? 'log'}] ${l.text ?? ''}`)
        .join('\n');
      return { success: true, content };
    },

    networkListRequests: async (
      payload: AgentBrowserNetworkListPayload,
    ): Promise<AgentBrowserNetworkListResult> => {
      const rec = requireRec(payload.sessionId);
      return { success: true, requests: [...rec.network] };
    },

    status: (): AgentBrowserStatusResult => ({
      success: true,
      sessions: [...sessions.values()].map((s) => s.session),
      browserControlEnabled: true,
    }),

    close: (payload: AgentBrowserSessionPayload): HostSuccess => {
      const rec = sessions.get(payload.sessionId);
      if (!rec) return { success: true };
      sessions.delete(payload.sessionId);
      recordAttachEvent(rec.state, 'close');
      void rec.app.close().catch(() => undefined);
      return { success: true };
    },

    setEnabled: (payload: { enabled: boolean }) => ({ success: true, enabled: payload.enabled }),

    // Reconnect probe used by stability tests / loop runner.
    // Exposed via evaluate-style extension below.

    focus: () => notImplemented('focus'),
    evaluate: () => notImplemented('evaluate'),
    command: () => notImplemented('command'),
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
    clickByUid: () => notImplemented('clickByUid'),
    fillByUid: () => notImplemented('fillByUid'),
    pressKey: () => notImplemented('pressKey'),
    requestModeUpgrade: () => notImplemented('requestModeUpgrade'),
    respondBoundaryChoice: () => notImplemented('respondBoundaryChoice'),
    networkGetRequestDetails: () => notImplemented('networkGetRequestDetails'),
    networkClearRequests: () => notImplemented('networkClearRequests'),
    networkWaitForRequests: () => notImplemented('networkWaitForRequests'),
    networkCompareRequests: () => notImplemented('networkCompareRequests'),
    networkFindParameterCandidates: () => notImplemented('networkFindParameterCandidates'),
    networkExtractJsCandidates: () => notImplemented('networkExtractJsCandidates'),
    newPage: () => notImplemented('newPage'),
    listPages: () => notImplemented('listPages'),
    selectPage: () => notImplemented('selectPage'),
    closePage: () => notImplemented('closePage'),
    navigatePage: () => notImplemented('navigatePage'),
    jsListResources: () => notImplemented('jsListResources'),
    jsSearchSources: () => notImplemented('jsSearchSources'),
    jsExtractContext: () => notImplemented('jsExtractContext'),
    sourceMapListCandidates: () => notImplemented('sourceMapListCandidates'),
    sourceMapResolveLocation: () => notImplemented('sourceMapResolveLocation'),
    sourceMapExtractOriginalContext: () => notImplemented('sourceMapExtractOriginalContext'),
    runtimeInspectGlobals: () => notImplemented('runtimeInspectGlobals'),
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
    extractPageText: () => notImplemented('extractPageText'),
    validateExtractionRule: () => notImplemented('validateExtractionRule'),
    profiles: () => notImplemented('profiles'),
    saveProfile: () => notImplemented('saveProfile'),
    validate: () => notImplemented('validate'),
  };

  // Stability helper for the loop runner (not part of HostApi surface).
  Object.assign(api, {
    __reconnect: async (sessionId: string, detachReason?: string) => {
      const rec = requireRec(sessionId);
      const targets = listTargets(rec);
      const plan = planReconnect(
        rec.state.targets.find((t) => t.id === rec.state.selectedId) ?? null,
        targets,
        detachReason,
        rec.state.reconnectAttempts,
      );
      rec.state.reconnectAttempts += 1;
      recordAttachEvent(rec.state, `reconnect:${plan.action}`, plan.reason);
      if (plan.action === 'fail') {
        return { ok: false, message: formatAttachFailure(rec.state, 'E_RECONNECT', plan.reason) };
      }
      if (plan.action === 'reuse') {
        rec.state.selectedId = plan.targetId;
        rec.state.attached = true;
        // Re-bind page from windows
        const wins = rec.app.windows();
        if (wins.length > 0) rec.page = wins[0];
        return { ok: true, message: plan.reason, targetId: plan.targetId };
      }
      return { ok: false, message: plan.reason, action: 'rescan' };
    },
    __state: (sessionId: string) => requireRec(sessionId).state,
  });

  return api as unknown as AgentBrowserHostApi;
}

export function isElectronDriverAvailable(): boolean {
  if (process.env.VERSEBROWSER_NO_DRIVER === '1') return false;
  return process.env.VERSEBROWSER_NO_ELECTRON !== '1';
}
