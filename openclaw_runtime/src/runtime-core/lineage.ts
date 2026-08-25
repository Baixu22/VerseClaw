/**
 * Runtime execution lineage shared by Mission, Task Loop, DCS, and SEKB.
 *
 * This is correlation metadata only. It is deliberately bounded and carries
 * no prompt, tool payload, or other free-form runtime content.
 */
export const RUNTIME_LINEAGE_SCHEMA = "runtime-lineage.v1" as const;

export type RuntimeLineage = {
  schema: typeof RUNTIME_LINEAGE_SCHEMA;
  sessionId: string;
  missionId?: string;
  missionTick?: number;
  loopRunId?: string;
  traceId?: string;
  taskLedgerRootId?: string;
};

export type RuntimeLineageInput = {
  sessionId?: unknown;
  missionId?: unknown;
  missionTick?: unknown;
  loopRunId?: unknown;
  traceId?: unknown;
  taskLedgerRootId?: unknown;
};

const MAX_LINEAGE_ID_LENGTH = 256;

function boundedId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_LINEAGE_ID_LENGTH
    ? normalized
    : undefined;
}

function boundedTick(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Normalize known lineage fields without inferring missing identity. */
export function normalizeRuntimeLineage(value: unknown): RuntimeLineage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as RuntimeLineageInput;
  const sessionId = boundedId(input.sessionId);
  if (!sessionId) return undefined;

  const missionId = boundedId(input?.missionId);
  const loopRunId = boundedId(input?.loopRunId);
  const traceId = boundedId(input?.traceId);
  const taskLedgerRootId = boundedId(input?.taskLedgerRootId);
  const missionTick = boundedTick(input?.missionTick);

  return {
    schema: RUNTIME_LINEAGE_SCHEMA,
    sessionId,
    ...(missionId ? { missionId } : {}),
    ...(missionTick !== undefined ? { missionTick } : {}),
    ...(loopRunId ? { loopRunId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(taskLedgerRootId ? { taskLedgerRootId } : {}),
  };
}

export function isRuntimeLineage(value: unknown): value is RuntimeLineage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "schema",
    "sessionId",
    "missionId",
    "missionTick",
    "loopRunId",
    "traceId",
    "taskLedgerRootId",
  ]);
  if (
    input.schema !== RUNTIME_LINEAGE_SCHEMA ||
    Object.keys(input).some((key) => !allowedKeys.has(key))
  ) {
    return false;
  }
  const normalized = normalizeRuntimeLineage(input);
  if (!normalized) return false;
  return (
    Object.entries(normalized).every(([key, entry]) => input[key] === entry) &&
    Object.keys(input).length === Object.keys(normalized).length
  );
}

/** Merge only explicit fields; no value is derived from another identifier. */
export function mergeRuntimeLineage(
  base: RuntimeLineageInput | RuntimeLineage | undefined,
  patch: RuntimeLineageInput | RuntimeLineage | undefined,
): RuntimeLineage | undefined {
  const baseLineage = normalizeRuntimeLineage(base);
  const patchLineage =
    patch && typeof patch === "object" && !Array.isArray(patch)
      ? (patch as RuntimeLineageInput)
      : undefined;
  if (!baseLineage && !patchLineage) return undefined;

  // Identity belongs to the established parent. Operational identifiers may
  // be filled in or refreshed as the run crosses subsystem boundaries, but a
  // child payload must not silently re-associate it with another session or
  // mission.
  return normalizeRuntimeLineage({
    ...patchLineage,
    ...baseLineage,
    ...(patchLineage?.loopRunId !== undefined ? { loopRunId: patchLineage.loopRunId } : {}),
    ...(patchLineage?.traceId !== undefined ? { traceId: patchLineage.traceId } : {}),
    ...(patchLineage?.taskLedgerRootId !== undefined
      ? { taskLedgerRootId: patchLineage.taskLedgerRootId }
      : {}),
  });
}
