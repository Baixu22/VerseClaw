// RC-08B OTel exporter-off parity, redaction, and the neutral OTLP export path.
// When the OTel exporter is off, runtime behavior and the in-memory
// observability cache are byte-identical (exporter-off parity). Default raw
// prompt/tool content must never leak into the exporter; spans carry correlation
// ids, digests, and bounded metadata only.
//
// OTel/OTLP owns trace export. The runtime never defines a second trace schema
// or store: the exporter posts the canonical OTLP `ExportTraceServiceRequest`
// (HTTP/JSON encoding) to the configured OTLP endpoint. `exported: true` is only
// reported after the fixture collector actually receives and validates the
// golden trace spans.
import { createHash } from "node:crypto";
import { toOtelSpanId } from "./correlation-ids.js";
import type { ObservabilitySpan, ObservabilityTrace } from "./types.js";

export const OBSERVABILITY_EXPORTER_OFF_PARITY = 'rc08b.exporterOffParity';
export const OBSERVABILITY_EXPORTER_FLAG = 'rc08b.otelExporter';

export type ExportableSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  correlationDigest: string;
  /** Bounded metadata; raw prompt/tool output is never included. */
  attributes: Record<string, string | number>;
};

const RAW_CONTENT_MARKERS = [/prompt/i, /toolOutput/i, /tool_output/i, /rawMessage/i, /contentDigest.*message/i];

/**
 * A span is exportable only when it carries no raw prompt/tool content. Rejecting
 * any attribute key that looks like raw content keeps default leakage at zero.
 */
export function isSpanExportable(span: ExportableSpan): { ok: boolean; reason?: string } {
  for (const key of Object.keys(span.attributes)) {
    if (RAW_CONTENT_MARKERS.some((marker) => marker.test(key))) {
      return { ok: false, reason: `raw content key rejected: ${key}` };
    }
  }
  return { ok: true };
}

/**
 * Exporter-off parity: with the exporter flag off, exporting is a no-op that
 * returns the same traces the in-memory cache already holds (no second store).
 */
export function exportSpansWithParity(input: {
  exporterEnabled: boolean;
  spans: ExportableSpan[];
}): { exported: boolean; spans: ExportableSpan[] } {
  if (input.exporterEnabled !== true) {
    // Exporter-off parity: no export, no second store, in-memory cache unchanged.
    return { exported: false, spans: input.spans };
  }
  const exportable = input.spans.filter((span) => isSpanExportable(span).ok);
  return { exported: true, spans: exportable };
}

// ---------------------------------------------------------------------------
// OTLP/HTTP (JSON) export path. The OTLP `ExportTraceServiceRequest` schema is
// the single trace schema; only the wire encoding differs from the protobuf
// exporters used by the diagnostics-otel extension.
// ---------------------------------------------------------------------------

/** OTLP span kinds (opentelemetry.proto.trace.v1.Span.SpanKind). */
const OTLP_SPAN_KIND: Record<string, number> = {
  orchestrator: 1, // INTERNAL
  "role-router": 1,
  team: 1,
  subagent: 2, // SERVER (spawned work)
  model: 3, // CLIENT
  tool: 3,
  memory: 1,
  "context-pack": 1,
  gatekeeper: 1,
  verifier: 1,
  "security-intercept": 1,
  verification: 1,
  "input-mode": 1,
  custom: 1,
};

/** OTLP trace/span ids are raw 16/8-byte arrays; correlation ids are hex. */
function hexToOtlpBase64(hex: string): string {
  const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return Buffer.from(bytes).toString("base64");
}

/** Derive a valid OTLP base64 trace id from a runtime trace id. */
function otlpTraceId(traceId: string): string {
  // Runtime trace ids are arbitrary strings; hash to a stable 16-byte id.
  const hex = createHash("sha256").update(`trace:${traceId}`).digest("hex").slice(0, 32);
  return hexToOtlpBase64(hex);
}

/** Derive a valid OTLP base64 span id from a runtime span id. */
function otlpSpanId(spanId: string, salt = "span"): string {
  return hexToOtlpBase64(toOtelSpanId(spanId, salt));
}

function otlpAttribute(key: string, value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return { key, value: { stringValue: value } };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }
  return null;
}

function boundedString(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

/**
 * Map one Observability span to the canonical OTLP span JSON shape. Correlation
 * ids (traceId/spanId) come from the runtime correlation identity; only bounded
 * low-cardinality attributes are exported by default — raw prompt/tool content
 * (`input`/`output`/`error` and any raw-content attribute keys) never leaks.
 */
export function toOtlpSpanJson(span: ObservabilitySpan): Record<string, unknown> {
  const startTimeUnixNano = span.startedAt * 1_000_000;
  const endTimeUnixNano = (span.endedAt ?? span.startedAt) * 1_000_000;
  const attributes: Array<Record<string, unknown>> = [];
  const push = (key: string, value: unknown) => {
    const attribute = otlpAttribute(key, value);
    if (attribute) attributes.push(attribute);
  };
  push("openclaw.span.kind", span.kind);
  push("openclaw.span.area", span.attributes?.__area);
  if (span.roleName) push("openclaw.role", span.roleName);
  if (span.modelRef) push("gen_ai.request.model", boundedString(span.modelRef, 200));
  for (const [key, value] of Object.entries(span.metrics ?? {})) {
    push(`openclaw.metric.${key}`, value);
  }
  // Bounded span metadata only; raw input/output/error are never exported.
  const status = span.status === "error" || span.status === "aborted"
    ? { code: 2, message: "error" }
    : span.status === "running"
      ? { code: 0 }
      : { code: 1 };
  return {
    traceId: otlpTraceId(span.traceId),
    spanId: otlpSpanId(span.id),
    ...(span.parentSpanId ? { parentSpanId: otlpSpanId(span.parentSpanId, "parent") } : {}),
    name: span.name,
    kind: OTLP_SPAN_KIND[span.kind] ?? 1,
    startTimeUnixNano: String(startTimeUnixNano),
    endTimeUnixNano: String(endTimeUnixNano),
    status,
    attributes,
  };
}

/**
 * Encode one Observability trace as the canonical OTLP `ExportTraceServiceRequest`
 * JSON document. The trace/span ids are derived from the runtime correlation
 * identity (same helper as `correlation-ids.ts`), so ingress/run/model-tool/
 * effect/delivery spans share one trace across the exported golden trace.
 */
export function toOtlpExportTraceServiceRequest(
  trace: ObservabilityTrace,
  serviceName = "openclaw",
): Record<string, unknown> {
  const spans = trace.spans.map((span) => toOtlpSpanJson(span));
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            ...(trace.runId
              ? [{ key: "openclaw.run.id", value: { stringValue: trace.runId } }]
              : []),
            ...(trace.sessionKey
              ? [{ key: "openclaw.session.key", value: { stringValue: trace.sessionKey } }]
              : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "openclaw" },
            spans,
          },
        ],
      },
    ],
  };
}

export type OtlpJsonExportResult = {
  exported: boolean;
  reason?: string;
  receivedTraceId?: string;
  spanCount?: number;
};

export type OtlpJsonExporter = (trace: ObservabilityTrace) => Promise<OtlpJsonExportResult>;

/**
 * Build the production OTLP/HTTP JSON exporter. When `enabled` is not true the
 * exporter is a no-op (exporter-off parity). `exported: true` is only returned
 * after the endpoint returns HTTP 200 for the `ExportTraceServiceRequest` body,
 * which the neutral fixture collector verifies against the golden trace.
 */
export function createObservabilityOtlpJsonExporter(params: {
  endpoint: string;
  enabled: boolean;
  headers?: Record<string, string>;
  serviceName?: string;
  fetchFn?: typeof fetch;
  traceIdFrom?: (trace: ObservabilityTrace) => string;
}): OtlpJsonExporter {
  const fetchFn = params.fetchFn ?? fetch;
  // Default correlation trace id: stable 32-hex digest of the runtime trace id.
  const traceIdFrom = params.traceIdFrom ?? ((trace: ObservabilityTrace) =>
    createHash("sha256").update(`trace:${trace.id}`).digest("hex").slice(0, 32));
  return async (trace: ObservabilityTrace): Promise<OtlpJsonExportResult> => {
    if (params.enabled !== true) {
      return { exported: false, reason: "exporter-off-parity" };
    }
    const body = toOtlpExportTraceServiceRequest(trace, params.serviceName);
    const receivedTraceId = traceIdFrom(trace);
    try {
      const response = await fetchFn(params.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...params.headers,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return { exported: false, reason: `collector rejected export: HTTP ${response.status}` };
      }
      return {
        exported: true,
        receivedTraceId,
        spanCount: trace.spans.length,
      };
    } catch (error) {
      return {
        exported: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
