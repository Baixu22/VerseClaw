/**
 * 同源 JS 资源抓取器 — 抄写自 browser-ai-assistant-master/src/background/browserControl/sameOriginJsFetcher.ts
 * 适配点：仅 import 路径（../../shared/types → ../core/types，
 * ../../shared/utils/text → ../core/text）。
 * 保留 1MB 上限、8s 超时、同源校验、可信 MIME、凭证省略、禁止跨域重定向。
 * 网络读取由所属浏览器会话注入，缺少网络 owner 时拒绝回源。
 */
import type { JsSourceFetchFailure } from '../../core/types.ts';
import { truncateText } from '../../core/text.ts';

export interface SameOriginJsFetchSuccess {
  ok: true;
  resource: {
    id: string;
    source: 'same-origin-fetch';
    url: string;
    mimeType?: string;
    content: string;
    fetchedAt: number;
  };
}

export type SameOriginJsFetchResult = SameOriginJsFetchSuccess | ({ ok: false } & JsSourceFetchFailure);

const MAX_JS_FETCH_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 8000;
const TRUSTED_JS_MIME_TYPES = new Set([
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-javascript',
]);
const PLAIN_TEXT_MIME_TYPE = 'text/plain';

export class SameOriginJsFetcher {
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = async () => { throw new Error('Browser network owner is unavailable'); }) {
    this.fetcher = fetcher;
  }

  async fetch(url: string, pageUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SameOriginJsFetchResult> {
    const urlResult = normalizeSameOriginJsUrl(url, pageUrl);
    if (!urlResult.ok) {
      return { ok: false, url, message: urlResult.message };
    }

    // 测试或非标准运行环境可能缺少 AbortController；Electron main 中正常可用。
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), Math.max(1, timeoutMs)) : undefined;
    try {
      const response = await this.fetcher(urlResult.url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
        signal: controller?.signal,
      });
      const finalUrl = response.url || urlResult.url;
      if (isRedirectResponse(response)) {
        await discardBody(response);
        return { ok: false, url: urlResult.url, message: '同源 JS 补位拒绝跨域重定向。' };
      }
      if (!isSameOrigin(finalUrl, pageUrl)) {
        await discardBody(response);
        return { ok: false, url: urlResult.url, message: '同源 JS 补位拒绝跨域重定向。' };
      }
      if (!response.ok) {
        await discardBody(response);
        return { ok: false, url: urlResult.url, message: '同源 JS 补位读取失败。' };
      }

      const mimeType = response.headers.get('content-type') ?? undefined;
      if (!isTrustedJavaScriptMime(mimeType, urlResult.url)) {
        await discardBody(response);
        return { ok: false, url: urlResult.url, message: '同源 JS 补位只接受 JavaScript 文本资源。' };
      }
      if (isContentLengthTooLarge(response.headers.get('content-length'))) {
        await discardBody(response);
        return { ok: false, url: urlResult.url, message: '同源 JS 补位响应超过大小上限。' };
      }

      const content = await readTextWithLimit(response, MAX_JS_FETCH_BYTES);
      if (content.truncated) {
        return { ok: false, url: urlResult.url, message: '同源 JS 补位响应超过大小上限。' };
      }

      return {
        ok: true,
        resource: {
          id: createFetchedResourceId(finalUrl),
          source: 'same-origin-fetch',
          url: finalUrl,
          mimeType,
          content: content.text,
          fetchedAt: Date.now(),
        },
      };
    } catch {
      return { ok: false, url: urlResult.url, message: '同源 JS 补位读取失败。' };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

function normalizeSameOriginJsUrl(url: string, pageUrl: string): { ok: true; url: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url, pageUrl);
  } catch {
    return { ok: false, message: '同源 JS 补位 URL 格式无效。' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: '同源 JS 补位只允许 http 或 https URL。' };
  }

  if (!isSameOrigin(parsed.toString(), pageUrl)) {
    return { ok: false, message: '同源 JS 补位只允许读取当前页面同源资源。' };
  }

  if (!hasJavaScriptPathname(parsed.toString())) {
    return { ok: false, message: '同源 JS 补位只接受 JavaScript 文本资源。' };
  }

  return { ok: true, url: parsed.toString() };
}

function isSameOrigin(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.protocol === rightUrl.protocol && leftUrl.hostname === rightUrl.hostname && leftUrl.port === rightUrl.port;
  } catch {
    return false;
  }
}

function hasJavaScriptPathname(url: string): boolean {
  try {
    return /\.(?:m?js)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isTrustedJavaScriptMime(mimeType: string | undefined, url: string): boolean {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  // 只对路径已确认是 .js/.mjs 的静态文件兼容 text/plain，避免把任意纯文本接口当作源码补位。
  return TRUSTED_JS_MIME_TYPES.has(normalized) || (normalized === PLAIN_TEXT_MIME_TYPE && hasJavaScriptPathname(url));
}

function isRedirectResponse(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

function isContentLengthTooLarge(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const size = Number(value);
  return Number.isFinite(size) && size > MAX_JS_FETCH_BYTES;
}

/**
 * 早退路径（重定向 / 非同源 / 非 2xx / MIME 不符 / content-length 过大）在读取前就返回，
 * 之前既没读完也没取消 body：响应体与它的连接被弃置（调用方的 abort 定时器此时已被清除）。
 * 统一做 best-effort 取消；取消失败不影响返回给调用方的判定。
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // best effort
  }
}
async function readTextWithLimit(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body?.getReader) {
    const text = await response.text();
    return { text: truncateText(text, maxBytes).text, truncated: text.length > maxBytes };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          // 超限即早退：必须 cancel，否则剩余字节永远不会被读走，响应体与其连接被弃置到 GC。
          try { await reader.cancel(); } catch { /* best effort */ }
          return { text: chunks.join(''), truncated: true };
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
    const text = chunks.join('');
    return { text, truncated: false };
  } finally {
    reader.releaseLock();
  }
}

function createFetchedResourceId(url: string): string {
  return `same-origin-js:${url}`;
}
