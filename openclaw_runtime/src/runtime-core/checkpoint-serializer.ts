import {
  isCheckpoint,
  isEvidenceRef,
  type Checkpoint,
  type EvidenceRef,
} from "./evidence.js";
import {
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
} from "./types.js";
import {
  emitRuntimeCheckpointVerificationShadowSample,
  type RuntimeVerificationShadowSamplingOptions,
} from "./verification-shadow-sampling.js";

export const RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION = 1 as const;
export const RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER =
  "runtime.checkpoint-serializer.v1" as const;

export const RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_VERSION = 1 as const;
export const RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER =
  "runtime.task-continue-as-new.v1" as const;

export const RUNTIME_CHECKPOINT_SERIALIZER_DIAGNOSTIC_CODES = [
  "invalid_checkpoint",
  "missing_checkpoint_payload",
  "schema_marker_mismatch",
] as const;

export type RuntimeCheckpointSerializerDiagnosticCode =
  (typeof RUNTIME_CHECKPOINT_SERIALIZER_DIAGNOSTIC_CODES)[number];

export type RuntimeCheckpointSerializerDiagnostic = {
  code: RuntimeCheckpointSerializerDiagnosticCode;
  message: string;
  recoverable: true;
  checkpointId?: string;
  taskId?: string;
  expectedSchemaMarker?: string;
  actualSchemaMarker?: string;
};

export type RuntimeTaskContinueAsNewShadowReason =
  | "history_compaction"
  | "schema_upgrade"
  | "manual";

export type RuntimeTaskContinueAsNewShadow = {
  schemaVersion: typeof RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_VERSION;
  schemaMarker: typeof RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER;
  parentTaskId: string;
  nextTaskId: string;
  checkpointId: string;
  reason: RuntimeTaskContinueAsNewShadowReason;
  openObligations: string[];
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeCheckpointVersionMarkers = RuntimeCoreJsonObject & {
  checkpointSchemaVersion: Checkpoint["schemaVersion"];
  checkpointSerializerSchemaVersion:
    typeof RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION;
  checkpointSerializerSchemaMarker:
    typeof RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER;
  continueAsNewSchemaMarker?: typeof RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER;
};

export type RuntimeCheckpointSnapshot = {
  schemaVersion: typeof RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION;
  schemaMarker: typeof RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER;
  checkpoint: Checkpoint;
  toolResultRefs: string[];
  versionMarkers: RuntimeCheckpointVersionMarkers;
  metadata?: RuntimeCoreJsonObject;
  compaction?: RuntimeTaskContinueAsNewShadow;
};

export type RuntimeCheckpointSerializeOptions = {
  toolResultRefs?: string[];
  metadata?: RuntimeCoreJsonObject;
  versionMarkers?: RuntimeCoreJsonObject;
  compaction?: RuntimeTaskContinueAsNewShadow;
  shadow?: RuntimeVerificationShadowSamplingOptions;
};

export type RuntimeCheckpointSerializeResult = {
  snapshot?: RuntimeCheckpointSnapshot;
  json?: string;
  diagnostics: RuntimeCheckpointSerializerDiagnostic[];
};

export type RuntimeCheckpointDeserializeResult = {
  snapshot?: RuntimeCheckpointSnapshot;
  checkpoint?: Checkpoint;
  diagnostics: RuntimeCheckpointSerializerDiagnostic[];
};

export function createRuntimeTaskContinueAsNewShadow(
  value: Omit<
    RuntimeTaskContinueAsNewShadow,
    "schemaVersion" | "schemaMarker"
  >,
): RuntimeTaskContinueAsNewShadow {
  return {
    schemaVersion: RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_VERSION,
    schemaMarker: RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER,
    ...value,
    openObligations: [...value.openObligations],
    evidenceRefs: value.evidenceRefs.map(stableClone),
    ...(value.metadata ? { metadata: stableClone(value.metadata) } : {}),
  };
}

export function isRuntimeTaskContinueAsNewShadow(
  value: unknown,
): value is RuntimeTaskContinueAsNewShadow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_VERSION &&
    value.schemaMarker === RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER &&
    isNonEmptyString(value.parentTaskId) &&
    isNonEmptyString(value.nextTaskId) &&
    isNonEmptyString(value.checkpointId) &&
    isContinueAsNewReason(value.reason) &&
    isStringArray(value.openObligations) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeCheckpointSnapshot(
  value: unknown,
): value is RuntimeCheckpointSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION &&
    value.schemaMarker === RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER &&
    isCheckpoint(value.checkpoint) &&
    isStringArray(value.toolResultRefs) &&
    isVersionMarkers(value.versionMarkers) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata)) &&
    (value.compaction === undefined ||
      isRuntimeTaskContinueAsNewShadow(value.compaction))
  );
}

export function serializeRuntimeCheckpoint(
  checkpoint: Checkpoint,
  options: RuntimeCheckpointSerializeOptions = {},
): RuntimeCheckpointSerializeResult {
  const invalidCheckpointDiagnostic = validateCheckpointForSerialization(checkpoint);
  if (invalidCheckpointDiagnostic) {
    return { diagnostics: [invalidCheckpointDiagnostic] };
  }

  const snapshot: RuntimeCheckpointSnapshot = {
    schemaVersion: RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION,
    schemaMarker: RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
    checkpoint: stableClone(checkpoint),
    toolResultRefs: options.toolResultRefs
      ? [...options.toolResultRefs]
      : checkpoint.toolResults.map((result) => result.callId),
    versionMarkers: {
      checkpointSchemaVersion: checkpoint.schemaVersion,
      checkpointSerializerSchemaVersion:
        RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION,
      checkpointSerializerSchemaMarker:
        RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
      ...(options.compaction
        ? { continueAsNewSchemaMarker: RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER }
        : {}),
      ...(options.versionMarkers ? stableClone(options.versionMarkers) : {}),
    },
    ...(options.metadata ? { metadata: stableClone(options.metadata) } : {}),
    ...(options.compaction ? { compaction: stableClone(options.compaction) } : {}),
  };

  const result = {
    snapshot,
    json: stableStringify(snapshot),
    diagnostics: [],
  };
  emitRuntimeCheckpointVerificationShadowSample({
    sampling: options.shadow,
    checkpoint: snapshot,
    fallbackRunId: checkpoint.taskId,
  });
  return result;
}

export function deserializeRuntimeCheckpoint(
  input: string | unknown,
): RuntimeCheckpointDeserializeResult {
  const parsed = typeof input === "string" ? parseJson(input) : { value: input };
  if ("diagnostic" in parsed) {
    return { diagnostics: [parsed.diagnostic] };
  }

  const schemaDiagnostic = checkpointEnvelopeSchemaDiagnostic(parsed.value);
  if (schemaDiagnostic) {
    return { diagnostics: [schemaDiagnostic] };
  }

  if (!isRecord(parsed.value) || !("checkpoint" in parsed.value)) {
    return {
      diagnostics: [
        diagnostic({
          code: "missing_checkpoint_payload",
          message: "Serialized runtime checkpoint is missing checkpoint payload.",
        }),
      ],
    };
  }

  const checkpointSchemaDiagnostic = checkpointSchemaVersionDiagnostic(
    parsed.value.checkpoint,
  );
  if (checkpointSchemaDiagnostic) {
    return { diagnostics: [checkpointSchemaDiagnostic] };
  }

  if (!isRuntimeCheckpointSnapshot(parsed.value)) {
    return {
      diagnostics: [
        diagnostic({
          code: "invalid_checkpoint",
          message: "Serialized runtime checkpoint snapshot is invalid.",
          checkpointId: checkpointIdFrom(parsed.value.checkpoint),
          taskId: taskIdFrom(parsed.value.checkpoint),
        }),
      ],
    };
  }

  const snapshot = stableClone(parsed.value);
  return {
    snapshot,
    checkpoint: stableClone(snapshot.checkpoint),
    diagnostics: [],
  };
}

function validateCheckpointForSerialization(
  checkpoint: unknown,
): RuntimeCheckpointSerializerDiagnostic | undefined {
  const schemaDiagnostic = checkpointSchemaVersionDiagnostic(checkpoint);
  if (schemaDiagnostic) {
    return schemaDiagnostic;
  }
  if (!isCheckpoint(checkpoint)) {
    return diagnostic({
      code: "invalid_checkpoint",
      message: "Checkpoint does not satisfy the canonical runtime-core contract.",
      checkpointId: checkpointIdFrom(checkpoint),
      taskId: taskIdFrom(checkpoint),
    });
  }
  return undefined;
}

function checkpointEnvelopeSchemaDiagnostic(
  value: unknown,
): RuntimeCheckpointSerializerDiagnostic | undefined {
  if (
    isRecord(value) &&
    value.schemaVersion === RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION &&
    value.schemaMarker === RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER
  ) {
    return undefined;
  }
  return diagnostic({
    code: "schema_marker_mismatch",
    message: "Runtime checkpoint serializer schema marker/version mismatch.",
    expectedSchemaMarker: RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER,
    actualSchemaMarker: schemaMarkerFrom(value),
  });
}

function checkpointSchemaVersionDiagnostic(
  checkpoint: unknown,
): RuntimeCheckpointSerializerDiagnostic | undefined {
  if (!isRecord(checkpoint) || checkpoint.schemaVersion === undefined) {
    return undefined;
  }
  if (checkpoint.schemaVersion === 1) {
    return undefined;
  }
  return diagnostic({
    code: "schema_marker_mismatch",
    message: "Canonical checkpoint schema version mismatch.",
    expectedSchemaMarker: "runtime.checkpoint.v1",
    actualSchemaMarker: `runtime.checkpoint.v${String(checkpoint.schemaVersion)}`,
    checkpointId: checkpointIdFrom(checkpoint),
    taskId: taskIdFrom(checkpoint),
  });
}

function isVersionMarkers(value: unknown): value is RuntimeCheckpointVersionMarkers {
  if (!isRuntimeCoreJsonObject(value)) {
    return false;
  }
  return (
    value.checkpointSchemaVersion === 1 &&
    value.checkpointSerializerSchemaVersion ===
      RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_VERSION &&
    value.checkpointSerializerSchemaMarker ===
      RUNTIME_CHECKPOINT_SERIALIZER_SCHEMA_MARKER &&
    (value.continueAsNewSchemaMarker === undefined ||
      value.continueAsNewSchemaMarker === RUNTIME_TASK_CONTINUE_AS_NEW_SCHEMA_MARKER)
  );
}

function isContinueAsNewReason(
  value: unknown,
): value is RuntimeTaskContinueAsNewShadowReason {
  return (
    value === "history_compaction" ||
    value === "schema_upgrade" ||
    value === "manual"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJson(
  input: string,
):
  | { value: unknown }
  | { diagnostic: RuntimeCheckpointSerializerDiagnostic } {
  try {
    return { value: JSON.parse(input) };
  } catch (error) {
    return {
      diagnostic: diagnostic({
        code: "invalid_checkpoint",
        message: `Serialized runtime checkpoint JSON is invalid: ${errorMessage(error)}`,
      }),
    };
  }
}

function checkpointIdFrom(value: unknown): string | undefined {
  return isRecord(value) && isNonEmptyString(value.checkpointId)
    ? value.checkpointId
    : undefined;
}

function taskIdFrom(value: unknown): string | undefined {
  return isRecord(value) && isNonEmptyString(value.taskId)
    ? value.taskId
    : undefined;
}

function schemaMarkerFrom(value: unknown): string {
  if (!isRecord(value)) {
    return "missing@missing";
  }
  return [String(value.schemaMarker ?? "missing"), String(value.schemaVersion ?? "missing")]
    .join("@");
}

function diagnostic(
  value: Omit<RuntimeCheckpointSerializerDiagnostic, "recoverable">,
): RuntimeCheckpointSerializerDiagnostic {
  return {
    ...value,
    recoverable: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableClone<T>(value: T): T {
  return JSON.parse(stableStringify(value)) as T;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}
