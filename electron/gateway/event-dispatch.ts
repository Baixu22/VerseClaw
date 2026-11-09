import { GatewayEventType, type JsonRpcNotification } from './protocol';
import { logger } from '../utils/logger';
import { normalizeGatewayChatRuntimeEvent, normalizeGatewayChatTerminalEvent } from './chat-runtime-events';
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

/**
 * Bounded prompt-cache break frame projected from the runtime `agent` stream.
 * Only finite counters and closed change codes cross this boundary; the raw
 * diagnostic frame never becomes a chat or generic notification event.
 */
export type PromptCacheBreakEvent = {
  runId: string;
  sessionKey?: string;
  eventId: string;
  previousCacheRead: number;
  cacheRead: number;
  changes: string[];
};

const PROMPT_CACHE_CHANGE_CODES = new Set<string>([
  'cacheRetention',
  'model',
  'streamStrategy',
  'systemPrompt',
  'tools',
  'transport',
]);

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Projects a raw `stream: "prompt_cache"` agent frame, or null if malformed. */
export function normalizePromptCacheBreak(payload: unknown): PromptCacheBreakEvent | null {
  const frame = asRecord(payload);
  const data = asRecord(frame.data);
  if (data.phase !== 'break') return null;
  const runId = readString(frame.runId);
  const eventId = readString(data.eventId);
  const previousCacheRead = readFiniteNumber(data.previousCacheRead);
  const cacheRead = readFiniteNumber(data.cacheRead);
  if (!runId || !eventId || previousCacheRead === undefined || cacheRead === undefined) {
    return null;
  }
  const rawChanges = Array.isArray(data.changes) ? data.changes : [];
  const changes = rawChanges.filter(
    (code): code is string => typeof code === 'string' && PROMPT_CACHE_CHANGE_CODES.has(code),
  );
  return {
    runId,
    sessionKey: readOptionalString(frame.sessionKey) ?? undefined,
    eventId,
    previousCacheRead,
    cacheRead,
    changes,
  };
}

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
      {
        const terminal=normalizeGatewayChatTerminalEvent(payload);
        if(terminal)emitter.emit('chat:runtime-event',terminal);
      }
      break;
    case 'agent': {
      // Prompt-cache diagnostics are consumed in Main as a dedicated, typed
      // observation. They must not fall through to chat text or the generic
      // renderer notification channel.
      const frame = asRecord(payload);
      if (frame.stream === 'prompt_cache') {
        const observation = normalizePromptCacheBreak(payload);
        if (observation) {
          emitter.emit('prompt-cache:break', observation);
        }
        break;
      }
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
  if (notification.method === 'agent' && asRecord(notification.params).stream === 'prompt_cache') {
    const observation = normalizePromptCacheBreak(notification.params);
    if (observation) {
      emitter.emit('prompt-cache:break', observation);
    }
    return;
  }
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
