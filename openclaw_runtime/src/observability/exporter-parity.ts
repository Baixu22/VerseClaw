// RC-08B OTel exporter-off parity and redaction. When the OTel exporter is off,
// runtime behavior and the in-memory observability cache are byte-identical.
// Default raw prompt/tool content must never leak into the exporter; spans carry
// correlation ids, digests, and bounded metadata only.
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
