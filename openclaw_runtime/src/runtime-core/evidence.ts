import {
  buildToolCallResultFixture,
  isNonEmptyString,
  isOptionalString,
  isRecord,
  isRuntimeCoreJsonObject,
  isRuntimeTaskStatus,
  isToolCallResult,
  type RuntimeCoreJsonObject,
  type RuntimeTaskStatus,
  type ToolCallResult,
} from "./types.js";

export const EVIDENCE_REF_TYPES = [
  "file",
  "test",
  "trace",
  "tool",
  "human",
  "session",
  "subagent",
  "memory",
  "task_loop",
  "clawgraph",
  "task_ledger",
  "checkpoint",
  "manual",
  "other",
] as const;

export type EvidenceRefType = typeof EVIDENCE_REF_TYPES[number];

export type EvidenceRef = {
  type: EvidenceRefType;
  ref: string;
  label?: string;
  summary?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type Checkpoint = {
  checkpointId: string;
  taskId: string;
  state: RuntimeTaskStatus;
  openObligations: string[];
  contextSummary: string;
  toolResults: ToolCallResult[];
  fileHashes: Record<string, string>;
  evidenceRefs: EvidenceRef[];
  schemaVersion: 1;
};

const EVIDENCE_REF_TYPE_SET = new Set<EvidenceRefType>(EVIDENCE_REF_TYPES);

export function isEvidenceRefType(value: unknown): value is EvidenceRefType {
  return typeof value === "string" && EVIDENCE_REF_TYPE_SET.has(value as EvidenceRefType);
}

export function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isEvidenceRefType(value.type) &&
    isNonEmptyString(value.ref) &&
    isOptionalString(value.label) &&
    isOptionalString(value.summary) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

export function isCheckpoint(value: unknown): value is Checkpoint {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.checkpointId) &&
    isNonEmptyString(value.taskId) &&
    isRuntimeTaskStatus(value.state) &&
    isStringArray(value.openObligations) &&
    typeof value.contextSummary === "string" &&
    Array.isArray(value.toolResults) &&
    value.toolResults.every(isToolCallResult) &&
    isStringRecord(value.fileHashes) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    value.schemaVersion === 1
  );
}

export function buildEvidenceRefFixture(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    type: "trace",
    ref: "trace_1",
    label: "Runtime trace",
    summary: "Fixture evidence reference.",
    ...overrides,
  };
}

export function buildCheckpointFixture(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    checkpointId: "checkpoint_1",
    taskId: "task_1",
    state: "running",
    openObligations: ["Verify the runtime-core contract shape."],
    contextSummary: "Runtime-core contract fixture checkpoint.",
    toolResults: [buildToolCallResultFixture()],
    fileHashes: { "src/runtime-core/types.ts": "sha256:fixture" },
    evidenceRefs: [buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint_1" })],
    schemaVersion: 1,
    ...overrides,
  };
}
