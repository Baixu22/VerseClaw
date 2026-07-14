import { describe, expect, it, vi } from 'vitest';
import {
  configureReachBrowserBridge,
  createBrowserLoginRequired,
  createReachBrowserBridge,
} from './browser-bridge.js';

describe('Reach Agent Browser bridge', () => {
  it('reuses profile/auth state and closes a headless page session', async () => {
    const invoke = vi.fn(async ({ action, payload }) => {
      if (action === 'open') return { session: { id: 'session-1' } };
      if (action === 'command') {
        const args = payload.args as string[];
        return { output: args[1] === 'title' ? 'Title' : args[1] === 'url' ? 'https://final.example/' : 'Body' };
      }
      return { success: true };
    });
    const bridge = createReachBrowserBridge(invoke);
    const page = await bridge.readPage('https://example.com', { profile: 'default' });

    expect(page).toMatchObject({ title: 'Title', text: 'Body', backend: 'agent-browser' });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'open',
      payload: expect.objectContaining({ profile: 'default', authStateName: 'default', mode: 'headless' }),
    }));
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'close',
      payload: { sessionId: 'session-1' },
    }));
  });

  it('keeps visible login sessions open', async () => {
    const invoke = vi.fn(async () => ({ session: { id: 'login-1' } }));
    const bridge = createReachBrowserBridge(invoke);
    await bridge.openLoginSession('https://x.com/i/flow/login', { profile: 'work' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reads and filters cookies from the Electron command data shape', async () => {
    const invoke = vi.fn(async () => ({
      data: [
        { name: 'xq_a_token', value: 'secret=value', domain: '.xueqiu.com', path: '/' },
        { name: 'other', value: 'ignored', domain: '.xueqiu.com' },
        { name: 'xq_a_token', value: 'ignored', domain: '.example.com' },
      ],
      stdout: '',
    }));
    const bridge = createReachBrowserBridge(invoke);

    await expect(bridge.readCookies(
      ['.xueqiu.com'],
      ['xq_a_token'],
      { profile: 'default' },
    )).resolves.toEqual([
      { name: 'xq_a_token', value: 'secret=value', domain: '.xueqiu.com', path: '/' },
    ]);
  });

  it('forwards AbortSignal to every browser invocation', async () => {
    const invoke = vi.fn(async () => ({ session: { id: 'login-1' } }));
    const bridge = createReachBrowserBridge(invoke);
    const controller = new AbortController();

    await bridge.openLoginSession('https://x.com/i/flow/login', {
      profile: 'default',
      signal: controller.signal,
    });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it('returns a stable login handoff with the original retry tool', async () => {
    const invoke = vi.fn(async () => ({ session: { id: 'login-42' } }));
    configureReachBrowserBridge(invoke);
    const retryTool = {
      name: 'twitter_read',
      arguments: { action: 'search', query: 'openclaw' },
    };

    await expect(createBrowserLoginRequired({
      loginUrl: 'https://x.com/i/flow/login',
      profile: 'work',
      retryTool,
    })).resolves.toEqual({
      status: 'browser_login_required',
      profile: 'work',
      sessionId: 'login-42',
      loginUrl: 'https://x.com/i/flow/login',
      retryTool,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'open',
      payload: expect.objectContaining({
        profile: 'work',
        authStateName: 'work',
        mode: 'visible',
      }),
    }));
  });

  it('reports no handoff when the browser bridge is unavailable', async () => {
    configureReachBrowserBridge(undefined);

    await expect(createBrowserLoginRequired({
      loginUrl: 'https://www.xiaohongshu.com/login',
      profile: 'default',
      retryTool: { name: 'xiaohongshu_read', arguments: { action: 'search' } },
    })).resolves.toBeUndefined();
  });
});
