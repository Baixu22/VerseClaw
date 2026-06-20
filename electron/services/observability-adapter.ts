import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import type {
  ObservabilityRuntimeEvent,
  ObservabilitySpan,
  ObservabilityTokenUsage,
  ObservabilityTrace,
} from '../../shared/types/observability';
import { getObservabilityTrace, upsertObservabilityTrace } from './observability-service';
import { getSessionTokenUsageSummary, type TokenUsageSummary } from '../utils/token-usage';

const MAX_PAYLOAD_CHARS = 2048;

const activeTraces = new Map<string, ObservabilityTrace>();
const activeToolSpans = new Map<string, ObservabilitySpan>();

function emptyTokenUsage(): ObservabilityTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 };
}

function truncatePayload(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text == null) return undefined;
  return text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}…` : text;
}

function eventTimestamp(event: ChatRuntimeEvent): number {
  return event.ts ?? Date.now();
}

function toolSpanKey(runId: string, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

function ensureTrace(event: ChatRuntimeEvent, startedAt: number): ObservabilityTrace {
  const existing = activeTraces.get(event.runId);
  if (existing) return existing;
  const trace: ObservabilityTrace = {
    id: `trace_${event.runId}`,
    name: event.sessionKey ? `${event.sessionKey} · ${event.runId.slice(0, 8)}` : `run ${event.runId.slice(0, 12)}`,
    runId: event.runId,
    sessionKey: event.sessionKey,
    status: 'running',
    startedAt,
    spans: [],
    events: [],
    tokenUsage: emptyTokenUsage(),
    metrics: {},
    tags: ['chat-run'],
  };
  activeTraces.set(event.runId, trace);
  upsertObservabilityTrace(trace);
  return trace;
}

export function applyChatRuntimeEvent(event: ChatRuntimeEvent): ObservabilityRuntimeEvent | null {
  switch (event.type) {
    case 'run.started': {
      const trace = ensureTrace(event, event.startedAt ?? eventTimestamp(event));
      return { type: 'trace.started', trace };
    }
    case 'tool.started': {
      const trace = ensureTrace(event, eventTimestamp(event));
      const startedAt = eventTimestamp(event);
      const span: ObservabilitySpan = {
        id: `span_${event.toolCallId}`,
        traceId: trace.id,
        name: event.name,
        kind: 'tool',
        status: 'running',
        startedAt,
        input: truncatePayload(event.args),
      };
      trace.spans.push(span);
      activeToolSpans.set(toolSpanKey(event.runId, event.toolCallId), span);
      upsertObservabilityTrace(trace);
      return { type: 'trace.updated', trace };
    }
    case 'tool.completed': {
      const trace = ensureTrace(event, eventTimestamp(event));
      const key = toolSpanKey(event.runId, event.toolCallId);
      let span = activeToolSpans.get(key);
      if (!span) {
        span = {
          id: `span_${event.toolCallId}`,
          traceId: trace.id,
          name: event.name,
          kind: 'tool',
          status: 'running',
          startedAt: eventTimestamp(event),
        };
        trace.spans.push(span);
      }
      const endedAt = eventTimestamp(event);
      span.status = event.isError ? 'error' : 'completed';
      span.endedAt = endedAt;
      span.durationMs = Math.max(0, endedAt - span.startedAt);
      span.output = truncatePayload(event.result);
      if (event.isError) {
        span.error = truncatePayload(event.result) ?? 'tool error';
      }
      activeToolSpans.delete(key);
      upsertObservabilityTrace(trace);
      return { type: 'trace.updated', trace };
    }
    case 'run.ended': {
      const trace = ensureTrace(event, eventTimestamp(event));
      const endedAt = event.endedAt ?? eventTimestamp(event);
      trace.status = event.status;
      trace.endedAt = endedAt;
      trace.durationMs = Math.max(0, endedAt - trace.startedAt);
      trace.error = event.error;

      if (event.tokenUsage) {
        const u = event.tokenUsage;
        const totalTokens = u.total ?? ((u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0));
        if (totalTokens > 0) {
          trace.tokenUsage = {
            input: u.input ?? 0,
            output: u.output ?? 0,
            cacheRead: u.cacheRead ?? 0,
            cacheWrite: u.cacheWrite ?? 0,
            totalTokens,
            costUsd: 0,
          };
        }
      }

      for (const span of trace.spans) {
        if (span.status === 'running') {
          span.status = event.status;
          span.endedAt = endedAt;
          span.durationMs = Math.max(0, endedAt - span.startedAt);
          span.error = span.error ?? event.error;
          activeToolSpans.delete(toolSpanKey(event.runId, span.id.replace(/^span_/, '')));
        }
      }
      activeTraces.delete(event.runId);
      upsertObservabilityTrace(trace);
      return { type: 'trace.completed', trace };
    }
    default:
      return null;
  }
}

export function resetObservabilityAdapter(): void {
  activeTraces.clear();
  activeToolSpans.clear();
}

function mapSummaryToTokenUsage(summary: TokenUsageSummary): ObservabilityTokenUsage | null {
  if (summary.usageStatus !== 'available' || summary.totalTokens === 0) return null;
  return {
    input: summary.inputTokens,
    output: summary.outputTokens,
    cacheRead: summary.cacheReadTokens,
    cacheWrite: summary.cacheWriteTokens,
    totalTokens: summary.totalTokens,
    costUsd: summary.estimatedCostUsd ?? 0,
  };
}

export async function enrichTraceTokenUsage(
  event: ChatRuntimeEvent & { type: 'run.ended' },
): Promise<ObservabilityRuntimeEvent | null> {
  const sessionKey = event.sessionKey;
  if (!sessionKey) return null;

  const traceId = `trace_${event.runId}`;
  const trace = getObservabilityTrace(traceId);
  if (!trace) return null;

  if (trace.tokenUsage.totalTokens > 0 && trace.tokenUsage.costUsd > 0) return null;

  const summary = await getSessionTokenUsageSummary(sessionKey);
  const tokenUsage = mapSummaryToTokenUsage(summary);
  if (!tokenUsage) return null;

  trace.tokenUsage = tokenUsage;
  upsertObservabilityTrace(trace);
  return { type: 'trace.updated', trace };
}
