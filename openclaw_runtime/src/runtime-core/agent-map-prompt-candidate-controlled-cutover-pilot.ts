import {
  assembleAgentMapPromptAssemblyExperimentCandidate,
  type AgentMapPromptAssemblyExperimentCandidate,
} from "./agent-map-prompt-assembly-experiment.js";
import {
  buildAgentMapPromptCandidateRuntimeShadowReport,
  type AgentMapPromptCandidateRuntimeShadowReport,
} from "./agent-map-prompt-candidate-runtime-shadow.js";
import {
  isAgentMapResult,
  type AgentMapResult,
} from "./agent-map.js";
import type { EvidenceRef } from "./evidence.js";
import type { RuntimeCoreJsonObject } from "./types.js";

export const AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE =
  "agent_map.prompt_candidate.controlled_cutover_pilot" as const;

export type AgentMapPromptCandidateControlledCutoverStatus =
  | "legacy"
  | "inserted";

export type AgentMapPromptCandidateControlledCutoverDiagnosticCode =
  | "gate_disabled"
  | "invalid_agent_map_result"
  | "candidate_inserted"
  | "candidate_empty"
  | "candidate_budget_exhausted"
  | "prompt_present_file_excluded";

export type AgentMapPromptCandidateControlledCutoverFlags = {
  promptAssemblyExperiment: boolean;
  promptCandidateRuntimeShadow: boolean;
  promptCandidateControlledCutoverPilot: boolean;
  enabled: boolean;
};

export type AgentMapPromptCandidateControlledCutoverDiagnostic = {
  code: AgentMapPromptCandidateControlledCutoverDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapPromptCandidateControlledCutoverResult = {
  schemaVersion: 1;
  source: typeof AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE;
  status: AgentMapPromptCandidateControlledCutoverStatus;
  readonly: true;
  prompt: string;
  legacyPrompt: string;
  candidate: {
    status: AgentMapPromptAssemblyExperimentCandidate["status"] | "not_evaluated";
    sourceStatus?: AgentMapResult["status"];
    tokenBudget: number;
    tokenEstimate: number;
    contentLength: number;
    includedSymbolCount: number;
    includedFileCount: number;
    promptPresentExcludedCount: number;
    insertedIntoControlledPilotSurface: boolean;
    insertedIntoDefaultPrompt: false;
    insertedIntoTaskLoopReviewerPrompt: false;
    insertedIntoGateway: false;
    insertedIntoModelMessages: false;
    insertedIntoProviderTransport: false;
    persisted: false;
  };
  flags: AgentMapPromptCandidateControlledCutoverFlags;
  diagnostics: AgentMapPromptCandidateControlledCutoverDiagnostic[];
  runtimeShadowReport?: AgentMapPromptCandidateRuntimeShadowReport;
  evidenceRefs: EvidenceRef[];
  metadata: RuntimeCoreJsonObject & {
    controlledCutoverPilot: true;
    defaultOff: true;
    explicitAgentMapResultRequired: true;
    noDefaultPromptCutover: true;
    noTaskLoopReviewerPromptCutover: true;
    noGatewayCutover: true;
    noProviderTransportCutover: true;
    noModelMessageCutover: true;
    noRuntimeAuthority: true;
    noToolAuthority: true;
    noPersistence: true;
    legacyPromptByteIdentical: boolean;
  };
};

export type AgentMapPromptCandidateControlledCutoverInput = {
  legacyPrompt: string;
  result?: unknown;
  config?: unknown;
  tokenBudget: number;
  promptPresentFiles?: string[];
  generatedAt?: number;
};

const CONTROLLED_CUTOVER_EVIDENCE_REF: EvidenceRef = {
  type: "file",
  ref: "openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts",
  label: "AgentMap prompt candidate controlled cutover pilot",
};

const AUTHORITY_METADATA = {
  controlledCutoverPilot: true,
  defaultOff: true,
  explicitAgentMapResultRequired: true,
  noDefaultPromptCutover: true,
  noTaskLoopReviewerPromptCutover: true,
  noGatewayCutover: true,
  noProviderTransportCutover: true,
  noModelMessageCutover: true,
  noRuntimeAuthority: true,
  noToolAuthority: true,
  noPersistence: true,
} as const;

export function assembleAgentMapPromptCandidateControlledCutoverPilot(
  input: AgentMapPromptCandidateControlledCutoverInput,
): AgentMapPromptCandidateControlledCutoverResult {
  const legacyPrompt = input.legacyPrompt;
  const tokenBudget = normalizeTokenBudget(input.tokenBudget);
  const flags = resolveRuntimeAgentMapPromptCandidateControlledCutoverFlags(input.config);

  if (!flags.enabled) {
    return legacyResult({
      legacyPrompt,
      tokenBudget,
      flags,
      diagnostics: [diagnostic({
        code: "gate_disabled",
        severity: "info",
        message: "AgentMap prompt candidate controlled cutover pilot gates are disabled.",
        metadata: {
          requiredFlags: [
            "runtime.agentMap.promptAssemblyExperiment",
            "runtime.agentMap.promptCandidateRuntimeShadow",
            "runtime.agentMap.promptCandidateControlledCutoverPilot",
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
      legacyPrompt,
      tokenBudget,
      flags,
      diagnostics: [diagnostic({
        code: "invalid_agent_map_result",
        severity: "warning",
        message: "A valid explicit AgentMapResult is required for the controlled cutover pilot.",
        metadata: {
          legacyBehaviorUnaffected: true,
          ...AUTHORITY_METADATA,
        },
      })],
    });
  }

  const candidate = assembleAgentMapPromptAssemblyExperimentCandidate({
    result: input.result,
    config: input.config,
    tokenBudget,
    promptPresentFiles: input.promptPresentFiles,
  });
  const runtimeShadowReport = buildAgentMapPromptCandidateRuntimeShadowReport({
    result: input.result,
    config: input.config,
    tokenBudget,
    promptPresentFiles: input.promptPresentFiles,
    generatedAt: input.generatedAt,
    runtime: { source: "runtime", phase: "controlled_cutover_pilot" },
  });
  const diagnostics = controlledDiagnostics(candidate, flags);
  const promptPresentExcludedCount = diagnostics.filter((item) =>
    item.code === "prompt_present_file_excluded"
  ).length;

  if (candidate.status !== "success" || !candidate.content.trim()) {
    return legacyResult({
      legacyPrompt,
      tokenBudget,
      flags,
      candidate,
      runtimeShadowReport,
      diagnostics,
      promptPresentExcludedCount,
    });
  }

  const prompt = appendControlledPilotSurface(legacyPrompt, candidate.content);
  const includedFiles = new Set(candidate.includedSymbols.map((rankedTag) => rankedTag.tag.file));
  return {
    schemaVersion: 1,
    source: AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
    status: "inserted",
    readonly: true,
    prompt,
    legacyPrompt,
    candidate: {
      status: candidate.status,
      sourceStatus: input.result.status,
      tokenBudget: candidate.tokenBudget,
      tokenEstimate: candidate.tokenEstimate,
      contentLength: candidate.content.length,
      includedSymbolCount: candidate.includedSymbols.length,
      includedFileCount: includedFiles.size,
      promptPresentExcludedCount,
      insertedIntoControlledPilotSurface: true,
      insertedIntoDefaultPrompt: false,
      insertedIntoTaskLoopReviewerPrompt: false,
      insertedIntoGateway: false,
      insertedIntoModelMessages: false,
      insertedIntoProviderTransport: false,
      persisted: false,
    },
    flags,
    diagnostics,
    runtimeShadowReport,
    evidenceRefs: uniqueEvidenceRefs([
      CONTROLLED_CUTOVER_EVIDENCE_REF,
      ...candidate.evidenceRefs,
      ...runtimeShadowReport.evidenceRefs,
      ...diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: {
      ...AUTHORITY_METADATA,
      legacyPromptByteIdentical: false,
      pilotSurface: AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
      insertedIntoControlledPilotSurface: true,
      candidateTextPersisted: false,
      candidateTextInsertedIntoDefaultPrompt: false,
      candidateTextInsertedIntoGateway: false,
      candidateTextInsertedIntoModelMessages: false,
      candidateTextInsertedIntoProviderTransport: false,
    },
  };
}

export function resolveRuntimeAgentMapPromptCandidateControlledCutoverFlags(
  value: unknown,
): AgentMapPromptCandidateControlledCutoverFlags {
  const runtime = runtimeConfigFrom(value);
  const agentMap = recordFrom(runtime?.agentMap);
  const promptAssemblyExperiment = agentMap.promptAssemblyExperiment === true;
  const promptCandidateRuntimeShadow = agentMap.promptCandidateRuntimeShadow === true;
  const promptCandidateControlledCutoverPilot =
    agentMap.promptCandidateControlledCutoverPilot === true;
  return {
    promptAssemblyExperiment,
    promptCandidateRuntimeShadow,
    promptCandidateControlledCutoverPilot,
    enabled:
      promptAssemblyExperiment &&
      promptCandidateRuntimeShadow &&
      promptCandidateControlledCutoverPilot,
  };
}

function controlledDiagnostics(
  candidate: AgentMapPromptAssemblyExperimentCandidate,
  flags: AgentMapPromptCandidateControlledCutoverFlags,
): AgentMapPromptCandidateControlledCutoverDiagnostic[] {
  const base = diagnostic({
    code: candidate.status === "success"
      ? "candidate_inserted"
      : candidate.status === "empty"
        ? "candidate_empty"
        : "candidate_budget_exhausted",
    severity: candidate.status === "success" ? "info" : "warning",
    message: candidate.status === "success"
      ? "AgentMap prompt candidate entered the controlled pilot surface."
      : "AgentMap prompt candidate was excluded from the controlled pilot surface.",
    metadata: {
      flags,
      status: candidate.status,
      tokenBudget: candidate.tokenBudget,
      tokenEstimate: candidate.tokenEstimate,
      includedSymbolCount: candidate.includedSymbols.length,
      failClosed: candidate.status !== "success",
      ...AUTHORITY_METADATA,
    },
  });
  return [
    base,
    ...candidate.diagnostics.flatMap((item) => {
      const code = controlledDiagnosticCode(item.code);
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
          ...AUTHORITY_METADATA,
        },
      })];
    }),
  ];
}

function controlledDiagnosticCode(
  code: AgentMapPromptAssemblyExperimentCandidate["diagnostics"][number]["code"],
): AgentMapPromptCandidateControlledCutoverDiagnosticCode | undefined {
  switch (code) {
    case "prompt_present_file_excluded":
      return "prompt_present_file_excluded";
    case "budget_exhausted":
      return "candidate_budget_exhausted";
    case "empty_candidate_set":
      return "candidate_empty";
    case "flag_disabled":
      return "gate_disabled";
  }
}

function legacyResult(params: {
  legacyPrompt: string;
  tokenBudget: number;
  flags: AgentMapPromptCandidateControlledCutoverFlags;
  diagnostics: AgentMapPromptCandidateControlledCutoverDiagnostic[];
  candidate?: AgentMapPromptAssemblyExperimentCandidate;
  runtimeShadowReport?: AgentMapPromptCandidateRuntimeShadowReport;
  promptPresentExcludedCount?: number;
}): AgentMapPromptCandidateControlledCutoverResult {
  const candidate = params.candidate;
  const includedFiles = new Set(candidate?.includedSymbols.map((rankedTag) => rankedTag.tag.file) ?? []);
  return {
    schemaVersion: 1,
    source: AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
    status: "legacy",
    readonly: true,
    prompt: params.legacyPrompt,
    legacyPrompt: params.legacyPrompt,
    candidate: {
      status: candidate?.status ?? "not_evaluated",
      sourceStatus: params.runtimeShadowReport?.candidate.sourceStatus,
      tokenBudget: candidate?.tokenBudget ?? params.tokenBudget,
      tokenEstimate: candidate?.tokenEstimate ?? 0,
      contentLength: 0,
      includedSymbolCount: candidate?.includedSymbols.length ?? 0,
      includedFileCount: includedFiles.size,
      promptPresentExcludedCount: params.promptPresentExcludedCount ?? 0,
      insertedIntoControlledPilotSurface: false,
      insertedIntoDefaultPrompt: false,
      insertedIntoTaskLoopReviewerPrompt: false,
      insertedIntoGateway: false,
      insertedIntoModelMessages: false,
      insertedIntoProviderTransport: false,
      persisted: false,
    },
    flags: params.flags,
    diagnostics: params.diagnostics,
    ...(params.runtimeShadowReport ? { runtimeShadowReport: params.runtimeShadowReport } : {}),
    evidenceRefs: uniqueEvidenceRefs([
      CONTROLLED_CUTOVER_EVIDENCE_REF,
      ...(candidate?.evidenceRefs ?? []),
      ...(params.runtimeShadowReport?.evidenceRefs ?? []),
      ...params.diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: {
      ...AUTHORITY_METADATA,
      legacyPromptByteIdentical: true,
      pilotSurface: AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
      insertedIntoControlledPilotSurface: false,
      failClosed: true,
      candidateTextPersisted: false,
      candidateTextInsertedIntoDefaultPrompt: false,
      candidateTextInsertedIntoGateway: false,
      candidateTextInsertedIntoModelMessages: false,
      candidateTextInsertedIntoProviderTransport: false,
    },
  };
}

function appendControlledPilotSurface(
  legacyPrompt: string,
  candidateContent: string,
): string {
  const suffix = [
    "",
    "",
    "## AgentMap controlled prompt candidate pilot",
    "surface: agent_map.prompt_candidate.controlled_cutover_pilot",
    "authority: non-authoritative",
    candidateContent.trimEnd(),
  ].join("\n");
  return `${legacyPrompt}${suffix}`;
}

function diagnostic(params: {
  code: AgentMapPromptCandidateControlledCutoverDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): AgentMapPromptCandidateControlledCutoverDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.file ? { file: params.file } : {}),
    evidenceRefs: uniqueEvidenceRefs([
      CONTROLLED_CUTOVER_EVIDENCE_REF,
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
