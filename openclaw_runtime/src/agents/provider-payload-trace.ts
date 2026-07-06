/**
 * Final provider payload shape tracing helpers.
 */
import { CACHE_TRACE_PROVIDER_PAYLOAD_RECORDER } from "./cache-trace.js";
import { summarizeProviderPayloadCacheShape } from "./provider-payload-cache-shape.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "./queued-file-writer.js";

const fallbackWriters = new Map<string, QueuedFileWriter>();

export function isProviderPayloadTraceEnabled(): boolean {
  const value = process.env.OPENCLAW_CACHE_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function buildProviderPayloadTraceEvent(payload: unknown, source: string) {
  const shape = summarizeProviderPayloadCacheShape(payload);
  return {
    ts: new Date().toISOString(),
    seq: 0,
    stage: "provider:payload" as const,
    providerSystemDigest: shape.systemHash,
    providerMessagesDigest: shape.messagesHash,
    providerToolsDigest: shape.toolsHash,
    providerPrefixShapeDigest: shape.prefixShapeHash,
    providerParamsDigest: shape.paramsHash,
    providerToolCount: shape.toolCount,
    providerToolNames: shape.toolNames,
    providerPayloadSource: source,
  };
}

export function writeProviderPayloadTraceFallback(payload: unknown, source: string): void {
  if (!isProviderPayloadTraceEnabled()) {
    return;
  }
  const filePath = process.env.OPENCLAW_CACHE_TRACE_FILE?.trim();
  if (!filePath) {
    return;
  }
  try {
    const writer = getQueuedFileWriter(fallbackWriters, filePath);
    writer.write(`${JSON.stringify(buildProviderPayloadTraceEvent(payload, `${source}:fallback`))}\n`);
  } catch {
    // Diagnostics must not affect provider requests.
  }
}

export function recordProviderPayloadTrace(
  options: Record<PropertyKey, unknown> | undefined,
  payload: unknown,
  source: string,
): void {
  const recorder = options?.[CACHE_TRACE_PROVIDER_PAYLOAD_RECORDER];
  if (typeof recorder !== "function") {
    writeProviderPayloadTraceFallback(payload, source);
    return;
  }
  try {
    (recorder as (payload: unknown, source?: string) => void)(payload, source);
  } catch {
    // Diagnostics must not affect provider requests.
  }
}
