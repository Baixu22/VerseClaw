import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentBrowserGatewayBridge } from '@electron/gateway/agent-browser-bridge';
import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';
import { createAgentBrowserTool } from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';
import { MODEL_ACTION_NAMES } from '@electron/services/agent-browser-capabilities';
import { getAgentBrowserCapabilities } from '@electron/services/agent-browser-api';

function harness(service: Record<string, unknown>) {
  const rpcCalls: unknown[][] = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  const manager = {
    on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); },
    off: () => undefined,
    rpc: async (...args: unknown[]) => { rpcCalls.push(args); },
  };
  const dispose = registerAgentBrowserGatewayBridge(manager as never, service as never);
  const result = () => rpcCalls.find((call) => call[0] === 'agentBrowser.invoke.result');
  return { handlers, rpcCalls, dispose, result };
}

describe('agent browser authorization and side-effect conservation (spec N6)', () => {
  beforeEach(() => { setSandboxHighRiskPolicyLoader(async () => ({ degraded: false })); });
  afterEach(() => { setSandboxHighRiskPolicyLoader(null); });

  it('rejects a session owned by another runtime session and never touches the service', async () => {
    const open = vi.fn();
    const service = {
      list: () => [{ id: 's-owned-by-a', sessionKey: 'owner-A' }],
      open,
      click: vi.fn(),
    };
    const { handlers, result, dispose } = harness(service);
    handlers.get('notification')!({
      method: 'agentBrowser.invoke.request',
      params: {
        requestId: 'r-cross',
        action: 'click',
        payload: { sessionId: 's-owned-by-a', selector: '#x' },
        correlation: { sessionKey: 'owner-B' },
      },
    });
    await vi.waitFor(() => expect(result()).toBeTruthy());
    const params = result()![1] as { ok: boolean; error?: { code?: string } };
    expect(params.ok).toBe(false);
    expect(params.error?.code).toBe('E_OWNER_MISMATCH');
    expect(open).not.toHaveBeenCalled();
    dispose();
  });

  it('rejects a session that carries no owner metadata instead of defaulting to allow', async () => {
    const service = { list: () => [{ id: 's-anon' }], close: vi.fn() };
    const { handlers, result, dispose } = harness(service);
    handlers.get('notification')!({
      method: 'agentBrowser.invoke.request',
      params: { requestId: 'r-anon', action: 'close', payload: { sessionId: 's-anon' }, correlation: { sessionKey: 'owner-A' } },
    });
    await vi.waitFor(() => expect(result()).toBeTruthy());
    const params = result()![1] as { ok: boolean; error?: { code?: string } };
    expect(params.ok).toBe(false);
    expect(params.error?.code).toBe('E_OWNER_MISSING');
    dispose();
  });

  it('rejects an unknown session rather than creating one', async () => {
    const service = { list: () => [] as unknown[] };
    const { handlers, result, dispose } = harness(service);
    handlers.get('notification')!({
      method: 'agentBrowser.invoke.request',
      params: { requestId: 'r-missing', action: 'click', payload: { sessionId: 'nope' }, correlation: { sessionKey: 'owner-A' } },
    });
    await vi.waitFor(() => expect(result()).toBeTruthy());
    const params = result()![1] as { ok: boolean; error?: { code?: string } };
    expect(params.ok).toBe(false);
    expect(params.error?.code).toBe('E_SESSION_NOT_FOUND');
    dispose();
  });

  it('keeps path and dialog capabilities refused so neither can bypass its boundary', () => {
    const snapshot = getAgentBrowserCapabilities();
    const byAction = new Map(snapshot.actions.map((entry) => [entry.action, entry]));
    for (const action of ['downloadFile', 'uploadFiles', 'readDialogs', 'respondDialog'] as const) {
      expect(byAction.get(action)!.available, action).toBe(false);
      expect(byAction.get(action)!.reason, action).toBeTruthy();
      expect(MODEL_ACTION_NAMES as readonly string[]).toContain(action);
    }
  });

  it('does not retry a mutation through another backend after an unknown outcome', async () => {
    const invoke = vi.fn(async (_action: string, _payload?: unknown) => ({ success: false, ok: false, content: 'effect unknown', error: { code: 'E_UNKNOWN_EFFECT', message: 'effect unknown' } }));
    const tool = createAgentBrowserTool({ invoke: invoke as never });
    const result = await tool!.execute('t1', { action: 'evaluate', sessionId: 's1', expression: '1+1' });
    // The requested mutation runs exactly once...
    expect(invoke.mock.calls.filter((call) => call[0] === 'evaluate')).toHaveLength(1);
    // ...and no OTHER mutating action is issued as a silent backend switch. The only extra
    // dispatches allowed are read-only failure diagnostics (never a second mutation).
    const mutating = new Set(['open', 'navigate', 'click', 'type', 'pressKey', 'verifyFlow', 'downloadFile', 'uploadFiles', 'drag', 'pointer']);
    const retries = invoke.mock.calls.map((call) => String(call[0])).filter((action) => mutating.has(action));
    expect(retries).toEqual([]);
    expect(JSON.stringify(result)).toMatch(/effect unknown|E_UNKNOWN_EFFECT/);
  });

  it('surfaces a stale reference as a failure instead of a success', async () => {
    const invoke = vi.fn(async (_action: string, _payload?: unknown) => ({ success: false, ok: false, content: 'stale ref', error: { code: 'E_STALE_REF', message: 'ref no longer valid' } }));
    const tool = createAgentBrowserTool({ invoke: invoke as never });
    const result = await tool!.execute('t1', { action: 'evaluate', sessionId: 's1', expression: 'staleRef()' });
    expect(JSON.stringify(result)).toMatch(/stale ref|E_STALE_REF/);
  });
});
