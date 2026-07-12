import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpJson = vi.hoisted(() => vi.fn());

vi.mock('../core/http.js', () => ({ httpJson }));

import { configureReachBrowserBridge } from '../core/browser-bridge.js';
import { setConfigSnapshot } from '../core/config.js';
import { bilibiliReadTool } from './bilibili.js';

describe('bilibili_read Agent Browser fallback', () => {
  beforeEach(() => {
    httpJson.mockRejectedValue(new Error('bilibili api unavailable'));
    setConfigSnapshot({ browser_fallback: 'auto', browser_profile: 'default' });
  });

  it('returns a Browser page summary after the API backend fails', async () => {
    const invoke = vi.fn(async ({ action, payload }) => {
      if (action === 'open') return { session: { id: 'bili-1' } };
      if (action === 'command') {
        const args = payload.args as string[];
        return { output: args[1] === 'title' ? 'Bilibili' : args[1] === 'url'
          ? 'https://search.bilibili.com/all?keyword=openclaw'
          : 'Search results' };
      }
      return { success: true };
    });
    configureReachBrowserBridge(invoke);

    const result = await bilibiliReadTool.execute(
      'bili-browser',
      { action: 'search', keyword: 'openclaw', limit: 1 },
    );

    expect(result.details).toMatchObject({
      status: 'ok',
      success: true,
      backend: 'agent-browser',
      browserFallback: 'used',
      title: 'Bilibili',
      text: 'Search results',
    });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'close',
      payload: { sessionId: 'bili-1' },
    }));
  });
});
