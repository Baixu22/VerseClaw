export interface ReachBrowserRequest {
  action: string;
  payload: Record<string, unknown>;
}

export interface BrowserPageResult {
  title: string;
  text: string;
  url: string;
  sessionId: string;
  backend: 'agent-browser';
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface BrowserLoginHandoff {
  profile: string;
  sessionId: string;
  loginUrl: string;
}

export interface ReachBrowserBridge {
  invoke<T>(request: ReachBrowserRequest, signal?: AbortSignal): Promise<T>;
  readPage(
    url: string,
    options: { profile: string; signal?: AbortSignal },
  ): Promise<BrowserPageResult>;
  readCookies(
    domains: readonly string[],
    names?: readonly string[],
    options?: { profile: string; signal?: AbortSignal },
  ): Promise<BrowserCookie[]>;
  openLoginSession(
    url: string,
    options: { profile: string; signal?: AbortSignal },
  ): Promise<BrowserLoginHandoff>;
}

type RuntimeInvoke = (params: {
  action: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}) => Promise<unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sessionIdFrom(value: unknown): string {
  const record = asRecord(value);
  const session = asRecord(record.session);
  const sessionId = session.id ?? record.sessionId;
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('agent browser did not return a sessionId');
  }
  return sessionId.trim();
}

function commandOutput(value: unknown): string {
  const record = asRecord(value);
  for (const key of ['output', 'stdout', 'text', 'value']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return '';
}

export function createReachBrowserBridge(invokeRuntime: RuntimeInvoke): ReachBrowserBridge {
  const invoke = async <T>(request: ReachBrowserRequest, signal?: AbortSignal): Promise<T> =>
    await invokeRuntime({
      action: request.action,
      payload: request.payload,
      timeoutMs: 120_000,
      signal,
    }) as T;

  return {
    invoke,
    async readPage(url, options) {
      const opened = await invoke<unknown>({
        action: 'open',
        payload: {
          url,
          profile: options.profile,
          mode: 'headless',
          authPersistence: 'session-name',
          authStateName: options.profile,
        },
      }, options.signal);
      const sessionId = sessionIdFrom(opened);
      try {
        const [title, canonicalUrl, text] = await Promise.all([
          invoke<unknown>({ action: 'command', payload: { sessionId, args: ['get', 'title'] } }, options.signal),
          invoke<unknown>({ action: 'command', payload: { sessionId, args: ['get', 'url'] } }, options.signal),
          invoke<unknown>({ action: 'command', payload: { sessionId, args: ['get', 'text', 'body'] } }, options.signal),
        ]);
        return {
          title: commandOutput(title),
          url: commandOutput(canonicalUrl) || url,
          text: commandOutput(text),
          sessionId,
          backend: 'agent-browser',
        };
      } finally {
        await invoke({ action: 'close', payload: { sessionId } }, options.signal).catch(() => undefined);
      }
    },
    async readCookies(domains, names, options = { profile: 'default' }) {
      const result = await invoke<unknown>({
        action: 'command',
        payload: {
          args: ['cookies'],
          profile: options.profile,
          mode: 'headless',
          authPersistence: 'session-name',
          authStateName: options.profile,
        },
      }, options.signal);
      let parsed: unknown = result;
      const record = asRecord(result);
      if (record.data !== undefined) parsed = record.data;
      const output = commandOutput(result);
      if (output) {
        try { parsed = JSON.parse(output); } catch { parsed = []; }
      }
      const rows = Array.isArray(parsed) ? parsed : asRecord(parsed).cookies;
      if (!Array.isArray(rows)) return [];
      const domainSet = new Set(domains.map((domain) => domain.toLowerCase()));
      const nameSet = names ? new Set(names) : undefined;
      return rows.flatMap((row): BrowserCookie[] => {
        const cookie = asRecord(row);
        if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' ||
            typeof cookie.domain !== 'string') return [];
        const domain = cookie.domain.toLowerCase();
        if (![...domainSet].some((allowed) => domain === allowed || domain.endsWith(`.${allowed.replace(/^\./, '')}`))) return [];
        if (nameSet && !nameSet.has(cookie.name)) return [];
        return [{
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          ...(typeof cookie.path === 'string' ? { path: cookie.path } : {}),
        }];
      });
    },
    async openLoginSession(url, options) {
      const opened = await invoke<unknown>({
        action: 'open',
        payload: {
          url,
          profile: options.profile,
          mode: 'visible',
          authPersistence: 'session-name',
          authStateName: options.profile,
        },
      }, options.signal);
      return { profile: options.profile, sessionId: sessionIdFrom(opened), loginUrl: url };
    },
  };
}

let activeBridge: ReachBrowserBridge | undefined;

export function configureReachBrowserBridge(invokeRuntime: RuntimeInvoke | undefined): void {
  activeBridge = invokeRuntime ? createReachBrowserBridge(invokeRuntime) : undefined;
}

export function getReachBrowserBridge(): ReachBrowserBridge | undefined {
  return activeBridge;
}

export async function createBrowserLoginRequired(params: {
  loginUrl: string;
  profile: string;
  retryTool: { name: string; arguments: Record<string, unknown> };
  signal?: AbortSignal;
}) {
  if (!activeBridge) return undefined;
  const handoff = await activeBridge.openLoginSession(params.loginUrl, {
    profile: params.profile,
    signal: params.signal,
  });
  return {
    status: 'browser_login_required' as const,
    ...handoff,
    retryTool: params.retryTool,
  };
}

export async function readBrowserFallbackPage(params: {
  url: string;
  profile: string;
  signal?: AbortSignal;
}): Promise<BrowserPageResult | undefined> {
  return activeBridge?.readPage(params.url, {
    profile: params.profile,
    signal: params.signal,
  });
}
