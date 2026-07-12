import { describe, expect, it, vi } from 'vitest';
import { createReachBrowserBridge } from './browser-bridge.js';

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
});
