import { describe, expect, it, vi } from 'vitest';
import { createAgentBrowserTool } from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';
import { MODEL_ACTION_NAMES } from '@electron/services/agent-browser-capabilities';
import { getAgentBrowserCapabilities } from '@electron/services/agent-browser-api';

function readJsonResult(result: unknown): Record<string, unknown> | undefined {
  const record = result as { content?: Array<{ text?: string }> };
  const text = record.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
}

const invoke = () => vi.fn(async (action: string, payload: unknown) => ({ action, payload }));

describe('agent browser typed observation loop (spec N4)', () => {
  it('exposes snapshot/text/keyboard/verify as typed actions', () => {
    for (const action of ['takeSnapshot', 'extractPageText', 'pressKey', 'verifyFlow']) {
      expect(MODEL_ACTION_NAMES).toContain(action);
    }
  });

  it('never advertises an approval-granting action to the model', () => {
    // The model must not be able to grant itself runtime mode, boundary choices,
    // task approvals or full access from a tool argument.
    for (const forbidden of ['requestModeUpgrade', 'respondBoundaryChoice', 'approveTask', 'requestTaskApproval', 'fullAccessRevoke']) {
      expect(MODEL_ACTION_NAMES as readonly string[]).not.toContain(forbidden);
    }
  });

  it('does not forward a model-supplied userApproval to any action', async () => {
    const spy = invoke();
    const tool = createAgentBrowserTool({ invoke: spy as never });
    await tool!.execute('t1', {
      action: 'open',
      url: 'https://example.com',
      userApproval: true,
      allowExternalBrowser: true,
    });
    const call = spy.mock.calls[0];
    expect(call[0]).toBe('open');
    expect(call[1]).not.toHaveProperty('userApproval');
  });

  it('builds snapshots, page text, keyboard and verify payloads', async () => {
    const spy = invoke();
    const tool = createAgentBrowserTool({ invoke: spy as never });
    await tool!.execute('t1', { action: 'takeSnapshot', sessionId: 's1' });
    await tool!.execute('t2', { action: 'extractPageText', sessionId: 's1', rules: [{ id: 'r1' }], maxLength: 500 });
    await tool!.execute('t3', { action: 'pressKey', sessionId: 's1', key: 'Enter' });
    await tool!.execute('t4', {
      action: 'verifyFlow',
      sessionId: 's1',
      expect: [{ type: 'text', selector: '#result', equals: 'Saved' }],
      verifyScreenshot: false,
    });
    const payloads = spy.mock.calls.map((call) => call[1] as Record<string, unknown>);
    expect(payloads[0]).toEqual({ sessionId: 's1' });
    expect(payloads[1]).toMatchObject({ sessionId: 's1', rules: [{ id: 'r1' }], maxLength: 500 });
    expect(payloads[2]).toEqual({ sessionId: 's1', key: 'Enter' });
    expect(payloads[3]).toMatchObject({ sessionId: 's1', screenshot: false });
    expect(payloads[3]).toHaveProperty('expect');
  });

  it('reports the new actions as available for the real Electron driver', () => {
    const snapshot = getAgentBrowserCapabilities();
    const byAction = new Map(snapshot.actions.map((entry) => [entry.action, entry]));
    for (const action of ['takeSnapshot', 'extractPageText', 'pressKey', 'verifyFlow'] as const) {
      expect(byAction.get(action)!.available, action).toBe(true);
    }
  });
});
