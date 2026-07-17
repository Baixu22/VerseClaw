/**
 * SEKB trajectory redaction + quarantine (P3-001 / F-DATA-001, F-DATA-004).
 *
 * Reuses the same logging redaction policy (`redactSensitiveText` / `redactSecrets`)
 * so canary secrets never land in steps_json / task_intent / metadata. Unclassified
 * raw tool input/output defaults to quarantine (fingerprint + length only).
 */
import { createHash } from "node:crypto";
import {
  isSensitiveFieldKey,
  redactSecrets,
  redactSensitiveText,
} from "../../logging/redact.js";
import type { JsonObject, Trajectory, TrajectoryStep } from "./types.js";

export const SEKB_QUARANTINE_MARKER = "__sekb_quarantine" as const;

export type SekbPayloadClassification = "safe" | "sensitive" | "unclassified";

export type SekbQuarantinedPayload = {
  [SEKB_QUARANTINE_MARKER]: true;
  classification: Exclude<SekbPayloadClassification, "safe"> | "unclassified";
  fingerprint: string;
  byteLength: number;
  redacted: true;
  keys?: string[];
  note: string;
};

/** Allowlisted metadata keys that may persist after redaction without quarantine. */
const SAFE_METADATA_KEYS = new Set([
  "toolName",
  "toolCallId",
  "isError",
  "ok",
  "step",
  "omitted_count",
  "summary",
  "action",
  "status",
  "name",
  "type",
  "code",
  "duration_ms",
  "count",
  "retries",
]);

const QUARANTINE_NOTE =
  "SEKB raw payload quarantined before persistence (P3-001 / F-DATA-001).";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSekbQuarantinedPayload(value: unknown): value is SekbQuarantinedPayload {
  return isRecord(value) && value[SEKB_QUARANTINE_MARKER] === true && value.redacted === true;
}

function stableSerialize(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function sekbContentFingerprint(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex").slice(0, 16);
}

export function sekbByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(stableSerialize(value), "utf8");
  } catch {
    return String(value).length;
  }
}

/**
 * Classify payload for SEKB persistence.
 * - sensitive: secret-shaped content (shared logging redaction would rewrite it)
 * - safe: small primitives / allowlisted metadata only
 * - unclassified: everything else (default quarantine)
 */
export function classifySekbPayload(value: unknown): SekbPayloadClassification {
  if (value == null) return "safe";
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
    return "safe";
  }
  if (typeof value === "string") {
    if (!value.trim()) return "safe";
    const redacted = redactSensitiveText(value);
    if (redacted !== value) return "sensitive";
    // Short non-secret labels are safe; free-form blobs are unclassified.
    return value.length <= 96 ? "safe" : "unclassified";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "safe";
    let anySensitive = false;
    let anyUnclassified = false;
    for (const entry of value) {
      const cls = classifySekbPayload(entry);
      if (cls === "sensitive") anySensitive = true;
      if (cls === "unclassified") anyUnclassified = true;
    }
    if (anySensitive) return "sensitive";
    if (anyUnclassified || value.length > 12) return "unclassified";
    return "safe";
  }
  if (isRecord(value)) {
    if (isSekbQuarantinedPayload(value)) {
      return value.classification === "sensitive" ? "sensitive" : "unclassified";
    }
    const entries = Object.entries(value);
    if (entries.length === 0) return "safe";
    let anySensitive = false;
    let anyUnclassified = false;
    let onlySafeKeys = true;
    for (const [key, nested] of entries) {
      if (isSensitiveFieldKey(key)) {
        anySensitive = true;
        onlySafeKeys = false;
      } else if (!SAFE_METADATA_KEYS.has(key)) {
        onlySafeKeys = false;
      }
      const cls = classifySekbPayload(nested);
      if (cls === "sensitive") anySensitive = true;
      if (cls === "unclassified") anyUnclassified = true;
    }
    const redacted = redactSecrets(value);
    if (stableSerialize(redacted) !== stableSerialize(value)) {
      anySensitive = true;
    }
    if (anySensitive) return "sensitive";
    if (!onlySafeKeys || anyUnclassified || sekbByteLength(value) > 512) {
      return "unclassified";
    }
    return "safe";
  }
  return "unclassified";
}

export function quarantineSekbPayload(
  value: unknown,
  classification: SekbPayloadClassification = "unclassified",
): SekbQuarantinedPayload {
  const cls: SekbQuarantinedPayload["classification"] =
    classification === "sensitive" ? "sensitive" : "unclassified";
  const keys = isRecord(value)
    ? Object.keys(value).slice(0, 32)
    : Array.isArray(value)
      ? [`[array:${value.length}]`]
      : undefined;
  return {
    [SEKB_QUARANTINE_MARKER]: true,
    classification: cls,
    fingerprint: sekbContentFingerprint(value),
    byteLength: sekbByteLength(value),
    redacted: true,
    ...(keys ? { keys } : {}),
    note: QUARANTINE_NOTE,
  };
}

/** Apply shared logging redaction policy to any SEKB-bound value. */
export function redactSekbValue<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }
  if (typeof value !== "object") return value;
  return redactSecrets(value);
}

function extractSafeMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const kept: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (!SAFE_METADATA_KEYS.has(key) || isSensitiveFieldKey(key)) continue;
    if (nested == null || typeof nested === "boolean" || typeof nested === "number") {
      kept[key] = nested;
      continue;
    }
    if (typeof nested === "string") {
      kept[key] = redactSensitiveText(nested);
      continue;
    }
    // Nested objects under safe keys are still quarantined (no raw nesting).
    kept[key] = quarantineSekbPayload(nested, classifySekbPayload(nested));
  }
  return kept;
}

/**
 * Persist-safe projection for a single trajectory step.
 * Tool steps always quarantine raw input/output (A3 unclassified default).
 */
export function sanitizeSekbStep(step: TrajectoryStep): TrajectoryStep {
  const action =
    typeof step.action === "string" ? redactSensitiveText(step.action) : "unknown";
  const isToolStep = action.startsWith("tool.");

  if (isToolStep) {
    const inputClass = classifySekbPayload(step.input);
    const outputClass = classifySekbPayload(step.output);
    const safeOut = extractSafeMetadata(step.output);
    return {
      action,
      input: quarantineSekbPayload(
        step.input,
        inputClass === "safe" ? "unclassified" : inputClass,
      ),
      output: {
        ...safeOut,
        raw: quarantineSekbPayload(
          step.output,
          outputClass === "safe" ? "unclassified" : outputClass,
        ),
      },
      timestamp: step.timestamp,
    };
  }

  const inputClass = classifySekbPayload(step.input);
  const outputClass = classifySekbPayload(step.output);
  return {
    action,
    input:
      inputClass === "safe"
        ? redactSekbValue(step.input)
        : quarantineSekbPayload(step.input, inputClass),
    output:
      outputClass === "safe"
        ? redactSekbValue(step.output)
        : quarantineSekbPayload(step.output, outputClass),
    timestamp: step.timestamp,
  };
}

/** Full trajectory sanitization before SQLite / steps_json persistence. */
export function sanitizeTrajectoryForPersistence(trajectory: Trajectory): Trajectory {
  // Idempotent: capture + store both call this path.
  if (
    isRecord(trajectory.metadata) &&
    isRecord(trajectory.metadata.sekbPersistence) &&
    trajectory.metadata.sekbPersistence.redacted === true
  ) {
    return trajectory;
  }
  const metadata = redactSekbValue(trajectory.metadata ?? {}) as JsonObject;
  const redactedMetadata: JsonObject = {
    ...metadata,
    sekbPersistence: {
      redacted: true,
      policy: "logging-redact+quarantine",
      findingIds: ["F-DATA-001", "F-DATA-004"],
      taskId: "P3-001",
    },
  };
  return {
    ...trajectory,
    task_intent: redactSensitiveText(trajectory.task_intent ?? ""),
    task_type: redactSensitiveText(trajectory.task_type ?? ""),
    context_fingerprint: (trajectory.context_fingerprint ?? []).map((tag) =>
      redactSensitiveText(String(tag)),
    ),
    steps: (trajectory.steps ?? []).map(sanitizeSekbStep),
    error_signature: trajectory.error_signature
      ? redactSensitiveText(trajectory.error_signature)
      : null,
    distilled_into: (trajectory.distilled_into ?? []).map((id) =>
      redactSensitiveText(String(id)),
    ),
    metadata: redactedMetadata,
  };
}

/**
 * Assert a canary secret does not appear in a stored trajectory projection.
 * Used by unit tests and maturity evidence probes.
 */
export function trajectoryContainsPlaintext(trajectory: Trajectory, canary: string): boolean {
  if (!canary) return false;
  try {
    return JSON.stringify(trajectory).includes(canary);
  } catch {
    return String(trajectory).includes(canary);
  }
}
