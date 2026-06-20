import { createHash } from 'node:crypto';
import type {
  ObservabilitySpan,
  ObservabilityTrace,
  ObservabilityTraceEvent,
} from '../../shared/types/observability';

export const OBSERVABILITY_PREVIEW_LIMIT = 320;
export const OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT = 900;

const SENSITIVE_KEY_PATTERN = /prompt|input|output|content|message|result|raw|args|arguments|body|payload/iu;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function truncatePreview(value: unknown, limit = OBSERVABILITY_PREVIEW_LIMIT): string | undefined {
  if (value == null) return undefined;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text.trim()) return undefined;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

export function contentFingerprint(value: unknown): string | undefined {
  const preview = truncatePreview(value, 20_000);
  if (!preview) return undefined;
  return createHash('sha256').update(preview).digest('hex').slice(0, 16);
}

export function summarizeRedactedContent(value: unknown): string | undefined {
  const preview = truncatePreview(value, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT);
  if (!preview) return undefined;
  const hash = contentFingerprint(preview);
  return hash ? `redacted-preview:${preview.length}:${hash}` : `redacted-preview:${preview.length}`;
}

export function shouldExposeAttribute(key: string): boolean {
  return !SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeAttributeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => truncatePreview(entry, 160)).filter(Boolean);
  }
  if (isRecord(value)) {
    const nested: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (!shouldExposeAttribute(key)) continue;
      const preview = truncatePreview(nestedValue, 160);
      if (preview != null) nested[key] = preview;
    }
    return Object.keys(nested).length ? nested : undefined;
  }
  return truncatePreview(value, 240);
}

export function sanitizeAttributes(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!shouldExposeAttribute(key)) {
      const hash = contentFingerprint(value);
      const length = truncatePreview(value, 50_000)?.length;
      if (hash && length != null) {
        safe[`${key}Hash`] = hash;
        safe[`${key}Length`] = length;
      }
      continue;
    }
    const sanitized = sanitizeAttributeValue(value);
    if (sanitized != null) safe[key] = sanitized;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function sanitizeSpanForPersistence(span: ObservabilitySpan): ObservabilitySpan {
  return {
    ...span,
    input: summarizeRedactedContent(span.input),
    output: summarizeRedactedContent(span.output),
    error: truncatePreview(span.error, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT),
    attributes: sanitizeAttributes(span.attributes),
  };
}

function sanitizeEventForPersistence(event: ObservabilityTraceEvent): ObservabilityTraceEvent {
  return {
    ...event,
    attributes: sanitizeAttributes(event.attributes),
  };
}

export function sanitizeTraceForPersistence(trace: ObservabilityTrace): ObservabilityTrace {
  return {
    ...trace,
    task: summarizeRedactedContent(trace.task),
    error: truncatePreview(trace.error, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT),
    spans: (trace.spans ?? []).map(sanitizeSpanForPersistence),
    events: (trace.events ?? []).map(sanitizeEventForPersistence),
    metrics: { ...(trace.metrics ?? {}) },
    tags: [...(trace.tags ?? [])],
  };
}
