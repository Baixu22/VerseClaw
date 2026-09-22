import { GatewayEventType, type JsonRpcNotification } from './protocol';
import { logger } from '../utils/logger';
import { normalizeGatewayChatRuntimeEvent } from './chat-runtime-events';
import type {
  GatewayChannelStatusEvent,
  GatewayChatMessageEvent,
  GatewayRuntimePayload,
  RuntimeApprovalRequestedEvent,
  RuntimeApprovalResolvedEvent,
} from '@shared/host-events/contract';

type GatewayEventEmitter = {
  emit: (event: string, payload: unknown) => boolean;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readDecisionList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * ClawX receives `exec.approval.requested` because it connects as operator.admin
 * (the broadcast guard in openclaw_runtime/src/gateway/server-broadcast.ts lets
 * admin through every event). Project the raw runtime payload into the shape the
 * approval modal renders, and drop frames that carry no approval id: an
 * unanswerable request must not open a dialog.
 */
export function normalizeRuntimeApprovalRequested(payload: unknown): RuntimeApprovalRequestedEvent | null {
  const frame = asRecord(payload);
  const approvalId = readString(frame.id);
  if (!approvalId) return null;
  const request = asRecord(frame.request);
  return {
    approvalId,
    command: readString(request.command) || readString(request.commandPreview),
    commandPreview: readOptionalString(request.commandPreview),
    cwd: readOptionalString(request.cwd),
    host: readOptionalString(request.host),
    agentId: readOptionalString(request.agentId),
    sessionKey: readOptionalString(request.sessionKey),
    allowedDecisions: readDecisionList(request.allowedDecisions),
    createdAtMs: readNumber(frame.createdAtMs),
    expiresAtMs: readNumber(frame.expiresAtMs),
  };
}

export function normalizeRuntimeApprovalResolved(payload: unknown): RuntimeApprovalResolvedEvent | null {
  const frame = asRecord(payload);
  const approvalId = readString(frame.id);
  if (!approvalId) return null;
  return {
    approvalId,
    decision: readString(frame.decision),
    resolvedBy: readOptionalString(frame.resolvedBy),
    ts: readNumber(frame.ts),
  };
}

export function dispatchProtocolEvent(
  emitter: GatewayEventEmitter,
  event: string,
  payload: unknown,
): void {
  switch (event) {
    case 'tick':
      break;
    case 'chat':
      emitter.emit('chat:message', { message: payload });
      break;
    case 'agent': {
      const normalized = normalizeGatewayChatRuntimeEvent(payload);
      if (normalized) {
        emitter.emit('chat:runtime-event', normalized);
      }
      emitter.emit('notification', { method: event, params: payload });
      break;
    }
    case 'channel.status':
    case 'channel.status_changed':
      emitter.emit('channel:status', payload as GatewayChannelStatusEvent);
      break;
    case 'gateway.ready':
    case 'ready':
      emitter.emit('gateway:ready', payload);
      break;
    case 'health':
      emitter.emit('gateway:health', payload as GatewayRuntimePayload);
      break;
    case 'presence':
      emitter.emit('gateway:presence', payload as GatewayRuntimePayload);
      break;
    case 'subagent-lifecycle':
      emitter.emit('subagent:lifecycle', payload);
      break;
    case 'clawgraph-lifecycle':
      emitter.emit('clawgraph:lifecycle', payload);
      break;
    case 'task-loop-lifecycle':
      emitter.emit('task-loop:lifecycle', payload);
      break;
    case 'mission-lifecycle':
      emitter.emit('mission:lifecycle', payload);
      break;
    case 'chat.queue-status':
      emitter.emit('chat:queue-status', payload);
      break;
    // Runtime exec-approval boundary: the only events that let a person answer a
    // command the exec policy gated. Frames without an approval id are dropped.
    case 'exec.approval.requested': {
      const requested = normalizeRuntimeApprovalRequested(payload);
      if (requested) emitter.emit('approval:requested', requested);
      break;
    }
    case 'exec.approval.resolved': {
      const resolved = normalizeRuntimeApprovalResolved(payload);
      if (resolved) emitter.emit('approval:resolved', resolved);
      break;
    }
    default:
      emitter.emit('notification', { method: event, params: payload });
  }
}

export function dispatchJsonRpcNotification(
  emitter: GatewayEventEmitter,
  notification: JsonRpcNotification,
): void {
  emitter.emit('notification', notification);
  if (notification.method === 'agent') {
    const normalized = normalizeGatewayChatRuntimeEvent(notification.params);
    if (normalized) {
      emitter.emit('chat:runtime-event', normalized);
    }
  }
  switch (notification.method) {
    case GatewayEventType.CHANNEL_STATUS_CHANGED:
      emitter.emit('channel:status', notification.params as GatewayChannelStatusEvent);
      break;
    case GatewayEventType.MESSAGE_RECEIVED:
      emitter.emit('chat:message', notification.params as GatewayChatMessageEvent);
      break;
    case GatewayEventType.ERROR: {
      const errorData = notification.params as { message?: string };
      emitter.emit('error', new Error(errorData.message || 'Gateway error'));
      break;
    }
    default:
      logger.debug(`Unknown Gateway notification: ${notification.method}`);
  }
}
