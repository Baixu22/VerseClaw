import { describe, expect, it, vi } from 'vitest';

const callGateway = vi.hoisted(() => vi.fn());

vi.mock('../../gateway/call.js', () => ({ callGateway }));

import { createPluginRuntime } from './index.js';

describe('plugin runtime Agent Browser bridge', () => {
  it('routes the public helper through the Agent Browser Gateway method', async () => {
    callGateway.mockResolvedValueOnce({ success: true, sessionId: 'browser-1' });
    const signal = new AbortController().signal;
    const runtime = createPluginRuntime();

    await expect(runtime.agentBrowser.invoke({
      action: 'command',
      payload: { args: ['cookies'], profile: 'default' },
      timeoutMs: 7_500,
      signal,
    })).resolves.toEqual({ success: true, sessionId: 'browser-1' });

    expect(callGateway).toHaveBeenCalledWith({
      method: 'agentBrowser.invoke',
      params: {
        action: 'command',
        payload: { args: ['cookies'], profile: 'default' },
        timeoutMs: 7_500,
      },
      timeoutMs: 7_500,
      signal,
    });
  });

  it('rejects an already-aborted request before calling Gateway', async () => {
    callGateway.mockClear();
    const controller = new AbortController();
    controller.abort();
    const runtime = createPluginRuntime();

    await expect(runtime.agentBrowser.invoke({
      action: 'open',
      payload: { url: 'https://example.com' },
      signal: controller.signal,
    })).rejects.toThrow('agent browser invoke aborted');
    expect(callGateway).not.toHaveBeenCalled();
  });
});
