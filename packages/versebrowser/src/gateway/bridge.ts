import type { JsonRpcNotification } from './protocol.ts';
import type { GatewayManager } from './manager.ts';
import { logger } from '../host/logger.ts';
import { assertBrowserAllowedUnderSandbox, getDefaultAgentBrowserService } from '../engine/api.ts';
import type { AgentBrowserService } from '../engine/service.ts';

type AgentBrowserBridgeRequest = {
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeRequest(value: unknown): AgentBrowserBridgeRequest | null {
  const record = asRecord(value);
  const payload = asRecord(record?.payload) ?? {};
  const requestId = typeof record?.requestId === 'string' ? record.requestId.trim() : '';
  const action = typeof record?.action === 'string' ? record.action.trim() : '';
  if (!requestId || !action) return null;
  return { requestId, action, payload };
}

async function invokeAgentBrowser(
  service: AgentBrowserService,
  request: AgentBrowserBridgeRequest,
): Promise<unknown> {
  // P2-004 / F-ISO-001: the same fail-closed sandbox gate the host API applies. This bridge is
  // another product entry point into AgentBrowserService, and the gateway routes to it by a
  // trusted-client allow-list (isAgentBrowserBridgeClient), not by a per-action approval flow -
  // so a degraded sandbox must deny here too instead of forwarding open/click/evaluate/command
  // straight to the browser.
  await assertBrowserAllowedUnderSandbox(request.action);
  switch (request.action) {
    case 'open':
      return { success: true, ...(await service.open(request.payload)) };
    case 'status':
      return { success: true, sessions: service.list() };
    case 'navigate':
      return { success: true, session: await service.navigate(request.payload as never) };
    case 'waitForSelector':
      return { success: true, session: await service.waitForSelector(request.payload as never) };
    case 'click':
      return { success: true, session: await service.click(request.payload as never) };
    case 'type':
      return { success: true, session: await service.type(request.payload as never) };
    case 'evaluate':
      return { success: true, ...(await service.evaluate(request.payload as never)) };
    case 'screenshot':
      return { success: true, ...(await service.screenshot(request.payload as never)) };
    case 'command':
      return { success: true, ...(await service.command(request.payload as never)) };
    case 'getConsoleMessages':
      return { success: true, ...(await service.getConsoleMessages(request.payload as never)) };
    case 'close':
      await service.close(String(request.payload.sessionId ?? ''));
      return { success: true };
    default:
      throw new Error(`Unsupported agent browser action: ${request.action}`);
  }
}

function errorPayload(error: unknown): { message: string } {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

export function registerAgentBrowserGatewayBridge(
  gatewayManager: GatewayManager,
  service = getDefaultAgentBrowserService(),
): () => void {
  const onNotification = (notification: JsonRpcNotification) => {
    if (notification.method !== 'agentBrowser.invoke.request') {
      return;
    }
    const request = normalizeRequest(notification.params);
    if (!request) {
      logger.warn('[agent-browser-bridge] Ignoring malformed invoke request');
      return;
    }
    void (async () => {
      try {
        const payload = await invokeAgentBrowser(service, request);
        await gatewayManager.rpc('agentBrowser.invoke.result', {
          requestId: request.requestId,
          ok: true,
          payload,
        }, 30_000);
      } catch (error) {
        logger.warn('[agent-browser-bridge] Invoke failed:', error);
        await gatewayManager.rpc('agentBrowser.invoke.result', {
          requestId: request.requestId,
          ok: false,
          error: errorPayload(error),
        }, 30_000).catch((rpcError) => {
          logger.warn('[agent-browser-bridge] Failed to report invoke error:', rpcError);
        });
      }
    })();
  };

  gatewayManager.on('notification', onNotification);
  return () => {
    gatewayManager.off('notification', onNotification);
  };
}
