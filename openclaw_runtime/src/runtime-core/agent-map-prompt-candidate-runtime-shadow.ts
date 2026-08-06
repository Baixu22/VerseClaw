import { createHash } from "node:crypto";
import {
  assembleAgentMapPromptAssemblyExperimentCandidate,
  type AgentMapPromptAssemblyExperimentCandidate,
} from "./agent-map-prompt-assembly-experiment.js";
import type {
  AgentMapResult,
  AgentMapResultStatus,
} from "./agent-map.js";
import type { EvidenceRef } from "./evidence.js";
import type { RuntimeCoreJsonObject } from "./types.js";

export type AgentMapPromptCandidateRuntimeShadowStatus =
  | "disabled"
  | "success"
  | "empty"
  | "budget_exhausted";

export type AgentMapPromptCandidateRuntimeShadowDiagnosticCode =
  | "flag_disabled"
  | "candidate_measured"
  | "candidate_empty"
  | "candidate_budget_exhausted"
  | "prompt_present_file_excluded";

export type AgentMapPromptCandidateRuntimeShadowFlags = {
  promptAssemblyExperiment: boolean;
  promptCandidateRuntimeShadow: boolean;
  enabled: boolean;
};

export type AgentMapPromptCandidateRuntimeShadowRuntimeMetadata = {
  source: "runtime" | "task_loop";
  loopRunId?: string;
  sessionKey?: string;
  phase?: string;
  status?: string;
  iteration?: number;
  contextPackHash?: string;
};

export type AgentMapPromptCandidateRuntimeShadowDiagnostic = {
  code: AgentMapPromptCandidateRuntimeShadowDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapPromptCandidateRuntimeShadowReport = {
  schemaVersion: 1;
  source: "agent_map.prompt_candidate.runtime_shadow";
  status: AgentMapPromptCandidateRuntimeShadowStatus;
  mode: "diagnostic";
  readonly: true;
  generatedAt: number;
  flags: AgentMapPromptCandidateRuntimeShadowFlags;
  runtime: AgentMapPromptCandidateRuntimeShadowRuntimeMetadata;
  candidate: {
    status: AgentMapPromptAssemblyExperimentCandidate["status"];
    sourceStatus: AgentMapResultStatus;
    tokenBudget: number;
    tokenEstimate: number;
    contentHash: string;
    contentLength: number;
    includedSymbolCount: number;
    includedFileCount: number;
    promptPresentExcludedCount: number;
    diagnosticCount: number;
    candidateTextStored: false;
    candidateTextInsertedIntoPrompt: false;
  };
  authority: {
    noPromptCutover: true;
    noPromptAuthority: true;
    noToolAuthority: true;
    noRuntimeAuthority: true;
    noGatewayCutover: true;
    noProviderTransportCutover: true;
    noModelMessageCutover: true;
    legacyPromptAuthoritative: true;
    taskLoopDecisionUnaffected: true;
  };
  diagnostics: AgentMapPromptCandidateRuntimeShadowDiagnostic[];
  evidenceRefs: EvidenceRef[];
  metadata: RuntimeCoreJsonObject;
};

export type AgentMapPromptCandidateRuntimeShadowInput = {
  result: AgentMapResult;
  config?: unknown;
  tokenBudget: number;
  promptPresentFiles?: string[];
  generatedAt?: number;
  runtime: AgentMapPromptCandidateRuntimeShadowRuntimeMetadata;
};

const RUNTIME_SHADOW_EVIDENCE_REF: EvidenceRef = {
  type: "file",
  ref: "openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts",
  label: "AgentMap prompt candidate runtime shadow adapter",
};

const AUTHORITY_FLAGS = {
  noPromptCutover: true,
  noPromptAuthority: true,
  noToolAuthority: true,
  noRuntimeAuthority: true,
  noGatewayCutover: true,
  noProviderTransportCutover: true,
  noModelMessageCutover: true,
  legacyPromptAuthoritative: true,
  taskLoopDecisionUnaffected: true,
} as const;

export function buildAgentMapPromptCandidateRuntimeShadowReport(
  input: AgentMapPromptCandidateRuntimeShadowInput,
): AgentMapPromptCandidateRuntimeShadowReport {
  const flags = resolveRuntimeAgentMapPromptCandidateRuntimeShadowFlags(input.config);
  const candidate = flags.enabled
    ? assembleAgentMapPromptAssemblyExperimentCandidate({
        result: input.result,
        config: input.config,
        tokenBudget: input.tokenBudget,
        promptPresentFiles: input.promptPresentFiles,
      })
    : assembleAgentMapPromptAssemblyExperimentCandidate({
        result: input.result,
        config: {},
        tokenBudget: input.tokenBudget,
        promptPresentFiles: input.promptPresentFiles,
      });
  const diagnostics = runtimeShadowDiagnostics(candidate, flags);
  const promptPresentExcludedCount = diagnostics.filter((diagnostic) =>
    diagnostic.code === "prompt_present_file_excluded"
  ).length;
  const includedFiles = new Set(candidate.includedSymbols.map((rankedTag) => rankedTag.tag.file));

  return {
    schemaVersion: 1,
    source: "agent_map.prompt_candidate.runtime_shadow",
    status: runtimeShadowStatus(candidate.status),
    mode: "diagnostic",
    readonly: true,
    generatedAt: normalizeTimestamp(input.generatedAt),
    flags,
    runtime: normalizeRuntimeMetadata(input.runtime),
    candidate: {
      status: candidate.status,
      sourceStatus: input.result.status,
      tokenBudget: candidate.tokenBudget,
      tokenEstimate: candidate.tokenEstimate,
      contentHash: digest(candidate.content),
      contentLength: candidate.content.length,
      includedSymbolCount: candidate.includedSymbols.length,
      includedFileCount: includedFiles.size,
      promptPresentExcludedCount,
      diagnosticCount: diagnostics.length,
      candidateTextStored: false,
      candidateTextInsertedIntoPrompt: false,
    },
    authority: AUTHORITY_FLAGS,
    diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      RUNTIME_SHADOW_EVIDENCE_REF,
      ...candidate.evidenceRefs,
      ...diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs),
    ]),
    metadata: {
      experimental: true,
      readonlyAgentMap: true,
      defaultOff: true,
      optIn: flags.enabled,
      candidateTextMeasuredOnly: true,
      candidateTextStored: false,
      candidateTextInsertedIntoPrompt: false,
      promptPresentExcludedCount,
      includedSymbolCount: candidate.includedSymbols.length,
      includedFileCount: includedFiles.size,
      tokenBudget: candidate.tokenBudget,
      tokenEstimate: candidate.tokenEstimate,
      ...AUTHORITY_FLAGS,
    },
  };
}

export function resolveRuntimeAgentMapPromptCandidateRuntimeShadowFlags(
  value: unknown,
): AgentMapPromptCandidateRuntimeShadowFlags {
  const runtime = runtimeConfigFrom(value);
  const agentMap = recordFrom(runtime?.agentMap);
  const promptAssemblyExperiment = agentMap.promptAssemblyExperiment === true;
  const promptCandidateRuntimeShadow = agentMap.promptCandidateRuntimeShadow === true;
  return {
    promptAssemblyExperiment,
    promptCandidateRuntimeShadow,
    enabled: promptAssemblyExperiment && promptCandidateRuntimeShadow,
  };
}

function runtimeShadowDiagnostics(
  candidate: AgentMapPromptAssemblyExperimentCandidate,
  flags: AgentMapPromptCandidateRuntimeShadowFlags,
): AgentMapPromptCandidateRuntimeShadowDiagnostic[] {
  if (!flags.enabled) {
    return [
      diagnostic({
        code: "flag_disabled",
        severity: "info",
        message: "AgentMap prompt candidate runtime shadow flags are disabled.",
        metadata: {
          requiredFlags: [
            "runtime.agentMap.promptAssemblyExperiment",
            "runtime.agentMap.promptCandidateRuntimeShadow",
          ],
          flags,
          ...AUTHORITY_FLAGS,
        },
      }),
    ];
  }

  const mapped = candidate.diagnostics.flatMap((item) => {
    const code = runtimeDiagnosticCode(item.code);
    if (!code) return [];
    return [diagnostic({
      code,
      severity: item.severity,
      message: item.message,
      file: item.file,
      evidenceRefs: item.evidenceRefs,
      metadata: {
        ...item.metadata,
        flags,
        ...AUTHORITY_FLAGS,
      },
    })];
  });

  return [
    diagnostic({
      code: candidate.status === "success"
        ? "candidate_measured"
        : candidate.status === "empty"
          ? "candidate_empty"
          : "candidate_budget_exhausted",
      severity: candidate.status === "success" ? "info" : "warning",
      message: "AgentMap prompt candidate was measured for runtime shadow diagnostics only.",
      metadata: {
        flags,
        status: candidate.status,
        tokenBudget: candidate.tokenBudget,
        tokenEstimate: candidate.tokenEstimate,
        includedSymbolCount: candidate.includedSymbols.length,
        ...AUTHORITY_FLAGS,
      },
    }),
    ...mapped,
  ];
}

function runtimeDiagnosticCode(
  code: AgentMapPromptAssemblyExperimentCandidate["diagnostics"][number]["code"],
): AgentMapPromptCandidateRuntimeShadowDiagnosticCode | undefined {
  switch (code) {
    case "prompt_present_file_excluded":
      return "prompt_present_file_excluded";
    case "budget_exhausted":
      return "candidate_budget_exhausted";
    case "empty_candidate_set":
      return "candidate_empty";
    case "flag_disabled":
      return undefined;
  }
}

function runtimeShadowStatus(
  status: AgentMapPromptAssemblyExperimentCandidate["status"],
): AgentMapPromptCandidateRuntimeShadowStatus {
  switch (status) {
    case "disabled":
    case "success":
    case "empty":
    case "budget_exhausted":
      return status;
  }
}

function diagnostic(params: {
  code: AgentMapPromptCandidateRuntimeShadowDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): AgentMapPromptCandidateRuntimeShadowDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.file ? { file: params.file } : {}),
    evidenceRefs: uniqueEvidenceRefs([
      RUNTIME_SHADOW_EVIDENCE_REF,
      ...(params.evidenceRefs ?? []),
    ]),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function normalizeRuntimeMetadata(
  runtime: AgentMapPromptCandidateRuntimeShadowRuntimeMetadata,
): AgentMapPromptCandidateRuntimeShadowRuntimeMetadata {
  return {
    source: runtime.source,
    ...(runtime.loopRunId ? { loopRunId: runtime.loopRunId } : {}),
    ...(runtime.sessionKey ? { sessionKey: runtime.sessionKey } : {}),
    ...(runtime.phase ? { phase: runtime.phase } : {}),
    ...(runtime.status ? { status: runtime.status } : {}),
    ...(typeof runtime.iteration === "number" && Number.isFinite(runtime.iteration)
      ? { iteration: Math.floor(runtime.iteration) }
      : {}),
    ...(runtime.contextPackHash ? { contextPackHash: runtime.contextPackHash } : {}),
  };
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

function normalizeTimestamp(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function digest(content: string): string {
  if (!content) {
    return "";
  }
  return createHash("sha256").update(content).digest("hex");
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
