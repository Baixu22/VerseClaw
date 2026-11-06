import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentBrowserTool,
  getPrimedAgentBrowserCapabilities,
  primeAgentBrowserCapabilities,
  normalizeAvailableActions,
} from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';
import { registerAgentBrowserGatewayBridge } from '@electron/gateway/agent-browser-bridge';
import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';

describe('agent browser capability gating (spec N3)', () => {
  beforeEach(() => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    // An empty host snapshot permits only discovery.
    primeAgentBrowserCapabilities({ version: 'reset', availableActions: [] });
  });

  afterEach(() => {
    setSandboxHighRiskPolicyLoader(null);
    primeAgentBrowserCapabilities({ version: 'reset', availableActions: [] });
  });

  it('advertises only the available actions and rejects the rest before invoking', async () => {
    const invoke = vi.fn(async (action: string) => ({ action }));
    const tool = createAgentBrowserTool({
      invoke: invoke as never,
      availableActions: ['status', 'open', 'navigate'],
      capabilityVersion: 'v-test',
    });
    const schemaText = JSON.stringify(tool!.parameters);
    expect(schemaText).toContain('"open"');
    expect(schemaText).toContain('"navigate"');
    expect(schemaText).not.toContain('downloadFile');
    expect(schemaText).not.toContain('respondDialog');

    await expect(tool!.execute('t1', { action: 'downloadFile' })).rejects.toThrow(/not available/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([{ availableActions: [] }, { availableActions: ['unknown-action'] }])('keeps an empty or unknown snapshot discovery-only: %j', async ({ availableActions }) => {
    const invoke = vi.fn(async () => ({ success: true, sessions: [] }));
    const tool = createAgentBrowserTool({ invoke: invoke as never, availableActions });
    expect(normalizeAvailableActions(availableActions)).toEqual(['status']);
    expect(JSON.stringify(tool!.parameters)).not.toContain('uploadFiles');
    await expect(tool!.execute('t-denied', { action: 'open', url: 'https://example.com' })).rejects.toThrow(/not available/);
    expect(invoke).not.toHaveBeenCalled();
    await tool!.execute('t-discovery', { action: 'status' });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('narrows a later tool from a primed snapshot and preserves canonical order', () => {
    primeAgentBrowserCapabilities({ version: 'v1', availableActions: ['navigate', 'status', 'open'] });
    const tool = createAgentBrowserTool({ invoke: vi.fn() as never });
    const actions = (tool!.parameters as { properties: { action: { anyOf?: Array<{ const?: string }>; enum?: string[] } } })
      .properties.action;
    const names = actions.enum ?? actions.anyOf?.map((entry) => entry.const!) ?? [];
    expect(names).toEqual(['open', 'status', 'navigate']);
  });

  it('rebuilds a schema only when the action list changes, not per tool construction', () => {
    primeAgentBrowserCapabilities({ version: 'v1', availableActions: ['status', 'open'] });
    const first = createAgentBrowserTool({ invoke: vi.fn() as never });
    const second = createAgentBrowserTool({ invoke: vi.fn() as never });
    expect(first!.parameters).toBe(second!.parameters);
    primeAgentBrowserCapabilities({ version: 'v2', availableActions: ['status', 'open', 'navigate'] });
    const third = createAgentBrowserTool({ invoke: vi.fn() as never });
    expect(third!.parameters).not.toBe(first!.parameters);
    // Same list again -> cached object is reused even after a version bump.
    primeAgentBrowserCapabilities({ version: 'v3', availableActions: ['open', 'status'] });
    const fourth = createAgentBrowserTool({ invoke: vi.fn() as never });
    expect(fourth!.parameters).toBe(first!.parameters);
  });

  it('primes the cache from a status result (discovery is side-effect free)', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      sessions: [],
      capabilities: {
        version: 'v9',
        actions: [
          { action: 'status', available: true },
          { action: 'open', available: true },
          { action: 'command', available: false, reason: 'no cli' },
        ],
      },
    }));
    const tool = createAgentBrowserTool({ invoke: invoke as never });
    await tool!.execute('t1', { action: 'status' });
    expect(getPrimedAgentBrowserCapabilities()?.version).toBe('v9');
    expect(getPrimedAgentBrowserCapabilities()?.availableActions).toEqual(['open', 'status']);
  });

  it('grants the browser-control run-state for an OWNED session, never from a model argument', async () => {
    const rpcCalls: Array<unknown[]> = [];
    const handlers = new Map<string, (payload: unknown) => void>();
    const manager = {
      on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); },
      off: () => undefined,
      rpc: async (...args: unknown[]) => { rpcCalls.push(args); },
    };
    const setEnabled = vi.fn();
    const requestModeUpgrade = vi.fn(async () => ({ ok: true }));
    const service = {
      isEnabled: () => false,
      setEnabled,
      list: () => [{ id: 's1', runtimeMode: 'normal_restricted', sessionKey: 'owner-1' }],
      requestModeUpgrade,
      takeSnapshot: vi.fn(async () => ({ success: true, snapshot: 'x' })),
    };
    const dispose = registerAgentBrowserGatewayBridge(manager as never, service as never);
    handlers.get('notification')!({
      method: 'agentBrowser.invoke.request',
      params: {
        requestId: 'r-owned',
        action: 'takeSnapshot',
        payload: { sessionId: 's1' },
        correlation: { sessionKey: 'owner-1' },
      },
    });
    await vi.waitFor(() => {
      expect(rpcCalls.some((call) => call[0] === 'agentBrowser.invoke.result')).toBe(true);
    });
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(requestModeUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1',
      targetMode: 'controlled_enhanced',
      userApproval: true,
    }));
    dispose();
  });

  it('rejects an unavailable action at the Main bridge before any service call', async () => {
    const rpcCalls: Array<unknown[]> = [];
    const handlers = new Map<string, (payload: unknown) => void>();
    const manager = {
      on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); },
      off: () => undefined,
      rpc: async (...args: unknown[]) => { rpcCalls.push(args); },
    };
    const service = new Proxy({}, {
      get: () => () => { throw new Error('bridge must not touch the service for an unavailable action'); },
    });
    const dispose = registerAgentBrowserGatewayBridge(manager as never, service as never);
    handlers.get('notification')!({
      method: 'agentBrowser.invoke.request',
      params: { requestId: 'r1', action: 'downloadFile', payload: {} },
    });
    await vi.waitFor(() => {
      expect(rpcCalls.some((call) => call[0] === 'agentBrowser.invoke.result')).toBe(true);
    });
    const resultCall = rpcCalls.find((call) => call[0] === 'agentBrowser.invoke.result')!;
    const params = resultCall[1] as { ok: boolean; error?: { code?: string; message?: string } };
    expect(params.ok).toBe(false);
    expect(params.error?.code).toBe('E_CAPABILITY_UNAVAILABLE');
    expect(params.error?.message).toMatch(/not available/);
    dispose();
  });
});
