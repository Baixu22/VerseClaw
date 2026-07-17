import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentBrowserGatewayBridge } from '@electron/gateway/agent-browser-bridge';
import {
  agentBrowserHandlers,
  claimAgentBrowserResult,
  isAgentBrowserBridgeClient,
  __testing,
} from '../../openclaw_runtime/src/gateway/server-methods/agent-browser';
import { authorizeOperatorScopesForMethod } from '../../openclaw_runtime/src/gateway/method-scopes';
import { checkBrowserOrigin } from '../../openclaw_runtime/src/gateway/origin-check';
import { createAuthRateLimiter } from '../../openclaw_runtime/src/gateway/auth-rate-limit';
import { consumeControlPlaneWriteBudget } from '../../openclaw_runtime/src/gateway/control-plane-rate-limit';
import { isRoleAuthorizedForMethod } from '../../openclaw_runtime/src/gateway/role-policy';

function makeBridgeClient(connId: string) {
  return {
    connId,
    connect: {
      role: 'operator',
      scopes: ['operator.admin', 'operator.read'],
      client: {
        id: 'gateway-client',
        version: '0.1.0',
        platform: 'win32',
        mode: 'backend',
      },
    },
  } as never;
}

function makeWebClient(connId: string) {
  return {
    connId,
    connect: {
      role: 'operator',
      scopes: ['operator.read'],
      client: {
        id: 'openclaw-control-ui',
        version: '1.0.0',
        platform: 'web',
        mode: 'webchat',
      },
    },
  } as never;
}

describe('P4-001 gateway method auth / origin / rate-limit matrix', () => {
  it('denies agentBrowser.invoke without write scope', () => {
    const auth = authorizeOperatorScopesForMethod('agentBrowser.invoke', ['operator.read']);
    expect(auth.allowed).toBe(false);
    expect(auth.missingScope).toBeTruthy();
  });

  it('allows agentBrowser.invoke with write or admin scope', () => {
    expect(authorizeOperatorScopesForMethod('agentBrowser.invoke', ['operator.write']).allowed).toBe(true);
    expect(authorizeOperatorScopesForMethod('agentBrowser.invoke', ['operator.admin']).allowed).toBe(true);
  });

  it('requires admin for agentBrowser.invoke.result', () => {
    expect(authorizeOperatorScopesForMethod('agentBrowser.invoke.result', ['operator.write']).allowed).toBe(false);
    expect(authorizeOperatorScopesForMethod('agentBrowser.invoke.result', ['operator.admin']).allowed).toBe(true);
  });

  it('rejects node role for operator methods and operator role for node methods', () => {
    expect(isRoleAuthorizedForMethod('node', 'agentBrowser.invoke')).toBe(false);
    expect(isRoleAuthorizedForMethod('operator', 'agentBrowser.invoke')).toBe(true);
  });

  it('rejects missing or disallowed browser Origin', () => {
    expect(checkBrowserOrigin({ origin: undefined, requestHost: '127.0.0.1:18789' }).ok).toBe(false);
    expect(
      checkBrowserOrigin({
        origin: 'https://evil.example',
        requestHost: '127.0.0.1:18789',
        allowedOrigins: ['http://127.0.0.1:18789'],
        isLocalClient: true,
      }).ok,
    ).toBe(false);
  });

  it('allows local loopback Origin for local clients', () => {
    expect(
      checkBrowserOrigin({
        origin: 'http://127.0.0.1:5173',
        requestHost: '127.0.0.1:18789',
        isLocalClient: true,
      }).ok,
    ).toBe(true);
  });

  it('rate-limits repeated auth failures', () => {
    const limiter = createAuthRateLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      lockoutMs: 60_000,
      exemptLoopback: false,
    });
    expect(limiter.check('203.0.113.10').allowed).toBe(true);
    limiter.recordFailure('203.0.113.10');
    limiter.recordFailure('203.0.113.10');
    limiter.recordFailure('203.0.113.10');
    expect(limiter.check('203.0.113.10').allowed).toBe(false);
  });

  it('rate-limits control-plane write RPC budget', () => {
    const client = {
      connId: 'c-rl-1',
      clientIp: '203.0.113.50',
      connect: { device: { id: 'dev-rl-1' } },
    } as never;
    const results = Array.from({ length: 5 }, () => consumeControlPlaneWriteBudget({ client }));
    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(3);
    expect(denied).toBe(2);
  });
});

describe('P4-001 agent browser first-response binding', () => {
  afterEach(() => {
    __testing.clearPendingInvokes();
  });

  it('classifies backend gateway-client as bridge', () => {
    expect(isAgentBrowserBridgeClient(makeBridgeClient('b1'))).toBe(true);
    expect(isAgentBrowserBridgeClient(makeWebClient('w1'))).toBe(false);
  });

  it('targets bridge connIds instead of global broadcast and binds session', async () => {
    const responses: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
    const respond = vi.fn((ok: boolean, payload?: unknown, error?: unknown) => {
      responses.push({ ok, payload, error });
    });
    let targeted: { event: string; payload: Record<string, unknown>; connIds: Set<string> } | undefined;
    const context = {
      broadcast: vi.fn(),
      broadcastToConnIds: vi.fn((event: string, payload: unknown, connIds: ReadonlySet<string>) => {
        targeted = {
          event,
          payload: payload as Record<string, unknown>,
          connIds: new Set(connIds),
        };
        queueMicrotask(() => {
          void agentBrowserHandlers['agentBrowser.invoke.result']({
            params: {
              requestId: targeted!.payload.requestId,
              ok: true,
              payload: { success: true, session: { id: 'sess-a' } },
              sessionKey: 'sess-a',
            },
            client: makeBridgeClient('bridge-1'),
            respond: vi.fn(),
            context,
            req: {} as never,
            isWebchatConnect: () => false,
          });
        });
      }),
      getApprovalClientConnIds: () => new Set(['bridge-1', 'bridge-2']),
    };

    await agentBrowserHandlers['agentBrowser.invoke']({
      params: { action: 'status', payload: { sessionId: 'sess-a' } },
      respond,
      context,
      client: makeWebClient('origin-1'),
      req: {} as never,
      isWebchatConnect: () => false,
    });

    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.broadcastToConnIds).toHaveBeenCalled();
    expect(targeted?.event).toBe('agentBrowser.invoke.request');
    expect(targeted?.connIds).toEqual(new Set(['bridge-1', 'bridge-2']));
    expect(targeted?.payload.sessionKey).toBe('sess-a');
    expect(targeted?.payload.originConnId).toBe('origin-1');
    expect(responses).toEqual([
      { ok: true, payload: { success: true, session: { id: 'sess-a' } }, error: undefined },
    ]);
  });

  it('fails closed when no bridge is connected', async () => {
    const respond = vi.fn();
    await agentBrowserHandlers['agentBrowser.invoke']({
      params: { action: 'status', payload: {} },
      respond,
      context: {
        broadcast: vi.fn(),
        broadcastToConnIds: vi.fn(),
        getApprovalClientConnIds: () => new Set(),
      },
      client: makeWebClient('origin-2'),
      req: {} as never,
      isWebchatConnect: () => false,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining('no agent browser bridge') }),
    );
  });

  it('rejects wrong-source, late, and duplicate multi-window race results', () => {
    const resolve = vi.fn();
    const reject = vi.fn();
    const timer = setTimeout(() => {}, 60_000);
    __testing.pendingInvokes.set('req-race', {
      resolve,
      reject,
      timer,
      allowedConnIds: new Set(['bridge-a', 'bridge-b']),
      sessionKey: 'sess-1',
      createdAtMs: Date.now(),
    });

    expect(
      claimAgentBrowserResult({ requestId: 'req-race', responderConnId: 'evil-window' }).ok,
    ).toBe(false);
    expect(
      claimAgentBrowserResult({
        requestId: 'req-race',
        responderConnId: 'bridge-a',
        sessionKey: 'wrong-session',
      }).ok,
    ).toBe(false);

    const first = claimAgentBrowserResult({
      requestId: 'req-race',
      responderConnId: 'bridge-a',
      sessionKey: 'sess-1',
    });
    expect(first.ok).toBe(true);

    const second = claimAgentBrowserResult({
      requestId: 'req-race',
      responderConnId: 'bridge-b',
      sessionKey: 'sess-1',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('duplicate');
    }
    clearTimeout(timer);
  });

  it('ignores result RPC from unauthorized client while first valid bridge wins', async () => {
    const respondInvoke = vi.fn();
    let requestId = '';
    const context = {
      broadcast: vi.fn(),
      broadcastToConnIds: vi.fn((_e: string, payload: unknown) => {
        requestId = (payload as { requestId: string }).requestId;
      }),
      getApprovalClientConnIds: () => new Set(['bridge-a', 'bridge-b']),
    };

    const invokePromise = agentBrowserHandlers['agentBrowser.invoke']({
      params: { action: 'status', payload: { sessionId: 's1' } },
      respond: respondInvoke,
      context,
      client: makeWebClient('origin'),
      req: {} as never,
      isWebchatConnect: () => false,
    });

    // Wrong source
    const evilRespond = vi.fn();
    await agentBrowserHandlers['agentBrowser.invoke.result']({
      params: { requestId, ok: true, payload: { winner: 'evil' } },
      respond: evilRespond,
      client: makeWebClient('evil'),
      context,
      req: {} as never,
      isWebchatConnect: () => false,
    });
    expect(evilRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ignored: true, reason: 'wrong_source' }),
      undefined,
    );

    // Valid bridge A wins
    const aRespond = vi.fn();
    await agentBrowserHandlers['agentBrowser.invoke.result']({
      params: { requestId, ok: true, payload: { winner: 'a' }, sessionKey: 's1' },
      respond: aRespond,
      client: makeBridgeClient('bridge-a'),
      context,
      req: {} as never,
      isWebchatConnect: () => false,
    });
    expect(aRespond).toHaveBeenCalledWith(true, { ok: true, ignored: false }, undefined);

    // Late bridge B rejected
    const bRespond = vi.fn();
    await agentBrowserHandlers['agentBrowser.invoke.result']({
      params: { requestId, ok: true, payload: { winner: 'b' }, sessionKey: 's1' },
      respond: bRespond,
      client: makeBridgeClient('bridge-b'),
      context,
      req: {} as never,
      isWebchatConnect: () => false,
    });
    expect(bRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ignored: true }),
      undefined,
    );

    await invokePromise;
    expect(respondInvoke).toHaveBeenCalledWith(true, { winner: 'a' }, undefined);
  });

  it('still executes Electron Main service bridge path', async () => {
    const gatewayManager = new EventEmitter() as EventEmitter & {
      rpc: ReturnType<typeof vi.fn>;
    };
    gatewayManager.rpc = vi.fn(async () => ({ ok: true }));
    const service = {
      open: vi.fn(async () => ({
        session: { id: 's1', profile: 'work' },
        textSample: 'hello',
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
        expect.objectContaining({ requestId: 'req-1', ok: true }),
        30_000,
      );
    });
    dispose();
  });
});
