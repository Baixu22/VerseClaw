import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerAgentBrowserGatewayBridge } from '../src/gateway/bridge';
import { agentBrowserHandlers } from '../src/openclaw/gateway/agent-browser';
import { setSandboxHighRiskPolicyLoader } from '../src/host/sandbox-high-risk-gate';

describe('agent browser gateway bridge', () => {
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
        payload: { url: 'https://example.com', profile: 'work' },
      },
    });
    await vi.waitFor(() => {
      expect(gatewayManager.rpc).toHaveBeenCalledWith(
        'agentBrowser.invoke.result',
        {
          requestId: 'req-1',
          ok: true,
          payload: {
            success: true,
            session: { id: 's1', profile: 'work' },
            textSample: 'hello',
          },
        },
        30_000,
      );
    });
    dispose();
  });

  /**
   * P2-004: this bridge is a product entry point into AgentBrowserService. The gateway routes to it
   * by a trusted-client allow-list (isAgentBrowserBridgeClient), not by a per-action approval flow,
   * so a degraded sandbox must fail closed here exactly like the host API in src/engine/api.ts.
   */
  it('refuses high-risk actions under a degraded sandbox instead of forwarding them', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: true, degradeReason: 'test-degraded-sandbox' }));
    const gatewayManager = new EventEmitter() as EventEmitter & { rpc: ReturnType<typeof vi.fn> };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      click: vi.fn(async () => ({ id: 's1' })),
      list: vi.fn(() => []),
    };

    const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never);
    try {
      gatewayManager.emit('notification', {
        method: 'agentBrowser.invoke.request',
        params: { requestId: 'req-degraded', action: 'click', payload: { sessionId: 's1', selector: '#go' } },
      });
      await vi.waitFor(() => {
        expect(gatewayManager.rpc).toHaveBeenCalledWith(
          'agentBrowser.invoke.result',
          expect.objectContaining({
            requestId: 'req-degraded',
            ok: false,
            error: expect.objectContaining({ message: expect.stringContaining('Sandbox degraded') }),
          }),
          30_000,
        );
      });
      expect(service.click, 'a denied action must never reach the browser service').not.toHaveBeenCalled();

      // Reads stay ungated: classifyAgentBrowserAction('status') is not a high-risk class.
      gatewayManager.emit('notification', {
        method: 'agentBrowser.invoke.request',
        params: { requestId: 'req-read', action: 'status', payload: {} },
      });
      await vi.waitFor(() => {
        expect(gatewayManager.rpc).toHaveBeenCalledWith(
          'agentBrowser.invoke.result',
          expect.objectContaining({ requestId: 'req-read', ok: true, payload: { success: true, sessions: [] } }),
          30_000,
        );
      });
    } finally {
      dispose();
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('passes advanced CLI command requests to Electron Main', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & {
      rpc: ReturnType<typeof vi.fn>;
    };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      command: vi.fn(async () => ({
        session: { id: 's1' },
        data: { requests: [] },
        stdout: '{"success":true,"data":{"requests":[]}}',
        stderr: '',
        command: ['--json', 'network', 'requests'],
      })),
    };

    const dispose = registerAgentBrowserGatewayBridge(gatewayManager as never, service as never);
    gatewayManager.emit('notification', {
      method: 'agentBrowser.invoke.request',
      params: {
        requestId: 'req-2',
        action: 'command',
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
