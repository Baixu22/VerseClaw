import { beforeEach, describe, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => [] as Array<{
  url: string;
  headers?: Record<string, string>;
}>);

vi.mock('../core/http.js', () => ({
  withGuardedResponse: async (
    url: string,
    options: { headers?: Record<string, string> },
    consume: (response: Response) => Promise<unknown>,
  ) => {
    requests.push({ url, headers: options.headers });
    const body = url === 'https://xueqiu.com'
      ? ''
      : JSON.stringify({ data: { items: [{ quote: { symbol: 'SH600519' } }] } });
    return await consume(new Response(body));
  },
}));

async function readQuoteWithBrowserCookies(cookies: unknown[]) {
  vi.resetModules();
  requests.length = 0;
  const { setConfigSnapshot } = await import('../core/config.js');
  const { configureReachBrowserBridge } = await import('../core/browser-bridge.js');
  setConfigSnapshot({ browser_fallback: 'auto', browser_profile: 'work' });
  configureReachBrowserBridge(async ({ action, payload }) => {
    expect(action).toBe('command');
    expect(payload).toMatchObject({
      args: ['cookies'],
      profile: 'work',
      authStateName: 'work',
    });
    return { data: cookies };
  });
  const { getStockQuote } = await import('./xueqiu.js');
  await getStockQuote('SH600519');
}

describe('Xueqiu Agent Browser cookie retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects filtered browser cookies only when xq_a_token is present', async () => {
    await readQuoteWithBrowserCookies([
      { name: 'xq_a_token', value: 'synthetic-token', domain: '.xueqiu.com' },
      { name: 'u', value: 'synthetic-user', domain: '.xueqiu.com' },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers?.Cookie).toContain('xq_a_token=synthetic-token');
    expect(requests[0]?.headers?.Cookie).toContain('u=synthetic-user');
  });

  it('keeps the homepage fallback when xq_a_token is absent', async () => {
    await readQuoteWithBrowserCookies([
      { name: 'u', value: 'synthetic-user', domain: '.xueqiu.com' },
    ]);

    expect(requests.map((request) => request.url)).toEqual([
      'https://xueqiu.com',
      'https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=SH600519',
    ]);
    expect(requests[1]?.headers?.Cookie).toBeUndefined();
  });
});
