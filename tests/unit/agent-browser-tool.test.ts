import { describe, expect, it, vi } from 'vitest';
import { isToolResultError } from '../../openclaw_runtime/src/agents/embedded-agent-subscribe.tools';
import { createAgentBrowserTool } from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';
import { createTrustedProvenance } from '../../shared/security/content-provenance';

const TRUSTED_PROVENANCE_CONTEXT = {
  provenance: createTrustedProvenance({
    sourceKind: 'user-direct',
    sourceId: 'user-direct:agent-browser-test',
    receivedAt: '2026-08-21T00:00:00.000Z',
  }),
};

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
    const tool = createAgentBrowserTool({
      contentProvenanceContext: TRUSTED_PROVENANCE_CONTEXT,
      invoke,
    });

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

  it('maps the 13 source-only facade actions without dropping payload fidelity', async () => {
    const invoke = vi.fn(async (action, payload) => ({ action, payload }));
    const sourceOnly = ['downloadFile', 'uploadFiles', 'pointer', 'drag', 'selectOption', 'selectValues',
      'appendText', 'setChecked', 'findElement', 'semanticRead', 'readForms', 'readDialogs', 'respondDialog'];
    // These actions are not advertised by default (no Electron driver support), but the
    // payload mapping stays intact for a host that does serve them.
    const tool = createAgentBrowserTool({ invoke, availableActions: sourceOnly });
    const cases = [
      ['downloadFile', { selector: '#f', path: 'D:/tmp/f.bin' }],
      ['uploadFiles', { selector: '#f', paths: ['D:/tmp/a.txt'] }],
      ['pointer', { pointerAction: 'hover', selector: '#menu' }],
      ['drag', { sourceSelector: '#a', targetSelector: '#b' }],
      ['selectOption', { selector: '#s', label: 'One' }],
      ['selectValues', { selector: '#s', values: ['a', 'b'] }],
      ['appendText', { selector: '#t', text: ' tail' }],
      ['setChecked', { selector: '#c', checked: true }],
      ['findElement', { role: 'button', name: 'Save' }],
      ['semanticRead', { instruction: 'extract totals', schema: { type: 'object' } }],
      ['readForms', { selector: '#form' }],
      ['readDialogs', {}],
      ['respondDialog', { dialogId: 'd1', accept: true, promptText: 'ok' }],
    ] as const;
    for (const [action, extra] of cases) {
      const result = await tool!.execute('tool-' + action, { action, sessionId: 's1', ...extra });
      const expected = action === 'pointer'
        ? { sessionId: 's1', action: 'hover', selector: '#menu' }
        : { sessionId: 's1', ...extra };
      expect(readJsonResult(result)).toMatchObject({ action, payload: expect.objectContaining(expected) });
    }
    expect(invoke).toHaveBeenCalledTimes(cases.length);
  });

  it('preserves driver-unsupported errors instead of advertising a false pass', async () => {
    const invoke = vi.fn(async () => ({ success: false, ok: false, content: 'driver does not support authorized downloads', error: { code: 'E_NOT_IMPLEMENTED', message: 'driver does not support authorized downloads' } }));
    const tool = createAgentBrowserTool({ invoke, availableActions: ['downloadFile'] });
    const result = await tool!.execute('tool-1', { action: 'downloadFile', sessionId: 's1', selector: '#f', path: 'D:/tmp/f.bin' });
    expect(isToolResultError(result)).toBe(true);
    expect(readJsonResult(result)).toMatchObject({ status: 'error', success: false, error: { code: 'E_NOT_IMPLEMENTED' } });
  });

  it('forwards owner correlation and consumes the gateway request id without losing task/page ids', async () => {
    const invoke = vi.fn(async (action, payload, correlation) => ({
      success: true,
      gatewayRequestId: 'req-9',
      action,
      payload,
      correlation,
    }));
    const tool = createAgentBrowserTool({
      invoke,
      correlation: {
        runId: 'run-1',
        sessionKey: 'agent:main:session-1',
        agentSessionKey: 'agent:main:session-1',
        agentId: 'main',
      },
    });

    const result = await tool!.execute('tool-9', {
      action: 'open',
      url: 'http://127.0.0.1:9/fixture',
      taskId: 'task-1',
      pageId: 'page-1',
    });

    expect(invoke).toHaveBeenCalledWith(
      'open',
      expect.objectContaining({
        url: 'http://127.0.0.1:9/fixture',
        sessionKey: 'agent:main:session-1',
        agentId: 'main',
      }),
      expect.objectContaining({
        runId: 'run-1',
        sessionKey: 'agent:main:session-1',
        toolCallId: 'tool-9',
        taskId: 'task-1',
        pageId: 'page-1',
      }),
    );
    expect(readJsonResult(result)?.browserAutomationEvent).toMatchObject({
      gatewayRequestId: 'req-9',
      runId: 'run-1',
      sessionKey: 'agent:main:session-1',
      toolCallId: 'tool-9',
      taskId: 'task-1',
      pageId: 'page-1',
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
    const tool = createAgentBrowserTool({
      contentProvenanceContext: TRUSTED_PROVENANCE_CONTEXT,
      invoke,
    });

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
    const invoke = vi.fn(async (action, _payload) => {
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
    const tool = createAgentBrowserTool({
      contentProvenanceContext: TRUSTED_PROVENANCE_CONTEXT,
      invoke,
    });

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
    expect(invoke).toHaveBeenCalledWith('getConsoleMessages', { sessionId: 's-console' }, expect.objectContaining({ toolCallId: 'tool-1' }));
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

  it('routes navigate with url payload and session metadata', async () => {
    const invoke = vi.fn(async (_action, payload) => ({
      success: true,
      session: { id: (payload as { sessionId: string }).sessionId },
      url: (payload as { url: string }).url,
    }));
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'navigate',
      sessionId: 's-nav',
      url: 'https://example.com/page',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      url: 'https://example.com/page',
      browserAutomationEvent: {
        action: 'navigate',
        ok: true,
        sessionId: 's-nav',
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('navigate', { sessionId: 's-nav', url: 'https://example.com/page' }, expect.objectContaining({ toolCallId: 'tool-1' }));
  });

  it('routes waitForSelector with selector and timeout payload', async () => {
    const invoke = vi.fn(async (_action, payload) => ({
      success: true,
      found: true,
      session: { id: (payload as { sessionId: string }).sessionId },
    }));
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'waitForSelector',
      sessionId: 's-wait',
      selector: '.loaded',
      timeoutMs: 5000,
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      found: true,
      browserAutomationEvent: {
        action: 'waitForSelector',
        ok: true,
        sessionId: 's-wait',
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('waitForSelector', { sessionId: 's-wait', selector: '.loaded', timeoutMs: 5000 }, expect.objectContaining({ toolCallId: 'tool-1' }));
  });

  it('routes type with text and clear payload', async () => {
    const invoke = vi.fn(async (_action, payload) => ({
      success: true,
      session: { id: (payload as { sessionId: string }).sessionId },
    }));
    const tool = createAgentBrowserTool({
      contentProvenanceContext: TRUSTED_PROVENANCE_CONTEXT,
      invoke,
    });

    const result = await tool!.execute('tool-1', {
      action: 'type',
      sessionId: 's-type',
      selector: '#search',
      text: 'hello world',
      clear: true,
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      browserAutomationEvent: {
        action: 'type',
        ok: true,
        sessionId: 's-type',
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('type', { sessionId: 's-type', selector: '#search', text: 'hello world', clear: true }, expect.objectContaining({ toolCallId: 'tool-1' }));
  });

  it('routes evaluate with expression payload', async () => {
    const invoke = vi.fn(async (_action, payload) => ({
      success: true,
      result: 'Example Page',
      session: { id: (payload as { sessionId: string }).sessionId },
    }));
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'evaluate',
      sessionId: 's-eval',
      expression: 'document.title',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      result: 'Example Page',
      browserAutomationEvent: {
        action: 'evaluate',
        ok: true,
        sessionId: 's-eval',
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('evaluate', { sessionId: 's-eval', expression: 'document.title' }, expect.objectContaining({ toolCallId: 'tool-1' }));
  });

  it('routes close with sessionId payload', async () => {
    const invoke = vi.fn(async (_action, payload) => ({
      success: true,
      session: { id: (payload as { sessionId: string }).sessionId },
    }));
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'close',
      sessionId: 's-close',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      browserAutomationEvent: {
        action: 'close',
        ok: true,
        sessionId: 's-close',
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('close', { sessionId: 's-close' }, expect.objectContaining({ toolCallId: 'tool-1' }));
  });

  it('routes status with empty payload and returns session list', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      sessions: [{ id: 's1', url: 'https://a.com' }, { id: 's2', url: 'https://b.com' }],
    }));
    const tool = createAgentBrowserTool({ invoke });

    const result = await tool!.execute('tool-1', {
      action: 'status',
    });
    const payload = readJsonResult(result);

    expect(payload).toMatchObject({
      success: true,
      sessions: [{ id: 's1', url: 'https://a.com' }, { id: 's2', url: 'https://b.com' }],
      browserAutomationEvent: {
        action: 'status',
        ok: true,
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('status', {}, expect.objectContaining({ toolCallId: 'tool-1' }));
  });
});
