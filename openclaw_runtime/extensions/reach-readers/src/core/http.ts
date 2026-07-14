import { readResponseWithLimit } from 'openclaw/plugin-sdk/response-limit-runtime';
import {
  fetchWithSsrFGuard,
  resolveSsrFPolicyForUrl,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} from 'openclaw/plugin-sdk/ssrf-runtime';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const OFFICIAL_API_HOSTS = new Set([
  'r.jina.ai',
  'www.v2ex.com',
  'api.bilibili.com',
  'xueqiu.com',
  'stock.xueqiu.com',
]);

export interface HttpJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBytes?: number;
  noProxy?: boolean;
}

async function guardedFetch(url: string, opts: HttpJsonOptions, timeoutMs: number) {
  const parsed = new URL(url);
  const policy = OFFICIAL_API_HOSTS.has(parsed.hostname)
    ? ssrfPolicyFromHttpBaseUrlAllowedHostname(parsed.toString())
    : resolveSsrFPolicyForUrl(parsed);
  return fetchWithSsrFGuard({
    url: parsed.toString(),
    init: {
      headers: { 'User-Agent': DEFAULT_UA, ...opts.headers },
      signal: opts.signal,
    },
    timeoutMs,
    policy,
    auditContext: 'reach-readers.http',
  });
}

export async function withGuardedResponse<T>(
  url: string,
  opts: HttpJsonOptions,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const guarded = await guardedFetch(url, opts, opts.timeoutMs ?? 30_000);
  try {
    return await consume(guarded.response);
  } finally {
    await guarded.release();
  }
}

export async function httpJson<T = unknown>(url: string, opts: HttpJsonOptions = {}): Promise<T> {
  const guarded = await guardedFetch(url, opts, opts.timeoutMs ?? 10_000);
  try {
    if (!guarded.response.ok) throw new Error(`HTTP ${guarded.response.status}: ${url}`);
    const body = await readResponseWithLimit(
      guarded.response,
      opts.maxBytes ?? 10 * 1024 * 1024,
    );
    return JSON.parse(body.toString('utf8')) as T;
  } finally {
    await guarded.release();
  }
}

export async function httpText(url: string, opts: HttpJsonOptions = {}): Promise<string> {
  const guarded = await guardedFetch(url, opts, opts.timeoutMs ?? 30_000);
  try {
    if (!guarded.response.ok) throw new Error(`HTTP ${guarded.response.status}: ${url}`);
    const maxBytes = opts.maxBytes ??
      (new URL(url).hostname === 'r.jina.ai' ? 20 * 1024 * 1024 : 10 * 1024 * 1024);
    const body = await readResponseWithLimit(guarded.response, maxBytes);
    return body.toString('utf8');
  } finally {
    await guarded.release();
  }
}
