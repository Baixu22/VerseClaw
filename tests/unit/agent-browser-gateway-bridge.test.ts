import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerAgentBrowserGatewayBridge } from '@electron/gateway/agent-browser-bridge';
import { agentBrowserHandlers } from '../../openclaw_runtime/src/gateway/server-methods/agent-browser';

describe('agent browser gateway bridge', () => {
  it('resolves a gateway invoke request when Electron reports a result', async () => {
    const responses: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
    let broadcastPayload: Record<string, unknown> | undefined;
    const respond = vi.fn((ok: boolean, payload?: unknown, error?: unknown) => {
      responses.push({ ok, payload, error });
    });
    const context = {
      broadcast: vi.fn((event: string, payload: unknown) => {
        expect(event).toBe('agentBrowser.invoke.request');
        broadcastPayload = payload as Record<string, unknown>;
        queueMicrotask(() => {
          void agentBrowserHandlers['agentBrowser.invoke.result']({
            params: {
              requestId: broadcastPayload!.requestId,
              ok: true,
              payload: { success: true, sessions: [] },
            },
            respond: vi.fn(),
          } as never);
        });
      }),
    };

    await agentBrowserHandlers['agentBrowser.invoke']({
      params: { action: 'status', payload: {} },
      respond,
      context,
    } as never);

    expect(context.broadcast).toHaveBeenCalledWith(
      'agentBrowser.invoke.request',
      expect.objectContaining({ action: 'status', payload: {} }),
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
