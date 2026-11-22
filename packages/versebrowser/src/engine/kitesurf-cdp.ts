/**
 * Loopback Kitesurf attach for the standalone CDP driver.
 *
 * Kitesurf provides DOM, JavaScript, accessibility, input, and target CDP
 * domains. Its targets belong to one WebSocket, so the standalone CLI owns a
 * loopback control process for the session instead of treating a later CDP
 * connection as a Chromium-style restoration. Callers opt in with
 * `browser: 'kitesurf'` plus an existing loopback
 * endpoint. A loopback `/json/version` that already identifies Kitesurf gets
 * the same ceiling, so a plain `--cdp` attach cannot treat it as Chromium.
 * Remote Browser Run stays out of this path.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

type CdpMessage = {
  method?: string;
  params?: { targetId?: string; sessionId?: string; targetInfo?: { targetId?: string } };
};

/**
 * Kitesurf reports an explicit Target.attachToTarget as another
 * Target.attachedToTarget for the same Page. Chromium's Playwright adapter
 * treats that second notification as a second Page and throws. Keep the first
 * session responsible for that Page; explicit CDP commands still work on the
 * newly returned Kitesurf session, and a detached target can attach afresh.
 */
function createTransport(socket: WebSocket) {
  const pages = new Map<string, string>();
  const transport = {
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
    onmessage: undefined as ((message: CdpMessage) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
  };
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    const targetId = message.params?.targetInfo?.targetId ?? message.params?.targetId;
    const sessionId = message.params?.sessionId;
    if (message.method === 'Target.attachedToTarget' && targetId && sessionId) {
      const owner = pages.get(targetId);
      if (owner && owner !== sessionId) return;
      pages.set(targetId, sessionId);
    } else if (message.method === 'Target.detachedFromTarget' && sessionId) {
      for (const [id, owner] of pages) if (owner === sessionId) pages.delete(id);
    } else if (message.method === 'Target.targetDestroyed' && targetId) pages.delete(targetId);
    transport.onmessage?.(message);
  });
  socket.addEventListener('close', () => transport.onclose?.());
  return transport;
}

export async function connectKitesurfOverCDP<T>(chromium: { connectOverCDP: (transport: unknown) => Promise<T> }, endpoint: string): Promise<T> {
  assertKitesurfLoopback(endpoint);
  const socket = new WebSocket(endpoint);
  const transport = createTransport(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('E_KITESURF_ENDPOINT: WebSocket attach timed out')), 15_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('E_KITESURF_ENDPOINT: WebSocket attach failed')); }, { once: true });
    });
    return await chromium.connectOverCDP(transport);
  } catch (error) {
    socket.close();
    throw error;
  }
}

/** Native CDP page, script and observation capabilities. File and AI actions stay separate. */
export const KITESURF_METHODS = new Set([
  'navigate',
  'waitForSelector',
  'click',
  'type',
  'pressKey',
  'pointer',
  'drag',
  'selectOption',
  'setChecked',
  'selectValues',
  'appendText',
  'evaluate',
  'pdf',
  'newPage',
  'listPages',
  'selectPage',
  'closePage',
  'readDialogs',
  'respondDialog',
  'networkGetRequestDetails',
  'networkWaitForRequests',
  'findElement',
  'readForms',
  'screenshot',
  'takeSnapshot',
  'extractPageText',
  'getConsoleMessages',
  'networkListRequests',
  'close',
  'status',
]);

export function assertKitesurfMethod(method: string): void {
  if (!KITESURF_METHODS.has(method)) {
    throw new Error(`E_CAPABILITY_UNAVAILABLE: kitesurf does not provide this VB capability: ${method}`);
  }
}

export function cdpVersionUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('E_KITESURF_ENDPOINT: CDP endpoint is not a URL');
  }
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('E_KITESURF_ENDPOINT: CDP endpoint must be http(s) or ws(s)');
  }
  if (url.username || url.password) {
    throw new Error('E_KITESURF_ENDPOINT: credentials do not belong in the CDP URL');
  }
  url.pathname = '/json/version';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function isKitesurfLoopback(endpoint: string): boolean {
  try {
    return LOOPBACK.has(new URL(cdpVersionUrl(endpoint)).hostname);
  } catch {
    return false;
  }
}

export function assertKitesurfLoopback(endpoint: string): void {
  if (!isKitesurfLoopback(endpoint)) {
    throw new Error('E_KITESURF_ENDPOINT: only a loopback Kitesurf engine is supported');
  }
}

export function isKitesurfVersion(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  const text = ['Browser', 'browser', 'Product', 'product', 'User-Agent', 'userAgent']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  return /\bkitesurf\b/i.test(text);
}

export async function readCdpVersion(endpoint: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  assertKitesurfLoopback(endpoint);
  const response = await fetcher(cdpVersionUrl(endpoint), { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`E_KITESURF_ENDPOINT: version probe returned ${response.status}`);
  return response.json() as Promise<unknown>;
}
