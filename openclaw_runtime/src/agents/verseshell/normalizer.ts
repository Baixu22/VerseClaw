import type {
  ArtifactDescriptor,
  JsonObject,
  Observation,
  OperationError,
  StreamCapture,
} from "../../../../shared/verseshell/types.js";
import { extractArtifactDescriptors, extractArtifactHandles, extractStreamCapture } from "../../../../shared/verseshell/extraction.js";
import { decodeObservation } from "../../../../shared/verseshell/validation.js";
import { DEFAULT_MAX_JSON_FRAME_BYTES } from "../../../../shared/verseshell/types.js";

export type { JsonObject, Observation, OperationError };

export type NormalizedAciObservation = {
  id: string;
  op: string;
  ok: boolean;
  data?: unknown;
  error?: OperationError;
  artifacts?: ArtifactDescriptor[];
  streams?: {
    stdout?: StreamCapture;
    stderr?: StreamCapture;
  };
  meta: {
    elapsedMs: number;
    profile: string;
    tokenEstimate: number;
    effects?: string[];
    capabilitiesUsed?: string[];
  };
  raw: Observation;
};

export type AciFrame =
  | { kind: "observation"; observation: Observation }
  | { kind: "control"; message: Record<string, unknown> };

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode authoritative ACI Observations while keeping STATS/GC out of correlation. */
export function parseAciFrame(raw: string, maxBytes: number): AciFrame | null {
  if (new TextEncoder().encode(raw).byteLength > DEFAULT_MAX_JSON_FRAME_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isJsonObject(parsed)) return null;
  if (
    parsed.id === "__gc__" ||
    parsed.id === "__stats__" ||
    parsed.id === "__refresh__" ||
    parsed.type === "stats" ||
    parsed.type === "gc"
  ) {
    return { kind: "control", message: parsed };
  }
  try {
    return {
      kind: "observation",
      observation: decodeObservation(raw, { max_bytes: maxBytes }),
    };
  } catch {
    return null;
  }
}

/** Optional camel-case view; raw Observation remains the primary result. */
export function normalizeAciObservation(observation: Observation): NormalizedAciObservation {
  // Validate any result handles before a projection can make them model-visible.
  extractArtifactHandles(observation);
  const data = isJsonObject(observation.data) ? observation.data : undefined;
  const streams: NormalizedAciObservation["streams"] = {};
  for (const stream of ["stdout", "stderr"] as const) {
    const value = data?.[stream];
    if (isJsonObject(value) && "raw_bytes" in value && "retained_bytes" in value && "omitted_bytes" in value) {
      streams[stream] = extractStreamCapture(value, `$observation.data.${stream}`);
    }
  }
  const artifacts = Array.isArray(data?.artifacts) && data.artifacts.length > 0
    ? extractArtifactDescriptors(observation)
    : undefined;
  return {
    id: observation.id,
    op: observation.op,
    ok: observation.ok,
    data: observation.data,
    error: observation.error,
    ...(artifacts ? { artifacts } : {}),
    ...(streams.stdout || streams.stderr ? { streams } : {}),
    meta: {
      elapsedMs: observation.meta.elapsed_ms,
      profile: observation.meta.profile,
      tokenEstimate: observation.meta.token_estimate,
      effects: observation.meta.effects,
      capabilitiesUsed: observation.meta.capabilities_used,
    },
    raw: observation,
  };
}
