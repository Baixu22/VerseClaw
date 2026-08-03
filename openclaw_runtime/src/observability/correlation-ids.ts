// RC-08B correlation IDs. Ingress, run, model/tool, effect, and delivery share a
// stable correlation identity so OTel/OTLP spans link across the runtime flow.
// Receipts and domain journals remain factual evidence; correlation IDs only
// join them — they never replace the journals.
import { createHash } from 'node:crypto';

export const CORRELATION_SCHEMA_VERSION = '1';

export type CorrelationSegments = {
  ingressId?: string;
  runId?: string;
  modelCallId?: string;
  effectId?: string;
  deliveryId?: string;
};

export type CorrelationIdentity = {
  /** Stable correlation digest across all segments. */
  correlationDigest: string;
  segments: CorrelationSegments;
};

/**
 * Build a stable correlation digest from the joined segments. The same set of
 * segments yields the same digest (used as the OTel traceId root).
 */
export function correlationDigest(segments: CorrelationSegments): string {
  return createHash('sha256')
    .update(
      [
        segments.ingressId ?? '',
        segments.runId ?? '',
        segments.modelCallId ?? '',
        segments.effectId ?? '',
        segments.deliveryId ?? '',
      ].join(''),
    )
    .digest('hex');
}

export function buildCorrelationIdentity(segments: CorrelationSegments): CorrelationIdentity {
  return { correlationDigest: correlationDigest(segments), segments };
}

/** A valid OTel trace id is 32 hex chars; the digest is truncated to fit. */
export function toOtelTraceId(correlationDigest: string): string {
  return correlationDigest.slice(0, 32);
}

/** A valid OTel span id is 16 hex chars. */
export function toOtelSpanId(digest: string, salt = 'span'): string {
  return createHash('sha256').update(`${salt}:${digest}`).digest('hex').slice(0, 16);
}
