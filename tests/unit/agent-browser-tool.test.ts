import { describe, expect, it, vi } from 'vitest';
import { isToolResultError } from '../../openclaw_runtime/src/agents/embedded-agent-subscribe.tools';
import { createAgentBrowserTool } from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';

function readJsonResult(result: unknown): Record<string, unknown> | undefined {
  const record = result as { content?: Array<{ text?: string }> };
  const text = record.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
}

describe('agent_browser tool', () => {
  it('is omitted until an Electron browser bridge is injected', () => {
    expect(createAgentBrowserTool()).toBeNull();
  });

  it('normalizes open and action payloads for the injected invoker', async () => {
    const invoke = vi.fn(async (action, payload) => ({ action, payload }));
    const tool = createAgentBrowserTool({ invoke });

    const opened = await tool!.execute('tool-1', {
      action: 'open',
      url: 'https://example.com',
      profile: 'work',
      mode: 'headless',
      authStateName: 'mail',
    });
    expect(readJsonResult(opened)).toMatchObject({
      action: 'open',
      payload: {
        url: 'https://example.com',
        profile: 'work',
        mode: 'headless',
        authStateName: 'mail',
      },
      browserAutomationEvent: {
        schemaVersion: 1,
        tool: 'agent_browser',
        action: 'open',
        ok: true,
        url: 'https://example.com',
      },
    });

    const clicked = await tool!.execute('tool-2', {
      action: 'click',
      sessionId: 's1',
      selector: '#publish',
      timeoutMs: 1000,
    });
    expect(readJsonResult(clicked)).toMatchObject({
      action: 'click',
      payload: { sessionId: 's1', selector: '#publish', timeoutMs: 1000 },
    });

    const commanded = await tool!.execute('tool-3', {
      action: 'command',
      sessionId: 's1',
      args: ['snapshot', '-i'],
      globalOptions: ['--ignore-https-errors'],
      connectionMode: 'auto-connect',
      allowExternalBrowser: true,
      maxOutput: 2000,
    });
    expect(readJsonResult(commanded)).toMatchObject({
      action: 'command',
      payload: {
        sessionId: 's1',
        args: ['snapshot', '-i'],
        globalOptions: ['--ignore-https-errors'],
        connectionMode: 'auto-connect',
        allowExternalBrowser: true,
        maxOutput: 2000,
      },
    });
  });

  it('requires session ids for session-scoped actions', async () => {
    const tool = createAgentBrowserTool({ invoke: vi.fn() });

    await expect(tool!.execute('tool-1', { action: 'screenshot' })).rejects.toThrow(
      'screenshot.sessionId required',
    );
  });

  it('collects minimal diagnostics when a session-scoped browser action throws', async () => {
    const invoke = vi.fn(async (action, payload) => {
      if (action === 'click') {
        throw new Error('click failed');
      }
      if (action === 'screenshot') {
        return {
          success: true,
          dataUrl: 'data:image/png;base64,AAAA',
          session: { id: (payload as { sessionId: string }).sessionId },
        };
      }
      if (action === 'command') {
        return {
          success: true,
          command: (payload as { args: string[] }).args,
          stdout: `diagnostic:${(payload as { args: string[] }).args.join(' ')}`,
        };
      }
      return { success: true };
    });
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'click',
      sessionId: 's1',
      selector: '#check-in',
    });
    const payload = readJsonResult(result);
    const events = payload?.browserAutomationEvents as Array<Record<string, unknown>>;

    expect(isToolResultError(result)).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      success: false,
      error: 'click failed',
      browserAutomationEvent: {
        schemaVersion: 1,
        tool: 'agent_browser',
        action: 'click',
        ok: false,
        sessionId: 's1',
        error: 'click failed',
      },
    });
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({
      action: 'screenshot',
      ok: true,
      sessionId: 's1',
      screenshotDataUrl: 'data:image/png;base64,AAAA',
    });
    expect(events.slice(1).map((event) => event.command)).toEqual([
      ['snapshot', '-i'],
      ['console'],
      ['errors'],
      ['network', 'requests'],
    ]);
    expect(invoke.mock.calls.map(([action]) => action)).toEqual([
      'click',
      'screenshot',
      'command',
      'command',
      'command',
      'command',
    ]);
    expect(invoke.mock.calls.slice(2).map(([, callPayload]) => callPayload)).toEqual([
      { sessionId: 's1', args: ['snapshot', '-i'], maxOutput: 120000 },
      { sessionId: 's1', args: ['console'], maxOutput: 120000 },
      { sessionId: 's1', args: ['errors'], maxOutput: 120000 },
      { sessionId: 's1', args: ['network', 'requests'], maxOutput: 120000 },
    ]);
  });

  it('collects diagnostics for failure-like results and preserves error status', async () => {
    const invoke = vi.fn(async (action, payload) => {
      if (action === 'click') {
        return {
          success: false,
          status: 'ok',
          error: 'selector missing',
          session: { id: 's1' },
        };
      }
      if (action === 'screenshot') {
        return { success: true, dataUrl: 'data:image/png;base64,BBBB' };
      }
      if (action === 'command') {
        return {
          success: true,
          stdout: 'diagnostic output',
        };
      }
      return { success: true };
    });
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'click',
      sessionId: 's1',
      selector: '#check-in',
    });
    const payload = readJsonResult(result);

    expect(isToolResultError(result)).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      success: false,
      error: 'selector missing',
      browserAutomationEvent: {
        action: 'click',
        ok: false,
        sessionId: 's1',
        error: 'selector missing',
      },
    });
    expect(payload?.browserAutomationEvents).toHaveLength(5);
    expect((payload?.browserAutomationEvents as Array<Record<string, unknown>>).slice(1).map((event) => event.command)).toEqual([
      ['snapshot', '-i'],
      ['console'],
      ['errors'],
      ['network', 'requests'],
    ]);
  });

  it('does not collect diagnostics when no browser session is available', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('browser launch failed');
    });
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'open',
      url: 'https://example.com',
    });
    const payload = readJsonResult(result);

    expect(isToolResultError(result)).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      success: false,
      error: 'browser launch failed',
      browserAutomationEvent: {
        action: 'open',
        ok: false,
        url: 'https://example.com',
        error: 'browser launch failed',
      },
    });
    expect(payload?.browserAutomationEvents).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('routes getConsoleMessages with sessionId payload and skips failure diagnostics', async () => {
    const invoke = vi.fn(async (_action, payload) => ({
      success: true,
      content: `[console] sample message for session ${(payload as { sessionId: string }).sessionId}`,
    }));
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'getConsoleMessages',
      sessionId: 's-console',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      content: '[console] sample message for session s-console',
      browserAutomationEvent: {
        action: 'getConsoleMessages',
        ok: true,
        sessionId: 's-console',
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]).toEqual(['getConsoleMessages', { sessionId: 's-console' }]);
  });

  it('getConsoleMessages does not trigger failure diagnostics when invoker throws', async () => {
    const invoke = vi.fn(async (action) => {
      if (action === 'getConsoleMessages') {
        throw new Error('console recorder not initialized');
      }
      return { success: true };
    });
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'getConsoleMessages',
      sessionId: 's-console',
    });
    const payload = readJsonResult(result);

    expect(isToolResultError(result)).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      success: false,
      error: 'console recorder not initialized',
    });
    expect(payload?.browserAutomationEvents).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
