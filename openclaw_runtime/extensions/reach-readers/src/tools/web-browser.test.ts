import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpText = vi.hoisted(() => vi.fn());

vi.mock('../core/http.js', () => ({ httpText }));

import { configureReachBrowserBridge } from '../core/browser-bridge.js';
import { setConfigSnapshot } from '../core/config.js';
import { webReadTool } from './web.js';

describe('web_read Agent Browser fallback', () => {
  beforeEach(() => {
    httpText.mockReset();
    httpText.mockRejectedValue(new Error('jina unavailable'));
    configureReachBrowserBridge(undefined);
    setConfigSnapshot({ browser_fallback: 'auto', browser_profile: 'default' });
  });

  it('uses a headless Browser page after Jina fails', async () => {
    const invoke = vi.fn(async ({ action, payload }) => {
      if (action === 'open') return { session: { id: 'web-1' } };
      if (action === 'command') {
        const args = payload.args as string[];
        return { output: args[1] === 'title' ? 'Example' : args[1] === 'url'
          ? 'https://example.com/canonical'
          : 'Browser body' };
      }
      return { success: true };
    });
    configureReachBrowserBridge(invoke);

    const result = await webReadTool.execute('web-auto', { url: 'https://example.com' });

    expect(result.details).toMatchObject({
      status: 'ok',
      success: true,
      backend: 'agent-browser',
      browserFallback: 'used',
      url: 'https://example.com/canonical',
      title: 'Example',
      content: 'Browser body',
    });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'close',
      payload: { sessionId: 'web-1' },
    }));
  });

  it('opens a visible handoff session without reading page content', async () => {
    setConfigSnapshot({ browser_fallback: 'handoff', browser_profile: 'work' });
    const invoke = vi.fn(async () => ({ session: { id: 'visible-1' } }));
    configureReachBrowserBridge(invoke);

    const result = await webReadTool.execute('web-handoff', { url: 'https://example.com' });

    expect(result.details).toMatchObject({
      status: 'browser_login_required',
      success: false,
      profile: 'work',
      sessionId: 'visible-1',
      retryTool: {
        name: 'web_read',
        arguments: { url: 'https://example.com' },
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'open',
      payload: expect.objectContaining({ mode: 'visible' }),
    }));
  });

  it('does not call Browser when fallback is disabled', async () => {
    setConfigSnapshot({ browser_fallback: 'off' });
    const invoke = vi.fn();
    configureReachBrowserBridge(invoke);

    const result = await webReadTool.execute('web-off', { url: 'https://example.com' });

    expect(result.details).toMatchObject({
      status: 'error',
      error: 'jina unavailable',
      browserFallback: 'disabled',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('preserves the Jina diagnostic when Browser is unavailable', async () => {
    const result = await webReadTool.execute('web-unavailable', { url: 'https://example.com' });

    expect(result.details).toMatchObject({
      status: 'error',
      error: 'jina unavailable',
      browserFallback: 'unavailable',
    });
  });
});
