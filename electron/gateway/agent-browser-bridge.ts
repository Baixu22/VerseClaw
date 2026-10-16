import type { JsonRpcNotification } from './protocol';
import type { GatewayManager } from './manager';
import { logger } from '../utils/logger';
import {
  assertBrowserAllowedUnderSandbox,
  ensureAgentBrowserControlForOwnedSession,
  getAgentBrowserCapabilities,
  getDefaultAgentBrowserService,
} from '../services/agent-browser-api';
import type { AgentBrowserService } from '@verse-claw/versebrowser';
import type { ModelActionCapabilitySnapshot } from '../services/agent-browser-capabilities';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

type AgentBrowserCorrelation = {
  gatewayRequestId?: string;
  runId?: string;
  sessionKey?: string;
  agentSessionKey?: string;
  agentSessionId?: string;
  toolCallId?: string;
  taskId?: string;
  pageId?: string;
  workspaceId?: string;
  agentId?: string;
};

type AgentBrowserBridgeRequest = {
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
  correlation?: AgentBrowserCorrelation;
};

type ErrorWithDetails = Error & {
  code?: unknown;
  name?: unknown;
  details?: unknown;
};

const CORRELATION_KEYS = [
  'gatewayRequestId',
  'runId',
  'sessionKey',
  'agentSessionKey',
  'agentSessionId',
  'toolCallId',
  'taskId',
  'pageId',
  'workspaceId',
  'agentId',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readCorrelation(value: unknown): AgentBrowserCorrelation | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const correlation: AgentBrowserCorrelation = {};
  for (const key of CORRELATION_KEYS) {
    const entry = readString(record[key]);
    if (entry) correlation[key] = entry;
  }
  return Object.keys(correlation).length > 0 ? correlation : undefined;
}

function normalizeRequest(value: unknown): AgentBrowserBridgeRequest | null {
  const record = asRecord(value);
  const payload = asRecord(record?.payload) ?? {};
  const requestId = readString(record?.requestId);
  const action = readString(record?.action);
  if (!requestId || !action) return null;
  const correlation = readCorrelation(record?.correlation);
  return { requestId, action, payload, ...(correlation ? { correlation } : {}) };
}

function ownerSessionKey(request: AgentBrowserBridgeRequest): string | undefined {
  return request.correlation?.sessionKey ?? request.correlation?.agentSessionKey;
}

function sessionIdForRequest(action: string, payload: Record<string, unknown>): string | undefined {
  if (action === 'open' || action === 'status') return undefined;
  return readString(payload.sessionId);
}

function preparePayloadForOwner(request: AgentBrowserBridgeRequest): Record<string, unknown> {
  if (request.action !== 'open') return request.payload;
  const ownerKey = ownerSessionKey(request);
  if (!ownerKey) return request.payload;
  return {
    ...request.payload,
    ...(request.payload.sessionKey === undefined ? { sessionKey: ownerKey } : {}),
    ...(request.payload.agentId === undefined && request.correlation?.agentId
      ? { agentId: request.correlation.agentId }
      : {}),
  };
}

function listSessions(service: AgentBrowserService): unknown[] {
  if (typeof service.list !== 'function') return [];
  try {
    const sessions = service.list();
    return Array.isArray(sessions) ? sessions : [];
  } catch {
    return [];
  }
}

function ownershipError(code: string, message: string): ErrorWithDetails {
  const error = new Error(message) as ErrorWithDetails;
  error.name = 'AgentBrowserOwnershipError';
  error.code = code;
  return error;
}

function assertRequestOwnership(
  service: AgentBrowserService,
  request: AgentBrowserBridgeRequest,
  payload: Record<string, unknown>,
): void {
  const ownerKey = ownerSessionKey(request);
  const sessionId = sessionIdForRequest(request.action, payload);
  if (!ownerKey || !sessionId) return;
  const session = listSessions(service).find((candidate) => readString(asRecord(candidate)?.id) === sessionId);
  if (!session) {
    throw ownershipError('E_SESSION_NOT_FOUND', `Agent browser session not found: ${sessionId}`);
  }
  const sessionKey = readString(asRecord(session)?.sessionKey);
  if (!sessionKey) {
    throw ownershipError('E_OWNER_MISSING', `Agent browser session ${sessionId} has no owner metadata; refusing runtime access`);
  }
  if (sessionKey !== ownerKey) {
    throw ownershipError('E_OWNER_MISMATCH', `Agent browser session ${sessionId} belongs to a different runtime session`);
  }
}

function sessionKeyFromResult(result: unknown): string | undefined {
  const record = asRecord(result);
  return readString(record?.sessionKey) ?? readString(asRecord(record?.session)?.sessionKey);
}

function attachResultMetadata(
  result: unknown,
  request: AgentBrowserBridgeRequest,
  sessionKey?: string,
): unknown {
  const metadata = {
    gatewayRequestId: request.requestId,
    ...(sessionKey ? { sessionKey } : {}),
  };
  const record = asRecord(result);
  return record ? { ...record, ...metadata } : { payload: result, ...metadata };
}

/**
 * Hand-forged calls must be rejected by Main, not merely by the model schema.
 * The snapshot is derived from the live driver profile, so an unavailable action
 * throws before any browser effect is possible (spec N3 / AC-2).
 */
function capabilityError(action: string, reason: string): ErrorWithDetails {
  const error = new Error(
    `Agent browser action "${action}" is not available in this session: ${reason}`,
  ) as ErrorWithDetails;
  error.name = 'AgentBrowserCapabilityError';
  error.code = 'E_CAPABILITY_UNAVAILABLE';
  return error;
}

type CapabilityProvider = () => ModelActionCapabilitySnapshot;

function assertActionAvailable(action: string, capabilities: CapabilityProvider): void {
  const entry = capabilities().actions.find((candidate) => candidate.action === action);
  if (!entry) return; // not part of the model action vocabulary: keep existing behaviour
  if (!entry.available) throw capabilityError(action, entry.reason ?? 'unavailable');
}

/** `status` is the side-effect-free discovery surface: it carries the capability snapshot. */
function withCapabilities(result: unknown, request: AgentBrowserBridgeRequest, capabilities: CapabilityProvider): unknown {
  if (request.action !== 'status') return result;
  const record = asRecord(result);
  if (!record) return result;
  return { ...record, capabilities: capabilities() };
}

function filterStatusResult(result: unknown, request: AgentBrowserBridgeRequest): unknown {
  const ownerKey = ownerSessionKey(request);
  const record = asRecord(result);
  if (!ownerKey || !record || !Array.isArray(record.sessions)) return result;
  return {
    ...record,
    sessions: record.sessions.filter((session) => readString(asRecord(session)?.sessionKey) === ownerKey),
  };
}

async function invokeAgentBrowser(
  service: AgentBrowserService,
  request: AgentBrowserBridgeRequest,
  payload: Record<string, unknown>,
  api?: CompleteHostServiceRegistry['agentBrowser'],
  capabilities: CapabilityProvider = getAgentBrowserCapabilities,
): Promise<unknown> {
  await assertBrowserAllowedUnderSandbox(request.action);
  assertActionAvailable(request.action, capabilities);
  const owner = ownerSessionKey(request);
  if (owner) {
    await ensureAgentBrowserControlForOwnedSession(service, owner, request.action, sessionIdForRequest(request.action, payload));
  }
  if (api) {
    const method = api[request.action as keyof typeof api];
    if (typeof method !== 'function') throw new Error(`Unsupported agent browser action: ${request.action}`);
    return await (method as (payload: Record<string, unknown>) => Promise<unknown>)(payload);
  }
  switch (request.action) {
    case 'open':
      return { success: true, ...(await service.open(payload as never)) };
    case 'status':
      return { success: true, sessions: service.list() };
    case 'navigate':
      return { success: true, session: await service.navigate(payload as never) };
    case 'waitForSelector':
      return { success: true, session: await service.waitForSelector(payload as never) };
    case 'click':
      return { success: true, session: await service.click(payload as never) };
    case 'type':
      return { success: true, session: await service.type(payload as never) };
    case 'evaluate':
      return { success: true, ...(await service.evaluate(payload as never)) };
    case 'screenshot':
      return { success: true, ...(await service.screenshot(payload as never)) };
    case 'command':
      return { success: true, ...(await service.command(payload as never)) };
    case 'getConsoleMessages':
      return { success: true, ...(await service.getConsoleMessages(payload as never)) };
    case 'close':
      service.close(String(payload.sessionId ?? ''));
      return { success: true };
    default:
      throw new Error(`Unsupported agent browser action: ${request.action}`);
  }
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const details = (error as ErrorWithDetails).details;
  const code = (error as ErrorWithDetails).code;
  return {
    message: error.message,
    name: error.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

export function registerAgentBrowserGatewayBridge(
  gatewayManager: GatewayManager,
  service = getDefaultAgentBrowserService(),
  api?: CompleteHostServiceRegistry['agentBrowser'],
  capabilities: CapabilityProvider = getAgentBrowserCapabilities,
): () => void {
  const onNotification = (notification: JsonRpcNotification) => {
    if (notification.method !== 'agentBrowser.invoke.request') {
      return;
    }
    const request = normalizeRequest(notification.params);
    logger.debug('[agent-browser-bridge] Received invoke request: ' + notification.method);
    if (!request) {
      logger.warn('[agent-browser-bridge] Ignoring malformed invoke request');
      return;
    }
    void (async () => {
      try {
        const payload = preparePayloadForOwner(request);
        assertRequestOwnership(service, request, payload);
        logger.debug('[agent-browser-bridge] Dispatching action=' + request.action + ' requestId=' + request.requestId);
        const result = withCapabilities(
          filterStatusResult(
            await invokeAgentBrowser(service, request, payload, api, capabilities),
            request,
          ),
          request,
          capabilities,
        );
        logger.debug('[agent-browser-bridge] Action completed requestId=' + request.requestId);
        const sessionKey = sessionKeyFromResult(result) ?? ownerSessionKey(request);
        await gatewayManager.rpc('agentBrowser.invoke.result', {
          requestId: request.requestId,
          ok: true,
          payload: attachResultMetadata(result, request, sessionKey),
          ...(sessionKey ? { sessionKey } : {}),
          ...(request.correlation ? { correlation: request.correlation } : {}),
        }, 30_000);
      } catch (error) {
        logger.warn('[agent-browser-bridge] Invoke failed:', error);
        const sessionKey = ownerSessionKey(request);
        await gatewayManager.rpc('agentBrowser.invoke.result', {
          requestId: request.requestId,
          ok: false,
          error: errorPayload(error),
          ...(sessionKey ? { sessionKey } : {}),
          ...(request.correlation ? { correlation: request.correlation } : {}),
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
