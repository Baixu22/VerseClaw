import {
  isEvidenceRef,
  type EvidenceRef,
} from "./evidence.js";
import {
  evaluateEvidenceVerifier,
  type EvidenceVerifierEventReplaySummary,
  type EvidenceVerifierInput,
  type EvidenceVerifierObligation,
  type EvidenceVerifierPolicy,
  type EvidenceVerifierReport,
} from "./evidence-verifier.js";
import {
  isRuntimeCoreJsonObject,
  isRuntimeTaskStatus,
  isToolCallResult,
  type RuntimeCoreJsonObject,
  type RuntimeTaskStatus,
  type RuntimeTraceContext,
  type ToolCallResult,
} from "./types.js";
import type {
  RuntimeCheckpointDeserializeResult,
  RuntimeCheckpointSerializeResult,
  RuntimeCheckpointSerializerDiagnostic,
} from "./checkpoint-serializer.js";
import type {
  RuntimeTaskReplayDiagnostic,
  RuntimeTaskReplayResult,
} from "./state-reducer.js";

export type EvidenceVerifierEvidenceSource =
  | "runtime"
  | "task_loop"
  | "tool_result"
  | "event_replay"
  | "checkpoint"
  | "trace"
  | "human"
  | "renderer";

export type EvidenceVerifierTaskLoopEvidenceInput = {
  filesTouched?: readonly string[];
  testsRun?: readonly string[];
  evidenceRefs?: readonly EvidenceRef[];
  source?: Extract<EvidenceVerifierEvidenceSource, "runtime" | "task_loop" | "renderer">;
  sourceProjected?: boolean;
};

export type EvidenceVerifierExternalDependencyInput = {
  id: string;
  description: string;
  evidenceRefs?: readonly EvidenceRef[];
};

export type EvidenceVerifierTraceEvidenceInput =
  | RuntimeTraceContext
  | {
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
      source?: Extract<EvidenceVerifierEvidenceSource, "runtime" | "trace" | "renderer">;
      sourceProjected?: boolean;
    };

export type EvidenceVerifierCollectionInput = {
  taskId: string;
  objective: string;
  taskLoop?: EvidenceVerifierTaskLoopEvidenceInput;
  toolResults?: readonly ToolCallResult[];
  eventReplay?: RuntimeTaskReplayResult | EvidenceVerifierEventReplaySummary;
  checkpoint?:
    | RuntimeCheckpointSerializeResult
    | RuntimeCheckpointDeserializeResult
    | { diagnostics?: readonly RuntimeCheckpointSerializerDiagnostic[] };
  checkpointDiagnostics?: readonly RuntimeCheckpointSerializerDiagnostic[];
  trace?: EvidenceVerifierTraceEvidenceInput | readonly EvidenceVerifierTraceEvidenceInput[];
  humanEvidenceRefs?: readonly EvidenceRef[];
  openObligations?: readonly string[];
  externalDependencies?: readonly EvidenceVerifierExternalDependencyInput[];
  metadata?: RuntimeCoreJsonObject;
};

export type EvidenceVerifierCollectionDiagnosticCode =
  | "invalid_task_id"
  | "invalid_objective"
  | "invalid_evidence_ref"
  | "invalid_tool_result"
  | "untrusted_renderer_evidence";

export type EvidenceVerifierCollectionDiagnostic = {
  code: EvidenceVerifierCollectionDiagnosticCode;
  message: string;
  recoverable: true;
  source?: EvidenceVerifierEvidenceSource;
  ref?: string;
};

export type EvidenceVerifierCollectionResult = {
  input: EvidenceVerifierInput;
  projectedEvidenceRefs: EvidenceRef[];
  diagnostics: EvidenceVerifierCollectionDiagnostic[];
};

export function collectEvidenceVerifierInput(
  params: EvidenceVerifierCollectionInput,
): EvidenceVerifierCollectionResult {
  const diagnostics: EvidenceVerifierCollectionDiagnostic[] = [];
  const authoritativeEvidenceRefs: EvidenceRef[] = [];
  const projectedEvidenceRefs: EvidenceRef[] = [];
  const obligations: EvidenceVerifierObligation[] = [];

  const taskLoop = collectTaskLoopEvidence(params.taskLoop, diagnostics);
  authoritativeEvidenceRefs.push(...taskLoop.authoritativeEvidenceRefs);
  projectedEvidenceRefs.push(...taskLoop.projectedEvidenceRefs);

  const toolResults = collectToolResults(params.toolResults, diagnostics);
  authoritativeEvidenceRefs.push(
    ...toolResults.flatMap((result) =>
      result.evidence.map((ref) => sanitizeEvidenceRef(ref, "tool_result")),
    ),
  );

  const trace = collectTraceEvidence(params.trace, diagnostics);
  authoritativeEvidenceRefs.push(...trace.authoritativeEvidenceRefs);
  projectedEvidenceRefs.push(...trace.projectedEvidenceRefs);

  authoritativeEvidenceRefs.push(
    ...collectEvidenceRefs(params.humanEvidenceRefs, "human", diagnostics)
      .authoritativeEvidenceRefs,
  );

  obligations.push(...openObligations(params.openObligations));
  obligations.push(...externalDependencyObligations(params.externalDependencies, diagnostics));

  const replaySummary = collectReplaySummary(params.eventReplay, params.checkpoint, params.checkpointDiagnostics);
  if (isReplayResult(params.eventReplay)) {
    obligations.push(...openObligations(params.eventReplay.state.openObligations));
    authoritativeEvidenceRefs.push(
      ...params.eventReplay.state.evidenceRefs.map((ref) => sanitizeEvidenceRef(ref, "event_replay")),
    );
  }

  return {
    input: {
      taskId: nonEmptyString(params.taskId) ?? "unknown",
      objective: nonEmptyString(params.objective) ?? "unknown",
      obligations: dedupeObligations(obligations),
      evidenceRefs: dedupeEvidenceRefs(authoritativeEvidenceRefs),
      toolResults,
      eventReplay: replaySummary,
      ...(params.metadata && isRuntimeCoreJsonObject(params.metadata)
        ? { metadata: stableClone(params.metadata) }
        : {}),
    },
    projectedEvidenceRefs: dedupeEvidenceRefs(projectedEvidenceRefs),
    diagnostics,
  };
}

export function evaluateCollectedEvidenceVerifier(
  params: EvidenceVerifierCollectionInput,
  policy: EvidenceVerifierPolicy = {},
): EvidenceVerifierReport {
  return evaluateEvidenceVerifier(collectEvidenceVerifierInput(params).input, policy);
}

export function collectTaskLoopEvidence(
  input: EvidenceVerifierTaskLoopEvidenceInput | undefined,
  diagnostics: EvidenceVerifierCollectionDiagnostic[] = [],
): Pick<EvidenceVerifierCollectionResult, "projectedEvidenceRefs"> & {
  authoritativeEvidenceRefs: EvidenceRef[];
} {
  if (!input) {
    return { authoritativeEvidenceRefs: [], projectedEvidenceRefs: [] };
  }
  const source = input.source ?? "task_loop";
  const generated = [
    ...uniqueStrings(input.filesTouched ?? []).map((path) =>
      sanitizeEvidenceRef({
        type: "file",
        ref: path,
        label: "TaskLoop touched file",
        summary: "File evidence projected from TaskLoop filesTouched.",
      }, source),
    ),
    ...uniqueStrings(input.testsRun ?? []).map((command) =>
      sanitizeEvidenceRef({
        type: "test",
        ref: command,
        label: "TaskLoop test evidence",
        summary: "Test evidence projected from TaskLoop testsRun.",
      }, source),
    ),
  ];
  const supplied = collectEvidenceRefs(input.evidenceRefs, source, diagnostics)
    .authoritativeEvidenceRefs;
  return splitByAuthority(
    [...generated, ...supplied],
    source,
    input.sourceProjected === true,
    diagnostics,
  );
}

function collectToolResults(
  values: readonly ToolCallResult[] | undefined,
  diagnostics: EvidenceVerifierCollectionDiagnostic[],
): ToolCallResult[] {
  return (values ?? []).flatMap((value) => {
    if (!isToolCallResult(value)) {
      diagnostics.push({
        code: "invalid_tool_result",
        message: "ToolCallResult input did not satisfy the runtime-core contract.",
        recoverable: true,
        source: "tool_result",
      });
      return [];
    }
    return [{
      ...stableClone(value),
      evidence: value.evidence.map((ref) => sanitizeEvidenceRef(ref, "tool_result")),
      ...(value.error
        ? {
            error: {
              ...stableClone(value.error),
              evidenceRefs: value.error.evidenceRefs.map((ref) =>
                sanitizeEvidenceRef(ref, "tool_result")
              ),
            },
          }
        : {}),
    }];
  });
}

function collectTraceEvidence(
  input: EvidenceVerifierTraceEvidenceInput | readonly EvidenceVerifierTraceEvidenceInput[] | undefined,
  diagnostics: EvidenceVerifierCollectionDiagnostic[],
): Pick<EvidenceVerifierCollectionResult, "projectedEvidenceRefs"> & {
  authoritativeEvidenceRefs: EvidenceRef[];
} {
  const refs = (Array.isArray(input) ? input : input ? [input] : []).flatMap((trace) => {
    const traceId = nonEmptyString(trace.traceId);
    const spanId = nonEmptyString(trace.spanId);
    const ref = traceId ?? spanId;
    if (!ref) return [];
    return [sanitizeEvidenceRef({
      type: "trace",
      ref,
      label: "Runtime trace",
      summary: spanId ? `Trace ${ref} / span ${spanId}` : `Trace ${ref}`,
    }, "trace", {
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
      ...(nonEmptyString(trace.parentSpanId) ? { parentSpanId: trace.parentSpanId } : {}),
    })];
  });
  const source = Array.isArray(input) || !input || !("source" in input)
    ? undefined
    : input.source;
  const sourceProjected = !Array.isArray(input) && input && "sourceProjected" in input
    ? input.sourceProjected === true
    : false;
  return splitByAuthority(
    refs,
    source ?? "trace",
    sourceProjected,
    diagnostics,
  );
}

function collectReplaySummary(
  replay: RuntimeTaskReplayResult | EvidenceVerifierEventReplaySummary | undefined,
  checkpoint:
    | RuntimeCheckpointSerializeResult
    | RuntimeCheckpointDeserializeResult
    | { diagnostics?: readonly RuntimeCheckpointSerializerDiagnostic[] }
    | undefined,
  checkpointDiagnostics: readonly RuntimeCheckpointSerializerDiagnostic[] | undefined,
): EvidenceVerifierEventReplaySummary {
  const checkpointCodes = [
    ...diagnosticCodes(checkpoint?.diagnostics),
    ...diagnosticCodes(checkpointDiagnostics),
  ];
  if (isReplayResult(replay)) {
    const replayCodes = diagnosticCodes(replay.diagnostics);
    const diagnosticCodesCombined = uniqueStrings([...replayCodes, ...checkpointCodes]);
    return {
      status: diagnosticCodesCombined.length > 0 ? "inconsistent" : "consistent",
      state: replayState(replay.state.status),
      diagnosticCodes: diagnosticCodesCombined,
      pendingToolCallIds: [...replay.state.pendingToolCallIds],
      evidenceRefCount: replay.state.evidenceRefs.length,
    };
  }
  if (isReplaySummary(replay)) {
    const diagnosticCodesCombined = uniqueStrings([
      ...replay.diagnosticCodes,
      ...checkpointCodes,
    ]);
    return {
      ...stableClone(replay),
      status: diagnosticCodesCombined.length > 0 ? "inconsistent" : replay.status,
      diagnosticCodes: diagnosticCodesCombined,
      pendingToolCallIds: [...replay.pendingToolCallIds],
    };
  }
  return {
    status: checkpointCodes.length > 0 ? "inconsistent" : "not_run",
    state: "unknown",
    diagnosticCodes: uniqueStrings(checkpointCodes),
    pendingToolCallIds: [],
  };
}

function collectEvidenceRefs(
  refs: readonly EvidenceRef[] | undefined,
  source: EvidenceVerifierEvidenceSource,
  diagnostics: EvidenceVerifierCollectionDiagnostic[],
): Pick<EvidenceVerifierCollectionResult, "projectedEvidenceRefs"> & {
  authoritativeEvidenceRefs: EvidenceRef[];
} {
  const authoritativeEvidenceRefs: EvidenceRef[] = [];
  for (const ref of refs ?? []) {
    if (!isEvidenceRef(ref)) {
      diagnostics.push({
        code: "invalid_evidence_ref",
        message: "EvidenceRef input did not satisfy the runtime-core contract.",
        recoverable: true,
        source,
      });
      continue;
    }
    authoritativeEvidenceRefs.push(sanitizeEvidenceRef(ref, source));
  }
  return { authoritativeEvidenceRefs, projectedEvidenceRefs: [] };
}

function splitByAuthority(
  refs: readonly EvidenceRef[],
  source: EvidenceVerifierEvidenceSource,
  sourceProjected: boolean,
  diagnostics: EvidenceVerifierCollectionDiagnostic[],
): Pick<EvidenceVerifierCollectionResult, "projectedEvidenceRefs"> & {
  authoritativeEvidenceRefs: EvidenceRef[];
} {
  if (source !== "renderer") {
    return { authoritativeEvidenceRefs: [...refs], projectedEvidenceRefs: [] };
  }
  diagnostics.push({
    code: "untrusted_renderer_evidence",
    message: "Renderer-collected evidence is retained only as untrusted projected evidence.",
    recoverable: true,
    source: "renderer",
  });
  return {
    authoritativeEvidenceRefs: [],
    projectedEvidenceRefs: refs.map((ref) =>
      sanitizeEvidenceRef(ref, "renderer", {
        sourceProjected,
        trusted: false,
      })
    ),
  };
}

function openObligations(values: readonly string[] | undefined): EvidenceVerifierObligation[] {
  return uniqueStrings(values ?? []).map((description, index) => ({
    id: `open_obligation_${index + 1}`,
    description,
    status: "open",
  }));
}

function externalDependencyObligations(
  values: readonly EvidenceVerifierExternalDependencyInput[] | undefined,
  diagnostics: EvidenceVerifierCollectionDiagnostic[],
): EvidenceVerifierObligation[] {
  return (values ?? []).flatMap((value, index) => {
    const description = nonEmptyString(value.description);
    if (!description) return [];
    return [{
      id: nonEmptyString(value.id) ?? `external_dependency_${index + 1}`,
      description,
      status: "blocked",
      externalDependency: true,
      evidenceRefs: collectEvidenceRefs(value.evidenceRefs, "human", diagnostics)
        .authoritativeEvidenceRefs,
    }];
  });
}

function sanitizeEvidenceRef(
  ref: EvidenceRef,
  source: EvidenceVerifierEvidenceSource,
  metadata: RuntimeCoreJsonObject = {},
): EvidenceRef {
  const label = nonEmptyString(ref.label);
  const summary = nonEmptyString(ref.summary);
  return {
    type: ref.type,
    ref: ref.ref.trim().slice(0, 512),
    ...(label ? { label: label.slice(0, 128) } : {}),
    ...(summary ? { summary: summary.slice(0, 256) } : {}),
    metadata: {
      source,
      ...metadata,
    },
  };
}

function dedupeEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}\u0000${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(stableClone(ref));
  }
  return out;
}

function dedupeObligations(
  obligations: readonly EvidenceVerifierObligation[],
): EvidenceVerifierObligation[] {
  const seen = new Set<string>();
  const out: EvidenceVerifierObligation[] = [];
  for (const obligation of obligations) {
    if (seen.has(obligation.id)) continue;
    seen.add(obligation.id);
    out.push(stableClone(obligation));
  }
  return out;
}

function diagnosticCodes(
  diagnostics: readonly RuntimeTaskReplayDiagnostic[] | readonly RuntimeCheckpointSerializerDiagnostic[] | undefined,
): string[] {
  return uniqueStrings((diagnostics ?? []).map((diagnostic) => diagnostic.code));
}

function isReplayResult(value: unknown): value is RuntimeTaskReplayResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "state" in value &&
      "diagnostics" in value &&
      Array.isArray((value as RuntimeTaskReplayResult).diagnostics),
  );
}

function isReplaySummary(value: unknown): value is EvidenceVerifierEventReplaySummary {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      "diagnosticCodes" in value &&
      "pendingToolCallIds" in value &&
      Array.isArray((value as EvidenceVerifierEventReplaySummary).diagnosticCodes) &&
      Array.isArray((value as EvidenceVerifierEventReplaySummary).pendingToolCallIds),
  );
}

function replayState(value: RuntimeTaskStatus): RuntimeTaskStatus | "unknown" {
  return isRuntimeTaskStatus(value) ? value : "unknown";
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
