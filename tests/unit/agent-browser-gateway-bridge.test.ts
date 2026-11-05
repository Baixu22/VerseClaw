import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAgentBrowserGatewayBridge } from '@electron/gateway/agent-browser-bridge';
import { MODEL_ACTION_NAMES } from '@electron/services/agent-browser-capabilities';

/** Capability provider for tests that exercise the available-action path. */
const allActionsAvailable = () => ({
  version: 'test-all-available',
  driverKind: 'host-api' as const,
  cliAvailable: true,
  supervision: 'required' as const,
  unsupervisedActions: ['status', 'getConsoleMessages', 'extractPageText', 'readForms'] as const,
  actions: MODEL_ACTION_NAMES.map((action) => ({
    action,
    available: true,
    supervised: !['status', 'getConsoleMessages', 'extractPageText', 'readForms'].includes(action),
  })),
});
import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';
import { agentBrowserHandlers } from '../../openclaw_runtime/src/gateway/server-methods/agent-browser';
import { createGatewayBroadcaster } from '../../openclaw_runtime/src/gateway/server-broadcast';

describe('agent browser gateway bridge', () => {
  beforeEach(() => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
  });

  afterEach(() => {
    setSandboxHighRiskPolicyLoader(null);
  });

  it('resolves a gateway invoke request when Electron reports a result', async () => {
    const responses: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
    let broadcastPayload: Record<string, unknown> | undefined;
    const respond = vi.fn((ok: boolean, payload?: unknown, error?: unknown) => {
      responses.push({ ok, payload, error });
    });
    const context = {
      broadcast: vi.fn(),
      broadcastToConnIds: vi.fn((event: string, payload: unknown, connIds: ReadonlySet<string>) => {
        expect(event).toBe('agentBrowser.invoke.request');
        expect(connIds).toEqual(new Set(['bridge-1']));
        broadcastPayload = payload as Record<string, unknown>;
        queueMicrotask(() => {
          void agentBrowserHandlers['agentBrowser.invoke.result']({
            params: {
              requestId: broadcastPayload!.requestId,
              ok: true,
              payload: { success: true, sessions: [] },
            },
            client: {
              connId: 'bridge-1',
              connect: {
                role: 'operator',
                scopes: ['operator.admin'],
                caps: ['agent-browser-bridge'],
                client: { id: 'gateway-client', mode: 'backend', version: '0.1.0', platform: 'test' },
              },
            },
            respond: vi.fn(),
            context,
            req: {} as never,
            isWebchatConnect: () => false,
          } as never);
        });
      }),
      getApprovalClientConnIds: () => new Set(['bridge-1']),
    };

    await agentBrowserHandlers['agentBrowser.invoke']({
      params: { action: 'status', payload: {} },
      respond,
      context,
      client: {
        connId: 'origin',
        connect: {
          role: 'operator',
          scopes: ['operator.write'],
          client: { id: 'cli', mode: 'cli', version: '1', platform: 'test' },
        },
      },
      req: {} as never,
      isWebchatConnect: () => false,
    } as never);

    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.broadcastToConnIds).toHaveBeenCalledWith(
      'agentBrowser.invoke.request',
      expect.objectContaining({ action: 'status', payload: {} }),
      new Set(['bridge-1']),
      { dropIfSlow: false },
    );
    expect(responses).toEqual([
      { ok: true, payload: { success: true, sessions: [] }, error: undefined },
    ]);
  });

  it('binds the returned gateway request and owner key to the real bridge response', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & { rpc: ReturnType<typeof vi.fn> };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      list: vi.fn(() => []),
      open: vi.fn(async (payload: Record<string, unknown>) => ({
        session: { id: 's1', profile: 'work', sessionKey: payload.sessionKey },
        textSample: 'hello',
      })),
    };
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never);
      gatewayManager.emit('notification', {
        method: 'agentBrowser.invoke.request',
        params: {
          requestId: 'req-owner',
          action: 'open',
          payload: { url: 'https://example.com', profile: 'work' },
          correlation: { sessionKey: 'agent:main:s1', agentId: 'main', taskId: 'task-1' },
        },
      });
      await vi.waitFor(() => {
        expect(service.open).toHaveBeenCalledWith(expect.objectContaining({
          sessionKey: 'agent:main:s1',
          agentId: 'main',
        }));
        expect(gatewayManager.rpc).toHaveBeenCalledWith('agentBrowser.invoke.result', expect.objectContaining({
          requestId: 'req-owner',
          ok: true,
          sessionKey: 'agent:main:s1',
          payload: expect.objectContaining({
            gatewayRequestId: 'req-owner',
            sessionKey: 'agent:main:s1',
          }),
        }), 30_000);
      });
      dispose();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('rejects a session owned by another runtime session before touching the module', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & { rpc: ReturnType<typeof vi.fn> };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      list: vi.fn(() => [{ id: 's1', sessionKey: 'agent:main:other' }]),
    };
    const api = { navigate: vi.fn(async () => ({ success: true })) };
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never, api as never, allActionsAvailable);
      gatewayManager.emit('notification', {
        method: 'agentBrowser.invoke.request',
        params: {
          requestId: 'req-mismatch',
          action: 'navigate',
          payload: { sessionId: 's1', url: 'https://example.com' },
          correlation: { sessionKey: 'agent:main:owner' },
        },
      });
      await vi.waitFor(() => {
        expect(api.navigate).not.toHaveBeenCalled();
        expect(gatewayManager.rpc).toHaveBeenCalledWith('agentBrowser.invoke.result', expect.objectContaining({
          requestId: 'req-mismatch',
          ok: false,
          error: expect.objectContaining({ code: 'E_OWNER_MISMATCH' }),
        }), 30_000);
      });
      dispose();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('executes Electron Main service calls and reports the bridge result', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & {
      rpc: ReturnType<typeof vi.fn>;
    };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      open: vi.fn(async () => ({
        session: { id: 's1', profile: 'work' },
        textSample: 'hello',
      })),
      command: vi.fn(async () => ({
        session: { id: 's1', profile: 'work' },
        data: { logs: [] },
        stdout: '{"success":true,"data":{"logs":[]}}',
        stderr: '',
        command: ['--json', 'console'],
      })),
    };

    const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never);
    gatewayManager.emit('notification', {
      method: 'agentBrowser.invoke.request',
      params: {
        requestId: 'req-1',
        action: 'open',
        correlation: { sessionKey: 'owner' },
        payload: { url: 'https://example.com', profile: 'work' },
      },
    });
    await vi.waitFor(() => {
      expect(gatewayManager.rpc).toHaveBeenCalledWith(
        'agentBrowser.invoke.result',
        expect.objectContaining({
          requestId: 'req-1',
          ok: true,
          payload: expect.objectContaining({
            gatewayRequestId: 'req-1',
            success: true,
            session: { id: 's1', profile: 'work' },
            textSample: 'hello',
          }),
        }),
        30_000,
      );
    });
    dispose();
  });

  it('delivers agent-browser requests only when the bridge event scope is allowed', () => {
    const sent: string[] = [];
    const client = {
      connId: 'bridge-scope',
      connect: {
        role: 'operator',
        scopes: ['operator.admin'],
        caps: ['agent-browser-bridge'],
      },
      socket: {
        bufferedAmount: 0,
        send: (frame: string) => sent.push(frame),
      },
    };
    const broadcaster = createGatewayBroadcaster({ clients: new Set([client]) as never });
    broadcaster.broadcastToConnIds(
      'agentBrowser.invoke.request',
      { requestId: 'req-scope', action: 'open' },
      new Set(['bridge-scope']),
      { dropIfSlow: false },
    );
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({
      type: 'event',
      event: 'agentBrowser.invoke.request',
      payload: { requestId: 'req-scope', action: 'open' },
    });
  });

  it('routes new facade actions through the complete host API when available', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & { rpc: ReturnType<typeof vi.fn> };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = { list: () => [{ id: 's1', sessionKey: 'owner' }] };
    const api = {
      downloadFile: vi.fn(async (payload: unknown) => ({ success: true, data: payload })),
    };
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never, api as never, allActionsAvailable);
      gatewayManager.emit('notification', {
        method: 'agentBrowser.invoke.request',
        params: { requestId: 'req-download', action: 'downloadFile', payload: { sessionId: 's1', selector: '#f', path: 'D:/tmp/f.bin' }, correlation: { sessionKey: 'owner' } },
      });
      await vi.waitFor(() => {
        expect(api.downloadFile).toHaveBeenCalledWith({ sessionId: 's1', selector: '#f', path: 'D:/tmp/f.bin' });
        expect(gatewayManager.rpc).toHaveBeenCalledWith('agentBrowser.invoke.result', expect.objectContaining({ requestId: 'req-download', ok: true }), 30_000);
      });
      dispose();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('passes advanced CLI command requests to Electron Main', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & {
      rpc: ReturnType<typeof vi.fn>;
    };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      list: () => [{ id: 's1', sessionKey: 'owner' }],
      command: vi.fn(async () => ({
        session: { id: 's1' },
        data: { requests: [] },
        stdout: '{"success":true,"data":{"requests":[]}}',
        stderr: '',
        command: ['--json', 'network', 'requests'],
      })),
    };

    // The bundled CLI is absent in this checkout, so inject the available snapshot the
    // test is simulating (a host that really ships agent-browser).
    const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never, undefined, allActionsAvailable);
    gatewayManager.emit('notification', {
      method: 'agentBrowser.invoke.request',
      params: {
        requestId: 'req-2',
        action: 'command',
        correlation: { sessionKey: 'owner' },
        payload: { sessionId: 's1', args: ['network', 'requests'] },
      },
    });
    await vi.waitFor(() => {
      expect(service.command).toHaveBeenCalledWith({ sessionId: 's1', args: ['network', 'requests'] });
      expect(gatewayManager.rpc).toHaveBeenCalledWith(
        'agentBrowser.invoke.result',
        expect.objectContaining({
          requestId: 'req-2',
          ok: true,
          payload: expect.objectContaining({
            success: true,
            data: { requests: [] },
          }),
        }),
        30_000,
      );
    });
    dispose();
  });
});
