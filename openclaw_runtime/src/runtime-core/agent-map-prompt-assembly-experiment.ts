import type {
  AgentMapRankedTag,
  AgentMapResult,
} from "./agent-map.js";
import type { EvidenceRef } from "./evidence.js";
import type { RuntimeCoreJsonObject } from "./types.js";

export type AgentMapPromptAssemblyExperimentStatus =
  | "disabled"
  | "success"
  | "empty"
  | "budget_exhausted";

export type AgentMapPromptAssemblyExperimentDiagnosticCode =
  | "flag_disabled"
  | "prompt_present_file_excluded"
  | "budget_exhausted"
  | "empty_candidate_set";

export type AgentMapPromptAssemblyExperimentDiagnostic = {
  code: AgentMapPromptAssemblyExperimentDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapPromptAssemblyExperimentInput = {
  result: AgentMapResult;
  config?: unknown;
  tokenBudget: number;
  promptPresentFiles?: string[];
};

export type AgentMapPromptAssemblyExperimentCandidate = {
  schemaVersion: 1;
  status: AgentMapPromptAssemblyExperimentStatus;
  readonly: true;
  content: string;
  tokenBudget: number;
  tokenEstimate: number;
  includedSymbols: AgentMapRankedTag[];
  diagnostics: AgentMapPromptAssemblyExperimentDiagnostic[];
  evidenceRefs: EvidenceRef[];
  metadata: RuntimeCoreJsonObject & {
    experimental: true;
    readonlyAgentMap: true;
    defaultOff: true;
    optIn: boolean;
    noPromptCutover: true;
    noPromptAuthority: true;
    noToolAuthority: true;
    noRuntimeAuthority: true;
    legacyPromptAuthoritative: true;
  };
};

const EXPERIMENT_EVIDENCE_REF: EvidenceRef = {
  type: "file",
  ref: "openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts",
  label: "AgentMap prompt assembly experiment helper",
};

const METADATA_BASE = {
  experimental: true,
  readonlyAgentMap: true,
  defaultOff: true,
  noPromptCutover: true,
  noPromptAuthority: true,
  noToolAuthority: true,
  noRuntimeAuthority: true,
  legacyPromptAuthoritative: true,
} as const;

export function assembleAgentMapPromptAssemblyExperimentCandidate(
  input: AgentMapPromptAssemblyExperimentInput,
): AgentMapPromptAssemblyExperimentCandidate {
  const tokenBudget = normalizeTokenBudget(input.tokenBudget);
  const optIn = resolveRuntimeAgentMapPromptAssemblyExperimentFlag(input.config);
  if (!optIn) {
    return candidate({
      status: "disabled",
      content: "",
      tokenBudget,
      tokenEstimate: 0,
      includedSymbols: [],
      diagnostics: [diagnostic({
        code: "flag_disabled",
        severity: "info",
        message: "AgentMap prompt assembly experiment flag is disabled.",
        metadata: {
          requiredFlag: "runtime.agentMap.promptAssemblyExperiment",
          legacyBehaviorUnaffected: true,
          ...METADATA_BASE,
        },
      })],
      evidenceRefs: [],
      optIn: false,
      source: input.result,
    });
  }

  const promptPresentFiles = promptPresentFileSet(input);
  const diagnostics = promptPresentExclusionDiagnostics(input.result, promptPresentFiles);
  const eligibleSymbols = input.result.includedSymbols
    .filter((rankedTag) => !promptPresentFiles.has(normalizePath(rankedTag.tag.file)))
    .sort(compareRankedTagsForPromptCandidate);
  const rendered = fitCompleteSymbolBlocksToBudget({
    result: input.result,
    rankedTags: eligibleSymbols,
    tokenBudget,
  });
  const tokenEstimate = estimateTokens(rendered.content);

  if (eligibleSymbols.length === 0) {
    diagnostics.push(diagnostic({
      code: "empty_candidate_set",
      severity: "warning",
      message: "No AgentMap symbols were eligible for the prompt assembly experiment candidate.",
      metadata: { ...METADATA_BASE },
    }));
  } else if (rendered.includedSymbols.length === 0) {
    diagnostics.push(diagnostic({
      code: "budget_exhausted",
      severity: "warning",
      message: "The AgentMap prompt assembly experiment budget could not fit a complete symbol block.",
      metadata: {
        tokenBudget,
        eligibleSymbolCount: eligibleSymbols.length,
        ...METADATA_BASE,
      },
    }));
  }

  return candidate({
    status: eligibleSymbols.length === 0
      ? "empty"
      : rendered.includedSymbols.length === 0
        ? "budget_exhausted"
        : "success",
    content: rendered.content,
    tokenBudget,
    tokenEstimate,
    includedSymbols: rendered.includedSymbols,
    diagnostics,
    evidenceRefs: rendered.includedSymbols.flatMap((rankedTag) => rankedTag.evidenceRefs),
    optIn: true,
    source: input.result,
  });
}

export function resolveRuntimeAgentMapPromptAssemblyExperimentFlag(
  value: unknown,
): boolean {
  const runtime = runtimeConfigFrom(value);
  const agentMap = recordFrom(runtime?.agentMap);
  return agentMap.promptAssemblyExperiment === true;
}

function candidate(params: {
  status: AgentMapPromptAssemblyExperimentStatus;
  content: string;
  tokenBudget: number;
  tokenEstimate: number;
  includedSymbols: AgentMapRankedTag[];
  diagnostics: AgentMapPromptAssemblyExperimentDiagnostic[];
  evidenceRefs: EvidenceRef[];
  optIn: boolean;
  source: AgentMapResult;
}): AgentMapPromptAssemblyExperimentCandidate {
  return {
    schemaVersion: 1,
    status: params.status,
    readonly: true,
    content: params.content,
    tokenBudget: params.tokenBudget,
    tokenEstimate: Math.min(params.tokenEstimate, params.tokenBudget),
    includedSymbols: params.includedSymbols,
    diagnostics: params.diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      EXPERIMENT_EVIDENCE_REF,
      ...params.source.evidenceRefs,
      ...params.evidenceRefs,
      ...params.diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: {
      ...METADATA_BASE,
      optIn: params.optIn,
      sourceStatus: params.source.status,
      sourceTokenBudget: params.source.tokenBudget,
      sourceTokenEstimate: params.source.tokenEstimate,
      includedSymbolCount: params.includedSymbols.length,
      diagnosticCount: params.diagnostics.length,
      candidateKind: "prompt_addendum",
      boundedByCallerTokenBudget: true,
    },
  };
}

function fitCompleteSymbolBlocksToBudget(input: {
  result: AgentMapResult;
  rankedTags: AgentMapRankedTag[];
  tokenBudget: number;
}): { content: string; includedSymbols: AgentMapRankedTag[] } {
  if (input.tokenBudget <= 0) {
    return { content: "", includedSymbols: [] };
  }

  let selected: AgentMapRankedTag[] = [];
  let content = renderPromptCandidate(input.result, selected);
  if (estimateTokens(content) > input.tokenBudget) {
    return { content: "", includedSymbols: [] };
  }

  for (const rankedTag of input.rankedTags) {
    const next = [...selected, rankedTag];
    const nextContent = renderPromptCandidate(input.result, next);
    if (estimateTokens(nextContent) > input.tokenBudget) {
      continue;
    }
    selected = next;
    content = nextContent;
  }

  return { content, includedSymbols: selected };
}

function renderPromptCandidate(
  result: AgentMapResult,
  rankedTags: AgentMapRankedTag[],
): string {
  const sections = groupRankedTagsByFile(rankedTags).flatMap(([file, tags]) => [
    `## ${file}`,
    ...tags.flatMap((tag) => [renderedBlockFor(tag), ""]),
  ]);
  return [
    "AgentMap experimental prompt candidate",
    "experimental: true",
    "readonlyAgentMap: true",
    "defaultOff: true",
    "noPromptCutover: true",
    "noPromptAuthority: true",
    "noToolAuthority: true",
    "noRuntimeAuthority: true",
    "legacyPromptAuthoritative: true",
    `sourceStatus: ${result.status}`,
    `sourceTokenEstimate: ${result.tokenEstimate}`,
    "",
    ...sections,
  ].filter((line, index, values) => line || values[index - 1] !== "").join("\n").trimEnd();
}

function renderedBlockFor(rankedTag: AgentMapRankedTag): string {
  if (rankedTag.renderedBlock?.trim()) {
    return rankedTag.renderedBlock.trimEnd();
  }
  const tag = rankedTag.tag;
  return [
    `@@ symbol ${tag.namePath.join(".")} (${tag.symbolKind}) ${tag.file}:${tag.range.startLine}:${tag.range.startColumn}-${tag.range.endLine}:${tag.range.endColumn}`,
    `rank: ${rankedTag.rank} score: ${formatScore(rankedTag.score)}`,
    tag.signature ?? tag.snippet ?? tag.name,
    `@@ end ${tag.tagId}`,
  ].join("\n");
}

function promptPresentFileSet(
  input: AgentMapPromptAssemblyExperimentInput,
): Set<string> {
  return new Set([
    ...(input.promptPresentFiles ?? []),
    ...input.result.excludedFiles
      .filter((file) => file.reason === "promptPresentFile")
      .map((file) => file.file),
  ].map(normalizePath));
}

function promptPresentExclusionDiagnostics(
  result: AgentMapResult,
  promptPresentFiles: Set<string>,
): AgentMapPromptAssemblyExperimentDiagnostic[] {
  return result.includedSymbols.flatMap((rankedTag) => {
    const file = normalizePath(rankedTag.tag.file);
    if (!promptPresentFiles.has(file)) {
      return [];
    }
    return [diagnostic({
      code: "prompt_present_file_excluded",
      severity: "info",
      message: "Prompt-present AgentMap file was excluded from the experiment candidate.",
      file,
      evidenceRefs: rankedTag.evidenceRefs,
      metadata: {
        tagId: rankedTag.tag.tagId,
        symbolName: rankedTag.tag.name,
        ...METADATA_BASE,
      },
    })];
  });
}

function diagnostic(params: {
  code: AgentMapPromptAssemblyExperimentDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  file?: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): AgentMapPromptAssemblyExperimentDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.file ? { file: params.file } : {}),
    evidenceRefs: uniqueEvidenceRefs([
      EXPERIMENT_EVIDENCE_REF,
      ...(params.evidenceRefs ?? []),
    ]),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function compareRankedTagsForPromptCandidate(
  left: AgentMapRankedTag,
  right: AgentMapRankedTag,
): number {
  return (
    left.rank - right.rank ||
    left.tag.file.localeCompare(right.tag.file) ||
    left.tag.range.startLine - right.tag.range.startLine ||
    left.tag.range.startColumn - right.tag.range.startColumn ||
    left.tag.name.localeCompare(right.tag.name) ||
    left.tag.tagId.localeCompare(right.tag.tagId)
  );
}

function groupRankedTagsByFile(
  rankedTags: readonly AgentMapRankedTag[],
): Array<[string, AgentMapRankedTag[]]> {
  const groups = new Map<string, AgentMapRankedTag[]>();
  for (const rankedTag of rankedTags) {
    const file = rankedTag.tag.file;
    let group = groups.get(file);
    if (!group) {
      group = [];
      groups.set(file, group);
    }
    group.push(rankedTag);
  }
  return [...groups.entries()];
}

function resolveRuntimeAgentMapPromptAssemblyExperimentConfig(
  value: unknown,
): Record<string, unknown> | undefined {
  const record = recordFrom(value);
  const directRuntime = recordFrom(record.runtime);
  if (Object.keys(directRuntime).length > 0) {
    return directRuntime;
  }
  const config = recordFrom(record.config);
  const configRuntime = recordFrom(config.runtime);
  return Object.keys(configRuntime).length > 0 ? configRuntime : undefined;
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  return resolveRuntimeAgentMapPromptAssemblyExperimentConfig(value);
}

function normalizeTokenBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//u, "");
}

function estimateTokens(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
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
