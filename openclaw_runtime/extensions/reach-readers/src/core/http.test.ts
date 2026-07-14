import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  release,
  fetchWithSsrFGuard,
  resolveSsrFPolicyForUrl,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} = vi.hoisted(() => ({
  release: vi.fn(async () => undefined),
  fetchWithSsrFGuard: vi.fn(),
  resolveSsrFPolicyForUrl: vi.fn(() => ({ mode: 'strict' })),
  ssrfPolicyFromHttpBaseUrlAllowedHostname: vi.fn(() => ({ mode: 'official' })),
}));

vi.mock('openclaw/plugin-sdk/ssrf-runtime', () => ({
  fetchWithSsrFGuard,
  resolveSsrFPolicyForUrl,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
}));

import { httpJson, httpText } from './http.js';

describe('Reach guarded HTTP boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWithSsrFGuard.mockResolvedValue({
      response: new Response('ok'),
      release,
    });
  });

  it('uses official-host policy only for declared platform APIs', async () => {
    await httpText('https://api.bilibili.com/x/web-interface/search/type');
    await httpText('https://example.com/article');

    expect(ssrfPolicyFromHttpBaseUrlAllowedHostname).toHaveBeenCalledTimes(1);
    expect(resolveSsrFPolicyForUrl).toHaveBeenCalledTimes(1);
    expect(fetchWithSsrFGuard.mock.calls[0]?.[0]).toMatchObject({
      policy: { mode: 'official' },
      auditContext: 'reach-readers.http',
    });
    expect(fetchWithSsrFGuard.mock.calls[1]?.[0]).toMatchObject({
      policy: { mode: 'strict' },
      auditContext: 'reach-readers.http',
    });
  });

  it('releases guarded resources when JSON parsing fails', async () => {
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response('not-json'),
      release,
    });

    await expect(httpJson('https://www.v2ex.com/api/topics/hot.json')).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized text and releases guarded resources', async () => {
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response('too large'),
      release,
    });

    await expect(httpText('https://example.com/article', { maxBytes: 3 })).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
