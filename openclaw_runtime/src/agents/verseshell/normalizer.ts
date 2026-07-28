import type {
  JsonObject,
  Observation,
  OperationError,
} from "../../../../shared/verseshell/types.js";
import { decodeObservation } from "../../../../shared/verseshell/validation.js";

export type { JsonObject, Observation, OperationError };

export type NormalizedAciObservation = {
  id: string;
  op: string;
  ok: boolean;
  data?: unknown;
  error?: OperationError;
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
  return {
    id: observation.id,
    op: observation.op,
    ok: observation.ok,
    data: observation.data,
    error: observation.error,
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
