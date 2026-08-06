import {
  AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
  assembleAgentMapPromptCandidateControlledCutoverPilot,
  type AgentMapPromptCandidateControlledCutoverDiagnostic,
  type AgentMapPromptCandidateControlledCutoverResult,
} from "./agent-map-prompt-candidate-controlled-cutover-pilot.js";
import {
  isAgentMapResult,
  type AgentMapResult,
} from "./agent-map.js";
import type { EvidenceRef } from "./evidence.js";
import type { RuntimeCoreJsonObject } from "./types.js";

export const AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE =
  "agent_map.prompt_candidate.taskloop_explicit_invocation_pilot" as const;

export type AgentMapPromptCandidateTaskLoopExplicitInvocationStatus =
  | "legacy"
  | "inserted";

export type AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnosticCode =
  | "gate_disabled"
  | "invocation_not_requested"
  | "invalid_agent_map_result"
  | "candidate_inserted"
  | "candidate_empty"
  | "candidate_budget_exhausted"
  | "prompt_present_file_excluded";

export type AgentMapPromptCandidateTaskLoopExplicitInvocationFlags = {
  promptAssemblyExperiment: boolean;
  promptCandidateRuntimeShadow: boolean;
  promptCandidateControlledCutoverPilot: boolean;
  promptCandidateTaskLoopExplicitInvocationPilot: boolean;
  enabled: boolean;
};

export type AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnostic = {
  code: AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapPromptCandidateTaskLoopExplicitInvocationResult = {
  schemaVersion: 1;
  source: typeof AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE;
  status: AgentMapPromptCandidateTaskLoopExplicitInvocationStatus;
  readonly: true;
  reviewerPrompt: string;
  legacyReviewerPrompt: string;
  explicitInvocation: boolean;
  candidate: {
    status: AgentMapPromptCandidateControlledCutoverResult["candidate"]["status"];
    sourceStatus?: AgentMapResult["status"];
    tokenBudget: number;
    tokenEstimate: number;
    contentLength: number;
    includedSymbolCount: number;
    includedFileCount: number;
    promptPresentExcludedCount: number;
    insertedIntoTaskLoopPilotSurface: boolean;
    insertedIntoDefaultPrompt: false;
    insertedIntoDefaultTaskLoopReviewerPrompt: false;
    insertedIntoGateway: false;
    insertedIntoModelMessages: false;
    insertedIntoProviderTransport: false;
    insertedIntoCheckpointPayload: false;
    insertedIntoLifecyclePayload: false;
    persisted: false;
  };
  flags: AgentMapPromptCandidateTaskLoopExplicitInvocationFlags;
  controlledCutoverPilot?: AgentMapPromptCandidateControlledCutoverResult;
  diagnostics: AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnostic[];
  evidenceRefs: EvidenceRef[];
  metadata: RuntimeCoreJsonObject & {
    taskLoopExplicitInvocationPilot: true;
    defaultOff: true;
    explicitInvocationRequired: true;
    explicitAgentMapResultRequired: true;
    noDefaultPromptCutover: true;
    noDefaultTaskLoopReviewerPromptCutover: true;
    noGatewayCutover: true;
    noProviderTransportCutover: true;
    noModelMessageCutover: true;
    noCheckpointPayloadCutover: true;
    noLifecyclePayloadCutover: true;
    noRuntimeAuthority: true;
    noToolAuthority: true;
    noPersistence: true;
    legacyReviewerPromptByteIdentical: boolean;
  };
};

export type AgentMapPromptCandidateTaskLoopExplicitInvocationInput = {
  legacyReviewerPrompt: string;
  explicitInvocation: boolean;
  result?: unknown;
  config?: unknown;
  tokenBudget: number;
  promptPresentFiles?: string[];
  generatedAt?: number;
};

const TASKLOOP_PILOT_EVIDENCE_REF: EvidenceRef = {
  type: "file",
  ref:
    "openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts",
  label: "AgentMap prompt candidate TaskLoop explicit invocation pilot",
};

const AUTHORITY_METADATA = {
  taskLoopExplicitInvocationPilot: true,
  defaultOff: true,
  explicitInvocationRequired: true,
  explicitAgentMapResultRequired: true,
  noDefaultPromptCutover: true,
  noDefaultTaskLoopReviewerPromptCutover: true,
  noGatewayCutover: true,
  noProviderTransportCutover: true,
  noModelMessageCutover: true,
  noCheckpointPayloadCutover: true,
  noLifecyclePayloadCutover: true,
  noRuntimeAuthority: true,
  noToolAuthority: true,
  noPersistence: true,
} as const;

export function assembleAgentMapPromptCandidateTaskLoopExplicitInvocationPilot(
  input: AgentMapPromptCandidateTaskLoopExplicitInvocationInput,
): AgentMapPromptCandidateTaskLoopExplicitInvocationResult {
  const legacyReviewerPrompt = input.legacyReviewerPrompt;
  const tokenBudget = normalizeTokenBudget(input.tokenBudget);
  const flags = resolveRuntimeAgentMapPromptCandidateTaskLoopExplicitInvocationFlags(
    input.config,
  );

  if (!input.explicitInvocation) {
    return legacyResult({
      legacyReviewerPrompt,
      tokenBudget,
      explicitInvocation: false,
      flags,
      diagnostics: [diagnostic({
        code: "invocation_not_requested",
        severity: "info",
        message:
          "AgentMap prompt candidate TaskLoop explicit invocation pilot was not requested.",
        metadata: {
          flags,
          legacyBehaviorUnaffected: true,
          ...AUTHORITY_METADATA,
        },
      })],
    });
  }

  if (!flags.enabled) {
    return legacyResult({
      legacyReviewerPrompt,
      tokenBudget,
      explicitInvocation: true,
      flags,
      diagnostics: [diagnostic({
        code: "gate_disabled",
        severity: "info",
        message:
          "AgentMap prompt candidate TaskLoop explicit invocation pilot gates are disabled.",
        metadata: {
          requiredFlags: [
            "runtime.agentMap.promptAssemblyExperiment",
            "runtime.agentMap.promptCandidateRuntimeShadow",
            "runtime.agentMap.promptCandidateControlledCutoverPilot",
            "runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot",
          ],
          flags,
          legacyBehaviorUnaffected: true,
          ...AUTHORITY_METADATA,
        },
      })],
    });
  }

  if (!isAgentMapResult(input.result)) {
    return legacyResult({
      legacyReviewerPrompt,
      tokenBudget,
      explicitInvocation: true,
      flags,
      diagnostics: [diagnostic({
        code: "invalid_agent_map_result",
        severity: "warning",
        message:
          "A valid explicit AgentMapResult is required for the TaskLoop explicit invocation pilot.",
        metadata: {
          flags,
          legacyBehaviorUnaffected: true,
          ...AUTHORITY_METADATA,
        },
      })],
    });
  }

  const controlledCutoverPilot = assembleAgentMapPromptCandidateControlledCutoverPilot({
    legacyPrompt: "",
    result: input.result,
    config: input.config,
    tokenBudget,
    promptPresentFiles: input.promptPresentFiles,
    generatedAt: input.generatedAt,
  });
  const diagnostics = taskLoopDiagnostics(controlledCutoverPilot, flags);

  if (controlledCutoverPilot.status !== "inserted") {
    return legacyResult({
      legacyReviewerPrompt,
      tokenBudget,
      explicitInvocation: true,
      flags,
      controlledCutoverPilot,
      diagnostics,
    });
  }

  const reviewerPrompt = appendTaskLoopPilotSurface({
    legacyReviewerPrompt,
    controlledPrompt: controlledCutoverPilot.prompt,
  });

  return {
    schemaVersion: 1,
    source: AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE,
    status: "inserted",
    readonly: true,
    reviewerPrompt,
    legacyReviewerPrompt,
    explicitInvocation: true,
    candidate: {
      status: controlledCutoverPilot.candidate.status,
      sourceStatus: controlledCutoverPilot.candidate.sourceStatus,
      tokenBudget: controlledCutoverPilot.candidate.tokenBudget,
      tokenEstimate: controlledCutoverPilot.candidate.tokenEstimate,
      contentLength: controlledCutoverPilot.candidate.contentLength,
      includedSymbolCount: controlledCutoverPilot.candidate.includedSymbolCount,
      includedFileCount: controlledCutoverPilot.candidate.includedFileCount,
      promptPresentExcludedCount:
        controlledCutoverPilot.candidate.promptPresentExcludedCount,
      insertedIntoTaskLoopPilotSurface: true,
      insertedIntoDefaultPrompt: false,
      insertedIntoDefaultTaskLoopReviewerPrompt: false,
      insertedIntoGateway: false,
      insertedIntoModelMessages: false,
      insertedIntoProviderTransport: false,
      insertedIntoCheckpointPayload: false,
      insertedIntoLifecyclePayload: false,
      persisted: false,
    },
    flags,
    controlledCutoverPilot,
    diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      TASKLOOP_PILOT_EVIDENCE_REF,
      ...controlledCutoverPilot.evidenceRefs,
      ...diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: {
      ...AUTHORITY_METADATA,
      legacyReviewerPromptByteIdentical: false,
      pilotSurface:
        AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE,
      upstreamPilotSurface: AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
      insertedIntoTaskLoopPilotSurface: true,
      candidateTextPersisted: false,
      candidateTextInsertedIntoDefaultPrompt: false,
      candidateTextInsertedIntoDefaultTaskLoopReviewerPrompt: false,
      candidateTextInsertedIntoGateway: false,
      candidateTextInsertedIntoModelMessages: false,
      candidateTextInsertedIntoProviderTransport: false,
      candidateTextInsertedIntoCheckpointPayload: false,
      candidateTextInsertedIntoLifecyclePayload: false,
    },
  };
}

export function resolveRuntimeAgentMapPromptCandidateTaskLoopExplicitInvocationFlags(
  value: unknown,
): AgentMapPromptCandidateTaskLoopExplicitInvocationFlags {
  const runtime = runtimeConfigFrom(value);
  const agentMap = recordFrom(runtime?.agentMap);
  const promptAssemblyExperiment = agentMap.promptAssemblyExperiment === true;
  const promptCandidateRuntimeShadow = agentMap.promptCandidateRuntimeShadow === true;
  const promptCandidateControlledCutoverPilot =
    agentMap.promptCandidateControlledCutoverPilot === true;
  const promptCandidateTaskLoopExplicitInvocationPilot =
    agentMap.promptCandidateTaskLoopExplicitInvocationPilot === true;
  return {
    promptAssemblyExperiment,
    promptCandidateRuntimeShadow,
    promptCandidateControlledCutoverPilot,
    promptCandidateTaskLoopExplicitInvocationPilot,
    enabled:
      promptAssemblyExperiment &&
      promptCandidateRuntimeShadow &&
      promptCandidateControlledCutoverPilot &&
      promptCandidateTaskLoopExplicitInvocationPilot,
  };
}

function taskLoopDiagnostics(
  controlledCutoverPilot: AgentMapPromptCandidateControlledCutoverResult,
  flags: AgentMapPromptCandidateTaskLoopExplicitInvocationFlags,
): AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnostic[] {
  const base = diagnostic({
    code: controlledCutoverPilot.status === "inserted"
      ? "candidate_inserted"
      : controlledCutoverPilot.candidate.status === "empty"
        ? "candidate_empty"
        : controlledCutoverPilot.candidate.status === "budget_exhausted"
          ? "candidate_budget_exhausted"
          : "gate_disabled",
    severity: controlledCutoverPilot.status === "inserted" ? "info" : "warning",
    message: controlledCutoverPilot.status === "inserted"
      ? "AgentMap prompt candidate entered the TaskLoop explicit invocation pilot surface."
      : "AgentMap prompt candidate was excluded from the TaskLoop explicit invocation pilot surface.",
    metadata: {
      flags,
      status: controlledCutoverPilot.candidate.status,
      tokenBudget: controlledCutoverPilot.candidate.tokenBudget,
      tokenEstimate: controlledCutoverPilot.candidate.tokenEstimate,
      includedSymbolCount: controlledCutoverPilot.candidate.includedSymbolCount,
      failClosed: controlledCutoverPilot.status !== "inserted",
      ...AUTHORITY_METADATA,
    },
  });
  return [
    base,
    ...controlledCutoverPilot.diagnostics.map((item) =>
      mapControlledDiagnostic(item, flags)
    ),
  ];
}

function mapControlledDiagnostic(
  item: AgentMapPromptCandidateControlledCutoverDiagnostic,
  flags: AgentMapPromptCandidateTaskLoopExplicitInvocationFlags,
): AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnostic {
  return diagnostic({
    code: taskLoopDiagnosticCode(item.code),
    severity: item.severity,
    message: item.message,
    file: item.file,
    evidenceRefs: item.evidenceRefs,
    metadata: {
      ...item.metadata,
      flags,
      ...AUTHORITY_METADATA,
    },
  });
}

function taskLoopDiagnosticCode(
  code: AgentMapPromptCandidateControlledCutoverDiagnostic["code"],
): AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnosticCode {
  switch (code) {
    case "gate_disabled":
      return "gate_disabled";
    case "invalid_agent_map_result":
      return "invalid_agent_map_result";
    case "candidate_inserted":
      return "candidate_inserted";
    case "candidate_empty":
      return "candidate_empty";
    case "candidate_budget_exhausted":
      return "candidate_budget_exhausted";
    case "prompt_present_file_excluded":
      return "prompt_present_file_excluded";
  }
}

function legacyResult(params: {
  legacyReviewerPrompt: string;
  tokenBudget: number;
  explicitInvocation: boolean;
  flags: AgentMapPromptCandidateTaskLoopExplicitInvocationFlags;
  diagnostics: AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnostic[];
  controlledCutoverPilot?: AgentMapPromptCandidateControlledCutoverResult;
}): AgentMapPromptCandidateTaskLoopExplicitInvocationResult {
  const controlled = params.controlledCutoverPilot;
  return {
    schemaVersion: 1,
    source: AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE,
    status: "legacy",
    readonly: true,
    reviewerPrompt: params.legacyReviewerPrompt,
    legacyReviewerPrompt: params.legacyReviewerPrompt,
    explicitInvocation: params.explicitInvocation,
    candidate: {
      status: controlled?.candidate.status ?? "not_evaluated",
      sourceStatus: controlled?.candidate.sourceStatus,
      tokenBudget: controlled?.candidate.tokenBudget ?? params.tokenBudget,
      tokenEstimate: controlled?.candidate.tokenEstimate ?? 0,
      contentLength: 0,
      includedSymbolCount: controlled?.candidate.includedSymbolCount ?? 0,
      includedFileCount: controlled?.candidate.includedFileCount ?? 0,
      promptPresentExcludedCount:
        controlled?.candidate.promptPresentExcludedCount ?? 0,
      insertedIntoTaskLoopPilotSurface: false,
      insertedIntoDefaultPrompt: false,
      insertedIntoDefaultTaskLoopReviewerPrompt: false,
      insertedIntoGateway: false,
      insertedIntoModelMessages: false,
      insertedIntoProviderTransport: false,
      insertedIntoCheckpointPayload: false,
      insertedIntoLifecyclePayload: false,
      persisted: false,
    },
    flags: params.flags,
    ...(controlled ? { controlledCutoverPilot: controlled } : {}),
    diagnostics: params.diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      TASKLOOP_PILOT_EVIDENCE_REF,
      ...(controlled?.evidenceRefs ?? []),
      ...params.diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: {
      ...AUTHORITY_METADATA,
      legacyReviewerPromptByteIdentical: true,
      pilotSurface:
        AGENT_MAP_PROMPT_CANDIDATE_TASKLOOP_EXPLICIT_INVOCATION_SURFACE,
      insertedIntoTaskLoopPilotSurface: false,
      failClosed: true,
      candidateTextPersisted: false,
      candidateTextInsertedIntoDefaultPrompt: false,
      candidateTextInsertedIntoDefaultTaskLoopReviewerPrompt: false,
      candidateTextInsertedIntoGateway: false,
      candidateTextInsertedIntoModelMessages: false,
      candidateTextInsertedIntoProviderTransport: false,
      candidateTextInsertedIntoCheckpointPayload: false,
      candidateTextInsertedIntoLifecyclePayload: false,
    },
  };
}

function appendTaskLoopPilotSurface(input: {
  legacyReviewerPrompt: string;
  controlledPrompt: string;
}): string {
  const suffix = [
    "",
    "",
    "## AgentMap TaskLoop explicit invocation prompt candidate pilot",
    "surface: agent_map.prompt_candidate.taskloop_explicit_invocation_pilot",
    "authority: non-authoritative",
    "defaultTaskLoopReviewerPrompt: unchanged",
    input.controlledPrompt.trim(),
  ].join("\n");
  return `${input.legacyReviewerPrompt}${suffix}`;
}

function diagnostic(params: {
  code: AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): AgentMapPromptCandidateTaskLoopExplicitInvocationDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.file ? { file: params.file } : {}),
    evidenceRefs: uniqueEvidenceRefs([
      TASKLOOP_PILOT_EVIDENCE_REF,
      ...(params.evidenceRefs ?? []),
    ]),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function normalizeTokenBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = recordFrom(value);
  const directRuntime = recordFrom(record.runtime);
  if (Object.keys(directRuntime).length > 0) {
    return directRuntime;
  }
  const config = recordFrom(record.config);
  const configRuntime = recordFrom(config.runtime);
  return Object.keys(configRuntime).length > 0 ? configRuntime : undefined;
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}:${ref.label ?? ""}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [ref];
  });
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
