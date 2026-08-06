import {
  isEvidenceRef,
  type EvidenceRef,
} from "./evidence.js";
import type { AgentMapCache } from "./agent-map-cache.js";
import {
  isFiniteNumber,
  isNonEmptyString,
  isOptionalString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
} from "./types.js";
export {
  createAgentMapCache,
  type AgentMapCache,
  type AgentMapCacheOptions,
  type AgentMapCacheStats,
} from "./agent-map-cache.js";

export const AGENT_MAP_REFRESH_POLICIES = [
  "auto",
  "force",
  "cache_only",
] as const;

export type AgentMapRefreshPolicy = typeof AGENT_MAP_REFRESH_POLICIES[number];

export type AgentMapRequest = {
  activeFiles: string[];
  candidateFiles: string[];
  mentionedFiles: string[];
  mentionedSymbols: string[];
  promptPresentFiles: string[];
  tokenBudget: number;
  refreshPolicy: AgentMapRefreshPolicy;
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapInputLimits = {
  maxFiles?: number;
  maxFileBytes?: number;
  ignoredDirectories?: string[];
};

export const AGENT_MAP_DEFAULT_INPUT_LIMITS: Required<AgentMapInputLimits> = {
  maxFiles: 2_000,
  maxFileBytes: 256 * 1024,
  ignoredDirectories: [
    ".cache",
    ".git",
    ".next",
    ".nuxt",
    ".turbo",
    ".vite",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "vendor",
  ],
};

const AGENT_MAP_SUPPORTED_EXTENSIONS = [
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
] as const;

const AGENT_MAP_GENERATED_FILE_SUFFIXES = [
  ".gen.js",
  ".gen.jsx",
  ".gen.ts",
  ".gen.tsx",
  ".generated.js",
  ".generated.jsx",
  ".generated.ts",
  ".generated.tsx",
  ".min.js",
  ".min.jsx",
] as const;

export const AGENT_MAP_LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "unknown",
] as const;

export type AgentMapLanguage = typeof AGENT_MAP_LANGUAGES[number];

export const AGENT_MAP_TAG_KINDS = ["definition", "reference"] as const;

export type AgentMapTagKind = typeof AGENT_MAP_TAG_KINDS[number];

export const AGENT_MAP_SYMBOL_KINDS = [
  "class",
  "function",
  "method",
  "component",
  "hook",
  "interface",
  "type",
  "variable",
  "constant",
  "property",
  "module",
  "unknown",
] as const;

export type AgentMapSymbolKind = typeof AGENT_MAP_SYMBOL_KINDS[number];

export type AgentMapRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type AgentMapTag = {
  tagId: string;
  file: string;
  language: AgentMapLanguage;
  kind: AgentMapTagKind;
  symbolKind: AgentMapSymbolKind;
  name: string;
  namePath: string[];
  range: AgentMapRange;
  selectionRange?: AgentMapRange;
  signature?: string;
  snippet?: string;
  exported?: boolean;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export const AGENT_MAP_RANKING_REASON_KINDS = [
  "fromActiveFileReference",
  "mentionedByUser",
  "mentionedFile",
  "pathComponentMatch",
  "uniqueDefinition",
  "promptPresentFile",
  "budgetFit",
  "stableTieBreak",
] as const;

export type AgentMapRankingReasonKind =
  typeof AGENT_MAP_RANKING_REASON_KINDS[number];

export type AgentMapRankingReason = {
  kind: AgentMapRankingReasonKind;
  scoreDelta: number;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export const AGENT_MAP_EVIDENCE_TYPES = [
  "request",
  "tagExtraction",
  "ranking",
  "budget",
  "render",
  "diagnostic",
] as const;

export type AgentMapEvidenceType = typeof AGENT_MAP_EVIDENCE_TYPES[number];

export type AgentMapEvidence = {
  evidenceId: string;
  type: AgentMapEvidenceType;
  summary: string;
  evidenceRefs: EvidenceRef[];
  file?: string;
  tagIds?: string[];
  reasonKinds?: AgentMapRankingReasonKind[];
  metadata?: RuntimeCoreJsonObject;
};

export const AGENT_MAP_DIAGNOSTIC_CODES = [
  "max_files_exceeded",
  "max_file_bytes_exceeded",
  "ignored_directory",
  "binary_file",
  "generated_file",
  "unsupported_extension",
  "parse_failure",
  "empty_candidate_set",
] as const;

export type AgentMapDiagnosticCode =
  typeof AGENT_MAP_DIAGNOSTIC_CODES[number];

export const AGENT_MAP_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export type AgentMapDiagnosticSeverity =
  typeof AGENT_MAP_DIAGNOSTIC_SEVERITIES[number];

export type AgentMapDiagnostic = {
  code: AgentMapDiagnosticCode;
  severity: AgentMapDiagnosticSeverity;
  message: string;
  file?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapRankedTag = {
  tag: AgentMapTag;
  rank: number;
  score: number;
  reasons: AgentMapRankingReason[];
  tokenEstimate?: number;
  renderedBlock?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export const AGENT_MAP_FILE_SELECTION_REASONS = [
  "activeFile",
  "candidateFile",
  "mentionedFile",
  "promptPresentFile",
  "budget",
  "noTags",
  "unsupportedLanguage",
  "diagnostic",
] as const;

export type AgentMapFileSelectionReason =
  typeof AGENT_MAP_FILE_SELECTION_REASONS[number];

export type AgentMapFileSelection = {
  file: string;
  included: boolean;
  reason: AgentMapFileSelectionReason;
  tagIds: string[];
  tokenEstimate: number;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export const AGENT_MAP_RESULT_STATUSES = [
  "success",
  "empty",
  "budget_exhausted",
  "error",
] as const;

export type AgentMapResultStatus = typeof AGENT_MAP_RESULT_STATUSES[number];

export type AgentMapResult = {
  schemaVersion: 1;
  status: AgentMapResultStatus;
  readonly: true;
  content: string;
  tokenBudget: number;
  tokenEstimate: number;
  includedFiles: AgentMapFileSelection[];
  excludedFiles: AgentMapFileSelection[];
  includedSymbols: AgentMapRankedTag[];
  evidence: AgentMapEvidence[];
  evidenceRefs: EvidenceRef[];
  diagnostics?: AgentMapDiagnostic[];
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapSourceFile = {
  file: string;
  content: string;
  language?: AgentMapLanguage;
  metadata?: RuntimeCoreJsonObject;
};

export type AgentMapTagExtractionInput = {
  files: AgentMapSourceFile[];
  cache?: AgentMapCache;
  refreshPolicy?: AgentMapRefreshPolicy;
};

export type AgentMapRankInput = {
  request: AgentMapRequest;
  tags: AgentMapTag[];
};

export type AgentMapRenderInput = {
  rankedTags: AgentMapRankedTag[];
  files: AgentMapSourceFile[];
  tokenBudget?: number;
  contextLines?: number;
  maxSymbols?: number;
};

export type AgentMapRenderOutput = {
  content: string;
  tokenEstimate: number;
  renderedSymbols: AgentMapRankedTag[];
};

export type BuildBudgetedAgentMapInput = {
  request: AgentMapRequest;
  files: AgentMapSourceFile[];
  contextLines?: number;
  cache?: AgentMapCache;
  inputLimits?: AgentMapInputLimits;
};

type TypeScriptRuntime = typeof import("typescript");
type TypeScriptNode = import("typescript").Node;
type TypeScriptIdentifier = import("typescript").Identifier;
type TypeScriptSourceFile = import("typescript").SourceFile;

type AgentMapTagExtractionOutput = {
  tags: AgentMapTag[];
  diagnostics: AgentMapDiagnostic[];
};

type AgentMapSourceTagExtraction = {
  tags: AgentMapTag[];
  diagnostic?: AgentMapDiagnostic;
};

type NormalizedAgentMapInputLimits = Required<AgentMapInputLimits>;

type PreparedAgentMapSources = {
  files: AgentMapSourceFile[];
  diagnostics: AgentMapDiagnostic[];
  limits: NormalizedAgentMapInputLimits;
  inputFileCount: number;
};

type AgentMapRankingTagFacts = {
  normalizedName: string;
  nameTokenLength: number;
  nameAndPathTokens: string[];
  nameAndPathTokenSet?: Set<string>;
  pathTokens: string[];
  pathNameTokens: string[];
  pathNameTokenSet?: Set<string>;
  tieBreakKey: string;
};

type AgentMapScoreRecord = {
  tag: AgentMapTag;
  facts: AgentMapRankingTagFacts;
  score: number;
  activeReferences: AgentMapTag[];
  symbolMention?: { mention: string; exact: boolean };
  mentionedFile: boolean;
  pathComponentMatch: boolean;
  uniqueDefinition: boolean;
  promptPresent: boolean;
};

type PreparedAgentMapRankingInput = {
  promptPresentFiles: Set<string>;
  mentionedFiles: Set<string>;
  normalizedMentionedSymbolSet: Set<string>;
  mentionedSymbolTokenGroups: string[][];
  mentionedFileTokens: string[];
  definitions: AgentMapTag[];
  definitionCountByName: Map<string, number>;
  referenceCountByName: Map<string, number>;
  activeReferencesByName: Map<string, AgentMapTag[]>;
  factsByTagId: Map<string, AgentMapRankingTagFacts>;
  pathTokensByFile: Map<string, string[]>;
  rankedDefinitionCount: number;
  promptPresentDefinitionCount: number;
};

type AgentMapInternalRankingOutput = {
  ranked: AgentMapRankedTag[];
  rankedDefinitionCount: number;
};

type AgentMapRankingOptions = {
  maxRankedTags?: number;
  excludePromptPresent?: boolean;
  skipPromptPresentMaterializationAfterRank?: boolean;
};

type AgentMapRenderSourceFacts = {
  lines: string[];
};

type AgentMapLineCache = {
  lines: string[];
  trimmedLines: string[];
};

const REFRESH_POLICY_SET = new Set<AgentMapRefreshPolicy>(
  AGENT_MAP_REFRESH_POLICIES,
);
const LANGUAGE_SET = new Set<AgentMapLanguage>(AGENT_MAP_LANGUAGES);
const TAG_KIND_SET = new Set<AgentMapTagKind>(AGENT_MAP_TAG_KINDS);
const SYMBOL_KIND_SET = new Set<AgentMapSymbolKind>(AGENT_MAP_SYMBOL_KINDS);
const RANKING_REASON_KIND_SET = new Set<AgentMapRankingReasonKind>(
  AGENT_MAP_RANKING_REASON_KINDS,
);
const EVIDENCE_TYPE_SET = new Set<AgentMapEvidenceType>(
  AGENT_MAP_EVIDENCE_TYPES,
);
const DIAGNOSTIC_CODE_SET = new Set<AgentMapDiagnosticCode>(
  AGENT_MAP_DIAGNOSTIC_CODES,
);
const DIAGNOSTIC_SEVERITY_SET = new Set<AgentMapDiagnosticSeverity>(
  AGENT_MAP_DIAGNOSTIC_SEVERITIES,
);
const FILE_SELECTION_REASON_SET = new Set<AgentMapFileSelectionReason>(
  AGENT_MAP_FILE_SELECTION_REASONS,
);
const RESULT_STATUS_SET = new Set<AgentMapResultStatus>(
  AGENT_MAP_RESULT_STATUSES,
);

export function isAgentMapRefreshPolicy(
  value: unknown,
): value is AgentMapRefreshPolicy {
  return (
    typeof value === "string" &&
    REFRESH_POLICY_SET.has(value as AgentMapRefreshPolicy)
  );
}

export function isAgentMapLanguage(value: unknown): value is AgentMapLanguage {
  return typeof value === "string" && LANGUAGE_SET.has(value as AgentMapLanguage);
}

export function isAgentMapTagKind(value: unknown): value is AgentMapTagKind {
  return typeof value === "string" && TAG_KIND_SET.has(value as AgentMapTagKind);
}

export function isAgentMapSymbolKind(
  value: unknown,
): value is AgentMapSymbolKind {
  return (
    typeof value === "string" &&
    SYMBOL_KIND_SET.has(value as AgentMapSymbolKind)
  );
}

export function isAgentMapRankingReasonKind(
  value: unknown,
): value is AgentMapRankingReasonKind {
  return (
    typeof value === "string" &&
    RANKING_REASON_KIND_SET.has(value as AgentMapRankingReasonKind)
  );
}

export function isAgentMapEvidenceType(
  value: unknown,
): value is AgentMapEvidenceType {
  return (
    typeof value === "string" &&
    EVIDENCE_TYPE_SET.has(value as AgentMapEvidenceType)
  );
}

export function isAgentMapDiagnosticCode(
  value: unknown,
): value is AgentMapDiagnosticCode {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_CODE_SET.has(value as AgentMapDiagnosticCode)
  );
}

export function isAgentMapDiagnosticSeverity(
  value: unknown,
): value is AgentMapDiagnosticSeverity {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_SEVERITY_SET.has(value as AgentMapDiagnosticSeverity)
  );
}

export function isAgentMapFileSelectionReason(
  value: unknown,
): value is AgentMapFileSelectionReason {
  return (
    typeof value === "string" &&
    FILE_SELECTION_REASON_SET.has(value as AgentMapFileSelectionReason)
  );
}

export function isAgentMapResultStatus(
  value: unknown,
): value is AgentMapResultStatus {
  return (
    typeof value === "string" &&
    RESULT_STATUS_SET.has(value as AgentMapResultStatus)
  );
}

export function isAgentMapRequest(value: unknown): value is AgentMapRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isStringItems(value.activeFiles) &&
    isStringItems(value.candidateFiles) &&
    isStringItems(value.mentionedFiles) &&
    isStringItems(value.mentionedSymbols) &&
    isStringItems(value.promptPresentFiles) &&
    isNonNegativeInteger(value.tokenBudget) &&
    isAgentMapRefreshPolicy(value.refreshPolicy) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapRange(value: unknown): value is AgentMapRange {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isPositiveInteger(value.startLine) ||
    !isNonNegativeInteger(value.startColumn) ||
    !isPositiveInteger(value.endLine) ||
    !isNonNegativeInteger(value.endColumn)
  ) {
    return false;
  }
  if (value.endLine > value.startLine) {
    return true;
  }
  return value.endLine === value.startLine && value.endColumn >= value.startColumn;
}

export function isAgentMapTag(value: unknown): value is AgentMapTag {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.tagId) &&
    isNonEmptyString(value.file) &&
    isAgentMapLanguage(value.language) &&
    isAgentMapTagKind(value.kind) &&
    isAgentMapSymbolKind(value.symbolKind) &&
    isNonEmptyString(value.name) &&
    isRequiredStringItems(value.namePath) &&
    isAgentMapRange(value.range) &&
    (value.selectionRange === undefined || isAgentMapRange(value.selectionRange)) &&
    isOptionalString(value.signature) &&
    isOptionalString(value.snippet) &&
    (value.exported === undefined || typeof value.exported === "boolean") &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapRankingReason(
  value: unknown,
): value is AgentMapRankingReason {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isAgentMapRankingReasonKind(value.kind) &&
    isFiniteNumber(value.scoreDelta) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapEvidence(value: unknown): value is AgentMapEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.evidenceId) &&
    isAgentMapEvidenceType(value.type) &&
    isNonEmptyString(value.summary) &&
    isEvidenceRefs(value.evidenceRefs) &&
    isOptionalString(value.file) &&
    (value.tagIds === undefined || isStringItems(value.tagIds)) &&
    (value.reasonKinds === undefined ||
      (Array.isArray(value.reasonKinds) &&
        value.reasonKinds.every(isAgentMapRankingReasonKind))) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapDiagnostic(value: unknown): value is AgentMapDiagnostic {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isAgentMapDiagnosticCode(value.code) &&
    isAgentMapDiagnosticSeverity(value.severity) &&
    isNonEmptyString(value.message) &&
    isOptionalString(value.file) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapRankedTag(value: unknown): value is AgentMapRankedTag {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isAgentMapTag(value.tag) &&
    isPositiveInteger(value.rank) &&
    isFiniteNumber(value.score) &&
    Array.isArray(value.reasons) &&
    value.reasons.every(isAgentMapRankingReason) &&
    (value.tokenEstimate === undefined || isNonNegativeInteger(value.tokenEstimate)) &&
    isOptionalString(value.renderedBlock) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapFileSelection(
  value: unknown,
): value is AgentMapFileSelection {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.file) &&
    typeof value.included === "boolean" &&
    isAgentMapFileSelectionReason(value.reason) &&
    isStringItems(value.tagIds) &&
    isNonNegativeInteger(value.tokenEstimate) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isAgentMapResult(value: unknown): value is AgentMapResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isAgentMapResultStatus(value.status) &&
    value.readonly === true &&
    typeof value.content === "string" &&
    isNonNegativeInteger(value.tokenBudget) &&
    isNonNegativeInteger(value.tokenEstimate) &&
    value.tokenEstimate <= value.tokenBudget &&
    Array.isArray(value.includedFiles) &&
    value.includedFiles.every((item) =>
      isAgentMapFileSelection(item) && item.included
    ) &&
    Array.isArray(value.excludedFiles) &&
    value.excludedFiles.every((item) =>
      isAgentMapFileSelection(item) && !item.included
    ) &&
    Array.isArray(value.includedSymbols) &&
    value.includedSymbols.every(isAgentMapRankedTag) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isAgentMapEvidence) &&
    isEvidenceRefs(value.evidenceRefs) &&
    (value.diagnostics === undefined ||
      (Array.isArray(value.diagnostics) &&
        value.diagnostics.every(isAgentMapDiagnostic))) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function buildAgentMapRequestFixture(
  overrides: Partial<AgentMapRequest> = {},
): AgentMapRequest {
  return {
    activeFiles: ["src/components/chat/Composer.tsx"],
    candidateFiles: [
      "src/components/chat/Composer.tsx",
      "src/lib/host-api.ts",
    ],
    mentionedFiles: ["src/lib/host-api.ts"],
    mentionedSymbols: ["sendMessage"],
    promptPresentFiles: ["src/components/chat/Composer.tsx"],
    tokenBudget: 512,
    refreshPolicy: "auto",
    ...overrides,
  };
}

export function buildAgentMapTagFixture(
  overrides: Partial<AgentMapTag> = {},
): AgentMapTag {
  return {
    tagId: "tag:src/lib/host-api.ts:sendMessage:def",
    file: "src/lib/host-api.ts",
    language: "typescript",
    kind: "definition",
    symbolKind: "function",
    name: "sendMessage",
    namePath: ["hostApi", "chat", "sendMessage"],
    range: {
      startLine: 24,
      startColumn: 0,
      endLine: 32,
      endColumn: 1,
    },
    selectionRange: {
      startLine: 24,
      startColumn: 16,
      endLine: 24,
      endColumn: 27,
    },
    signature: "function sendMessage(input: ChatInput): Promise<ChatResult>",
    snippet: "export async function sendMessage(input: ChatInput) {",
    exported: true,
    evidenceRefs: [
      {
        type: "file",
        ref: "src/lib/host-api.ts:24",
        label: "Symbol definition",
      },
    ],
    ...overrides,
  };
}

export function buildAgentMapRankingReasonFixture(
  overrides: Partial<AgentMapRankingReason> = {},
): AgentMapRankingReason {
  return {
    kind: "mentionedByUser",
    scoreDelta: 40,
    evidenceRefs: [
      {
        type: "trace",
        ref: "agent-map:mentioned-symbol:sendMessage",
        label: "Mentioned symbol",
      },
    ],
    ...overrides,
  };
}

export function buildAgentMapEvidenceFixture(
  overrides: Partial<AgentMapEvidence> = {},
): AgentMapEvidence {
  return {
    evidenceId: "agent-map:evidence:ranking:sendMessage",
    type: "ranking",
    summary: "sendMessage was lifted because the user mentioned the identifier.",
    evidenceRefs: [
      {
        type: "trace",
        ref: "agent-map:ranking:sendMessage",
        label: "AgentMap ranking evidence",
      },
    ],
    file: "src/lib/host-api.ts",
    tagIds: ["tag:src/lib/host-api.ts:sendMessage:def"],
    reasonKinds: ["mentionedByUser"],
    ...overrides,
  };
}

export function buildAgentMapDiagnosticFixture(
  overrides: Partial<AgentMapDiagnostic> = {},
): AgentMapDiagnostic {
  return {
    code: "unsupported_extension",
    severity: "info",
    message: "Fixture AgentMap diagnostic.",
    file: "src/fixtures/example.css",
    evidenceRefs: [
      {
        type: "file",
        ref: "src/fixtures/example.css",
        label: "AgentMap diagnostic fixture",
      },
    ],
    metadata: { readonly: true },
    ...overrides,
  };
}

export function buildAgentMapFileSelectionFixture(
  overrides: Partial<AgentMapFileSelection> = {},
): AgentMapFileSelection {
  return {
    file: "src/lib/host-api.ts",
    included: true,
    reason: "mentionedFile",
    tagIds: ["tag:src/lib/host-api.ts:sendMessage:def"],
    tokenEstimate: 56,
    evidenceRefs: [
      {
        type: "file",
        ref: "src/lib/host-api.ts",
        label: "Included AgentMap file",
      },
    ],
    ...overrides,
  };
}

export function buildAgentMapRankedTagFixture(
  overrides: Partial<AgentMapRankedTag> = {},
): AgentMapRankedTag {
  const tag = buildAgentMapTagFixture();
  return {
    tag,
    rank: 1,
    score: 90,
    reasons: [buildAgentMapRankingReasonFixture()],
    tokenEstimate: 56,
    renderedBlock: "src/lib/host-api.ts:24 function sendMessage(input: ChatInput)",
    evidenceRefs: tag.evidenceRefs,
    ...overrides,
  };
}

export function buildAgentMapResultFixture(
  overrides: Partial<AgentMapResult> = {},
): AgentMapResult {
  const rankedTag = buildAgentMapRankedTagFixture();
  return {
    schemaVersion: 1,
    status: "success",
    readonly: true,
    content: "src/lib/host-api.ts:24 function sendMessage(input: ChatInput)",
    tokenBudget: 512,
    tokenEstimate: 56,
    includedFiles: [buildAgentMapFileSelectionFixture()],
    excludedFiles: [
      buildAgentMapFileSelectionFixture({
        file: "src/components/chat/Composer.tsx",
        included: false,
        reason: "promptPresentFile",
        tagIds: ["tag:src/components/chat/Composer.tsx:Composer:def"],
        tokenEstimate: 0,
        evidenceRefs: [
          {
            type: "file",
            ref: "src/components/chat/Composer.tsx",
            label: "Already present in prompt",
          },
        ],
      }),
    ],
    includedSymbols: [rankedTag],
    evidence: [buildAgentMapEvidenceFixture()],
    evidenceRefs: [
      {
        type: "trace",
        ref: "agent-map:result:fixture",
        label: "AgentMap result evidence",
      },
    ],
    diagnostics: [],
    metadata: { phase: "line-b-agentmap-readonly" },
    ...overrides,
  };
}

let agentMapTypeScriptRuntimePromise: Promise<TypeScriptRuntime> | null = null;
let agentMapTypeScriptRuntimeForTest: TypeScriptRuntime | null = null;

export const agentMapInternalsForTest = {
  setTypeScriptRuntimeForTest(runtime: TypeScriptRuntime | null): void {
    agentMapTypeScriptRuntimeForTest = runtime;
    agentMapTypeScriptRuntimePromise = null;
  },
};

export async function extractAgentMapTagsFromSources(
  input: AgentMapTagExtractionInput,
): Promise<AgentMapTag[]> {
  const output = await extractAgentMapTagsFromSourcesWithDiagnostics(input);
  return output.tags;
}

async function extractAgentMapTagsFromSourcesWithDiagnostics(
  input: AgentMapTagExtractionInput,
): Promise<AgentMapTagExtractionOutput> {
  const files = input.files.map(normalizeAgentMapSourceFile);
  if (files.length === 0) {
    return { tags: [], diagnostics: [] };
  }

  if (!input.cache) {
    const ts = await loadAgentMapTypeScriptRuntime();
    return extractAgentMapTagsFromUncachedSources(ts, files);
  }

  const cache = input.cache;
  const refreshPolicy = input.refreshPolicy ?? "auto";
  if (refreshPolicy === "force") {
    const ts = await loadAgentMapTypeScriptRuntime();
    return extractAgentMapTagsFromForcedSources(ts, files, cache);
  }

  const tagsByFile: AgentMapTag[][] = [];
  const misses: Array<{ source: AgentMapSourceFile; index: number }> = [];
  const diagnostics: AgentMapDiagnostic[] = [];
  files.forEach((source, index) => {
    const cachedTags = cache.getTags(source);
    if (cachedTags) {
      tagsByFile[index] = cachedTags;
      return;
    }
    if (refreshPolicy === "cache_only") {
      tagsByFile[index] = [];
      return;
    }
    misses.push({ source, index });
  });

  if (misses.length > 0) {
    const ts = await loadAgentMapTypeScriptRuntime();
    for (const miss of misses) {
      const output = extractAgentMapTagsFromSourceWithDiagnostics(ts, miss.source);
      if (output.diagnostic) {
        diagnostics.push(output.diagnostic);
        tagsByFile[miss.index] = [];
        continue;
      }
      cache.setTags(miss.source, output.tags);
      tagsByFile[miss.index] = output.tags;
    }
  }

  return { tags: tagsByFile.flat(), diagnostics };
}

function extractAgentMapTagsFromUncachedSources(
  ts: TypeScriptRuntime,
  files: AgentMapSourceFile[],
): AgentMapTagExtractionOutput {
  const tags: AgentMapTag[] = [];
  const diagnostics: AgentMapDiagnostic[] = [];
  for (const source of files) {
    const output = extractAgentMapTagsFromSourceWithDiagnostics(ts, source);
    tags.push(...output.tags);
    if (output.diagnostic) {
      diagnostics.push(output.diagnostic);
    }
  }
  return { tags, diagnostics };
}

function extractAgentMapTagsFromForcedSources(
  ts: TypeScriptRuntime,
  files: AgentMapSourceFile[],
  cache: AgentMapCache,
): AgentMapTagExtractionOutput {
  const tags: AgentMapTag[] = [];
  const diagnostics: AgentMapDiagnostic[] = [];
  for (const source of files) {
    const output = extractAgentMapTagsFromSourceWithDiagnostics(ts, source);
    tags.push(...output.tags);
    if (output.diagnostic) {
      diagnostics.push(output.diagnostic);
      continue;
    }
    cache.setTags(source, output.tags);
  }
  return { tags, diagnostics };
}

export function rankAgentMapTags(input: AgentMapRankInput): AgentMapRankedTag[] {
  return rankAgentMapTagsInternal(input).ranked;
}

function rankAgentMapTagsInternal(
  input: AgentMapRankInput,
  options: AgentMapRankingOptions = {},
): AgentMapInternalRankingOutput {
  const prepared = prepareAgentMapRankingInput(input);
  return rankPreparedAgentMapRankingInput(prepared, options);
}

function rankPreparedAgentMapRankingInput(
  prepared: PreparedAgentMapRankingInput,
  options: AgentMapRankingOptions = {},
): AgentMapInternalRankingOutput {
  const records = rankPreparedAgentMapDefinitions(prepared, options);
  const sorted = options.maxRankedTags === undefined
    ? records.sort(compareAgentMapScoreRecords)
    : records;
  const ranked: AgentMapRankedTag[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const record = sorted[index];
    if (!record) {
      continue;
    }
    if (
      options.skipPromptPresentMaterializationAfterRank === true &&
      record.promptPresent
    ) {
      continue;
    }
    ranked.push(materializeAgentMapRankedTag(prepared, record, index + 1));
  }
  return {
    ranked,
    rankedDefinitionCount: options.excludePromptPresent
      ? prepared.rankedDefinitionCount
      : prepared.definitions.length,
  };
}

function prepareAgentMapRankingInput(
  input: AgentMapRankInput,
  normalizedRequest?: AgentMapRequest,
): PreparedAgentMapRankingInput {
  const request = normalizedRequest ?? normalizeAgentMapRequestPaths(input.request);
  const promptPresentFiles = new Set(request.promptPresentFiles);
  const activeFiles = new Set(request.activeFiles);
  const candidateFiles = new Set(request.candidateFiles);
  const mentionedFiles = new Set(request.mentionedFiles);
  const normalizedMentionedSymbolSet = new Set<string>();
  const mentionedSymbolTokenGroups: string[][] = [];
  for (const symbol of request.mentionedSymbols) {
    normalizedMentionedSymbolSet.add(normalizeSearchText(symbol));
    const tokens = splitSearchTokens(symbol);
    if (tokens.length > 0) {
      mentionedSymbolTokenGroups.push(tokens);
    }
  }
  const mentionedFileTokens: string[] = [];
  for (const file of request.mentionedFiles) {
    mentionedFileTokens.push(...splitPathTokens(file));
  }
  const definitions: AgentMapTag[] = [];
  const references: AgentMapTag[] = [];
  const factsByTagId = new Map<string, AgentMapRankingTagFacts>();
  const pathTokensByFile = new Map<string, string[]>();

  for (const tag of input.tags) {
    if (tag.kind !== "definition" && tag.kind !== "reference") {
      continue;
    }
    const normalizedFile = normalizeAgentMapPath(tag.file);
    const normalizedTag = normalizedFile === tag.file ? tag : { ...tag, file: normalizedFile };
    if (normalizedTag.kind === "definition") {
      if (candidateFiles.size > 0 && !candidateFiles.has(normalizedTag.file)) {
        continue;
      }
      definitions.push(normalizedTag);
      factsByTagId.set(
        normalizedTag.tagId,
        buildAgentMapRankingTagFacts(normalizedTag, pathTokensByFile),
      );
      continue;
    }
    references.push(normalizedTag);
  }

  const definitionCountByName = new Map<string, number>();
  for (const definition of definitions) {
    const facts = factsByTagId.get(definition.tagId) ??
      buildAgentMapRankingTagFacts(definition, pathTokensByFile);
    factsByTagId.set(definition.tagId, facts);
    definitionCountByName.set(
      facts.normalizedName,
      (definitionCountByName.get(facts.normalizedName) ?? 0) + 1,
    );
  }

  const referenceCountByName = new Map<string, number>();
  const activeReferencesByName = new Map<string, AgentMapTag[]>();
  for (const reference of references) {
    const name = normalizeSearchText(reference.name);
    referenceCountByName.set(name, (referenceCountByName.get(name) ?? 0) + 1);
    if (activeFiles.has(reference.file)) {
      let activeReferences = activeReferencesByName.get(name);
      if (!activeReferences) {
        activeReferences = [];
        activeReferencesByName.set(name, activeReferences);
      }
      activeReferences.push(reference);
    }
  }

  let rankedDefinitionCount = 0;
  let promptPresentDefinitionCount = 0;
  for (const definition of definitions) {
    if (promptPresentFiles.has(definition.file)) {
      promptPresentDefinitionCount += 1;
      continue;
    }
    rankedDefinitionCount += 1;
  }

  return {
    promptPresentFiles,
    mentionedFiles,
    normalizedMentionedSymbolSet,
    mentionedSymbolTokenGroups,
    mentionedFileTokens,
    definitions,
    definitionCountByName,
    referenceCountByName,
    activeReferencesByName,
    factsByTagId,
    pathTokensByFile,
    rankedDefinitionCount,
    promptPresentDefinitionCount,
  };
}

function buildAgentMapRankingTagFacts(
  tag: AgentMapTag,
  pathTokensByFile: Map<string, string[]>,
): AgentMapRankingTagFacts {
  const normalizedName = normalizeSearchText(tag.name);
  const nameTokens = splitSearchTokens(tag.name);
  const nameAndPathTokens = tag.namePath.length === 1 && tag.namePath[0] === tag.name
    ? nameTokens
    : mergeNameAndPathTokens(nameTokens, tag.namePath);
  let nameTokenLength = 0;
  for (const token of nameTokens) {
    nameTokenLength += token.length;
  }
  let pathTokens = pathTokensByFile.get(tag.file);
  if (!pathTokens) {
    pathTokens = splitPathTokens(tag.file);
    pathTokensByFile.set(tag.file, pathTokens);
  }
  return {
    normalizedName,
    nameTokenLength,
    nameAndPathTokens,
    pathTokens,
    pathNameTokens: mergeUniqueTokenArrays(pathTokens, nameAndPathTokens),
    tieBreakKey: rankedTagTieBreakKey(tag),
  };
}

function rankPreparedAgentMapDefinitions(
  prepared: PreparedAgentMapRankingInput,
  options: AgentMapRankingOptions,
): AgentMapScoreRecord[] {
  const maxRankedTags = options.maxRankedTags === undefined
    ? undefined
    : Math.max(0, Math.floor(options.maxRankedTags));
  const records: AgentMapScoreRecord[] = [];
  for (const tag of prepared.definitions) {
    if (options.excludePromptPresent && prepared.promptPresentFiles.has(tag.file)) {
      continue;
    }
    const record = scorePreparedAgentMapDefinition(prepared, tag);
    if (maxRankedTags === undefined) {
      records.push(record);
      continue;
    }
    insertBoundedScoreRecord(
      records,
      record,
      maxRankedTags,
    );
  }
  return records;
}

function scorePreparedAgentMapDefinition(
  prepared: PreparedAgentMapRankingInput,
  tag: AgentMapTag,
): AgentMapScoreRecord {
  const facts = prepared.factsByTagId.get(tag.tagId) ??
    buildAgentMapRankingTagFacts(tag, prepared.pathTokensByFile);
  let score = 10 + Math.min(12, facts.nameTokenLength);

  const activeReferences = prepared.activeReferencesByName.get(facts.normalizedName) ?? [];
  if (activeReferences.length > 0) {
    score += 60 + activeReferences.length * 8;
  }

  const symbolMention = matchingMentionedSymbolFromFacts(
    facts,
    prepared.normalizedMentionedSymbolSet,
    prepared.mentionedSymbolTokenGroups,
  );
  if (symbolMention) {
    score += symbolMention.exact ? 90 : 45;
  }

  const mentionedFile = prepared.mentionedFiles.has(tag.file);
  if (mentionedFile) {
    score += 55;
  }

  const pathComponentMatch = pathComponentMatchesFacts(
    facts,
    prepared.mentionedFileTokens,
    prepared.mentionedSymbolTokenGroups,
  );
  if (pathComponentMatch) {
    score += 24;
  }

  const uniqueDefinition = (prepared.definitionCountByName.get(facts.normalizedName) ?? 0) === 1;
  if (uniqueDefinition) {
    score += 12;
  }

  const record: AgentMapScoreRecord = {
    tag,
    facts,
    score,
    activeReferences,
    mentionedFile,
    pathComponentMatch,
    uniqueDefinition,
    promptPresent: prepared.promptPresentFiles.has(tag.file),
  };
  if (symbolMention) {
    record.symbolMention = symbolMention;
  }
  return record;
}

function materializeAgentMapRankedTag(
  prepared: PreparedAgentMapRankingInput,
  record: AgentMapScoreRecord,
  rank: number,
): AgentMapRankedTag {
  const tag = record.tag;
  const reasons = materializeAgentMapRankingReasons(record);
  return {
    tag,
    rank,
    score: record.score,
    reasons,
    evidenceRefs: mergeRankedTagEvidenceRefs(tag.evidenceRefs, reasons),
    metadata: {
      referenceCount: prepared.referenceCountByName.get(record.facts.normalizedName) ?? 0,
      promptPresent: record.promptPresent,
    },
  };
}

function materializeAgentMapRankingReasons(
  record: AgentMapScoreRecord,
): AgentMapRankingReason[] {
  const tag = record.tag;
  const facts = record.facts;
  const reasons: AgentMapRankingReason[] = [];

  if (record.activeReferences.length > 0) {
    const activeFiles = new Set<string>();
    for (const reference of record.activeReferences) {
      activeFiles.add(reference.file);
    }
    const scoreDelta = 60 + record.activeReferences.length * 8;
    const evidenceRefs: EvidenceRef[] = [];
    const evidenceReferenceLimit = Math.min(5, record.activeReferences.length);
    for (let index = 0; index < evidenceReferenceLimit; index += 1) {
      const reference = record.activeReferences[index];
      if (!reference) {
        continue;
      }
      for (const evidenceRef of reference.evidenceRefs) {
        evidenceRefs.push(evidenceRef);
      }
    }
    reasons.push({
      kind: "fromActiveFileReference",
      scoreDelta,
      evidenceRefs,
      metadata: {
        referenceCount: record.activeReferences.length,
        activeFiles: [...activeFiles],
      },
    });
  }

  if (record.symbolMention) {
    const scoreDelta = record.symbolMention.exact ? 90 : 45;
    reasons.push({
      kind: "mentionedByUser",
      scoreDelta,
      evidenceRefs: [{
        type: "trace",
        ref: `agent-map:mentioned-symbol:${record.symbolMention.mention}`,
        label: "Mentioned symbol",
      }],
      metadata: {
        mention: record.symbolMention.mention,
        exact: record.symbolMention.exact,
      },
    });
  }

  if (record.mentionedFile) {
    reasons.push({
      kind: "mentionedFile",
      scoreDelta: 55,
      evidenceRefs: [{
        type: "file",
        ref: tag.file,
        label: "Mentioned file",
      }],
    });
  }

  if (record.pathComponentMatch) {
    reasons.push({
      kind: "pathComponentMatch",
      scoreDelta: 24,
      evidenceRefs: [{
        type: "file",
        ref: tag.file,
        label: "Path or symbol component match",
      }],
      metadata: { pathTokens: facts.pathTokens },
    });
  }

  if (record.uniqueDefinition) {
    reasons.push({
      kind: "uniqueDefinition",
      scoreDelta: 12,
      evidenceRefs: tag.evidenceRefs,
      metadata: { definitionCount: 1 },
    });
  }

  if (record.promptPresent) {
    reasons.push({
      kind: "promptPresentFile",
      scoreDelta: 0,
      evidenceRefs: [{
        type: "file",
        ref: tag.file,
        label: "Already present in prompt",
      }],
    });
  }

  reasons.push({
    kind: "stableTieBreak",
    scoreDelta: 0,
    evidenceRefs: tag.evidenceRefs,
    metadata: { tieBreakKey: facts.tieBreakKey },
  });

  return reasons;
}

function matchingMentionedSymbolFromFacts(
  facts: AgentMapRankingTagFacts,
  mentionedSymbolSet: Set<string>,
  mentionedTokenGroups: string[][],
): { mention: string; exact: boolean } | undefined {
  if (mentionedSymbolSet.has(facts.normalizedName)) {
    return { mention: facts.normalizedName, exact: true };
  }
  if (mentionedTokenGroups.length === 0) {
    return undefined;
  }
  for (let index = 0; index < mentionedTokenGroups.length; index += 1) {
    const tokens = mentionedTokenGroups[index] ?? [];
    if (
      tokens.length > 0 &&
      allTokensInSet(tokens, nameAndPathTokenSetForFacts(facts))
    ) {
      return { mention: tokens.join(" "), exact: false };
    }
  }
  return undefined;
}

function pathComponentMatchesFacts(
  facts: AgentMapRankingTagFacts,
  mentionedFileTokens: string[],
  mentionedSymbolTokenGroups: string[][],
): boolean {
  if (mentionedFileTokens.length === 0 && mentionedSymbolTokenGroups.length === 0) {
    return false;
  }
  const pathNameTokenSet = pathNameTokenSetForFacts(facts);
  for (const token of mentionedFileTokens) {
    if (pathNameTokenSet.has(token)) {
      return true;
    }
  }
  for (const tokens of mentionedSymbolTokenGroups) {
    if (tokens.length > 0 && allTokensInSet(tokens, pathNameTokenSet)) {
      return true;
    }
  }
  return false;
}

function mergeNameAndPathTokens(nameTokens: string[], namePath: string[]): string[] {
  const merged = [...nameTokens];
  const seen = new Set(merged);
  for (const part of namePath) {
    for (const token of splitSearchTokens(part)) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      merged.push(token);
    }
  }
  return merged;
}

function mergeUniqueTokenArrays(first: string[], second: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const token of first) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    merged.push(token);
  }
  for (const token of second) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    merged.push(token);
  }
  return merged;
}

function nameAndPathTokenSetForFacts(facts: AgentMapRankingTagFacts): Set<string> {
  if (!facts.nameAndPathTokenSet) {
    facts.nameAndPathTokenSet = new Set(facts.nameAndPathTokens);
  }
  return facts.nameAndPathTokenSet;
}

function pathNameTokenSetForFacts(facts: AgentMapRankingTagFacts): Set<string> {
  if (!facts.pathNameTokenSet) {
    facts.pathNameTokenSet = new Set(facts.pathNameTokens);
  }
  return facts.pathNameTokenSet;
}

function allTokensInSet(tokens: string[], tokenSet: Set<string>): boolean {
  for (const token of tokens) {
    if (!tokenSet.has(token)) {
      return false;
    }
  }
  return true;
}

function insertBoundedScoreRecord(
  records: AgentMapScoreRecord[],
  candidate: AgentMapScoreRecord,
  maxRankedTags: number,
): void {
  if (maxRankedTags <= 0) {
    return;
  }
  if (
    records.length === maxRankedTags &&
    compareAgentMapScoreRecords(candidate, records[records.length - 1]) >= 0
  ) {
    return;
  }
  const insertIndex = findScoreRecordInsertIndex(records, candidate);
  records.splice(insertIndex, 0, candidate);
  if (records.length > maxRankedTags) {
    records.pop();
  }
}

function findScoreRecordInsertIndex(
  records: AgentMapScoreRecord[],
  candidate: AgentMapScoreRecord,
): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (compareAgentMapScoreRecords(candidate, records[mid]) < 0) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function rankAgentMapTagsForBudgetedRender(input: {
  request: AgentMapRequest;
  tags: AgentMapTag[];
  tokenBudget: number;
}): AgentMapInternalRankingOutput {
  const request = normalizeAgentMapRequestPaths(input.request);
  const prepared = prepareAgentMapRankingInput({ request, tags: input.tags }, request);
  const ranked = rankPreparedAgentMapRankingInput(
    prepared,
    {
      maxRankedTags: budgetedAgentMapRankingWindow(input.tokenBudget) +
        prepared.promptPresentDefinitionCount +
        16,
      skipPromptPresentMaterializationAfterRank: true,
    },
  );
  return {
    ranked: ranked.ranked,
    rankedDefinitionCount: prepared.rankedDefinitionCount,
  };
}

function budgetedAgentMapRankingWindow(tokenBudget: number): number {
  const budget = Number.isFinite(tokenBudget) ? Math.max(0, Math.floor(tokenBudget)) : 0;
  return Math.max(32, Math.min(256, Math.ceil(budget / 16) + 24));
}

export function renderAgentMapRankedTags(
  input: AgentMapRenderInput,
): AgentMapRenderOutput {
  const contextLines = Math.max(0, Math.floor(input.contextLines ?? 1));
  const maxSymbols = Math.max(0, Math.floor(input.maxSymbols ?? input.rankedTags.length));
  const files = buildAgentMapRenderSourceFacts(input.files);
  const selected = input.rankedTags.slice(0, maxSymbols);
  if (selected.length === 0) {
    return { content: "", tokenEstimate: 0, renderedSymbols: [] };
  }

  const renderedSymbols = renderAgentMapSymbolBlocks({
    rankedTags: selected,
    files,
    contextLines,
  });
  const content = renderAgentMapRenderedContent({
    renderedSymbols,
    tokenBudget: input.tokenBudget,
  });
  return {
    content,
    tokenEstimate: estimateAgentMapTokens(content),
    renderedSymbols,
  };
}

export async function buildBudgetedAgentMapResult(
  input: BuildBudgetedAgentMapInput,
): Promise<AgentMapResult> {
  const request = normalizeAgentMapRequestPaths(input.request);
  const preparedSources = prepareAgentMapSourceFiles(input.files, input.inputLimits);
  const files = preparedSources.files;
  const extraction = await extractAgentMapTagsFromSourcesWithDiagnostics({
    files,
    cache: input.cache,
    refreshPolicy: request.refreshPolicy,
  });
  const diagnostics = [...preparedSources.diagnostics, ...extraction.diagnostics];
  if (files.length === 0) {
    diagnostics.push(buildAgentMapTraceDiagnostic({
      code: "empty_candidate_set",
      severity: "warning",
      message: "AgentMap had no processable source files after input hardening filters.",
      ref: "agent-map:diagnostic:empty-candidate-set",
      metadata: {
        inputFileCount: preparedSources.inputFileCount,
        skippedFileCount: preparedSources.diagnostics.length,
      },
    }));
  }
  const tags = extraction.tags;
  const ranking = rankAgentMapTagsForBudgetedRender({
    request,
    tags,
    tokenBudget: request.tokenBudget,
  });
  const ranked = ranking.ranked;
  const render = fitAgentMapRenderToBudget({
    rankedTags: ranked,
    files,
    tokenBudget: request.tokenBudget,
    contextLines: input.contextLines,
  });
  const includedTagIds = new Set(render.renderedSymbols.map((rankedTag) => rankedTag.tag.tagId));
  const candidateFiles = new Set(request.candidateFiles);
  const definitionTags: AgentMapTag[] = [];
  for (const tag of tags) {
    if (tag.kind !== "definition") {
      continue;
    }
    const file = tag.file;
    if (candidateFiles.size === 0 || candidateFiles.has(file)) {
      definitionTags.push(tag);
    }
  }
  const includedFiles = buildIncludedFileSelections(render.renderedSymbols);
  const excludedFiles = buildExcludedFileSelections({
    request,
    definitions: definitionTags,
    includedTagIds,
    files,
    ranked,
    diagnostics,
  });
  const status = resolveAgentMapResultStatus({
    candidateDefinitionCount: definitionTags.length,
    rankedDefinitionCount: ranking.rankedDefinitionCount,
    includedDefinitionCount: render.renderedSymbols.length,
    tokenBudget: request.tokenBudget,
  });
  const resultEvidenceRefs: EvidenceRef[] = [{
    type: "trace",
    ref: "agent-map:result:budgeted-render",
    label: "AgentMap budgeted readonly render",
  }];
  const evidenceRefs = mergeEvidenceRefs([
    ...resultEvidenceRefs,
    ...diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs),
  ]);
  const diagnosticEvidence = buildAgentMapDiagnosticEvidence({
    diagnostics,
    preparedSources,
  });

  return {
    schemaVersion: 1,
    status,
    readonly: true,
    content: render.content,
    tokenBudget: request.tokenBudget,
    tokenEstimate: render.tokenEstimate,
    includedFiles,
    excludedFiles,
    includedSymbols: render.renderedSymbols,
    evidence: [
      {
        evidenceId: "agent-map:evidence:tag-extraction",
        type: "tagExtraction",
        summary: `Extracted ${tags.length} TypeScript/TSX AgentMap tags from ${files.length} processable files.`,
        evidenceRefs: files.map((file) => ({
          type: "file",
          ref: file.file,
          label: "AgentMap source fixture",
        })),
        tagIds: tags.map((tag) => tag.tagId),
        metadata: {
          extractor: "typescript-compiler-api",
          inputFileCount: preparedSources.inputFileCount,
          processableFileCount: files.length,
          skippedFileCount: diagnostics.filter((diagnostic) => diagnostic.file).length,
          inputLimits: agentMapInputLimitsMetadata(preparedSources.limits),
        },
      },
      {
        evidenceId: "agent-map:evidence:ranking",
        type: "ranking",
        summary: `Ranked ${ranking.rankedDefinitionCount} definitions using active files, mentions, path components, and references.`,
        evidenceRefs: render.renderedSymbols.flatMap((rankedTag) => rankedTag.evidenceRefs),
        tagIds: render.renderedSymbols.map((rankedTag) => rankedTag.tag.tagId),
        reasonKinds: uniqueReasonKinds(render.renderedSymbols),
      },
      {
        evidenceId: "agent-map:evidence:budget",
        type: "budget",
        summary: `Fit AgentMap render by reducing selected symbols to ${render.renderedSymbols.length}.`,
        evidenceRefs: resultEvidenceRefs,
        tagIds: render.renderedSymbols.map((rankedTag) => rankedTag.tag.tagId),
        reasonKinds: ["budgetFit"],
        metadata: {
          budgetStrategy: "reduce-symbol-count-rerender",
          tokenBudget: request.tokenBudget,
          tokenEstimate: render.tokenEstimate,
        },
      },
      {
        evidenceId: "agent-map:evidence:render",
        type: "render",
        summary: "Rendered complete file-grouped symbol blocks with line ranges.",
        evidenceRefs: resultEvidenceRefs,
        tagIds: render.renderedSymbols.map((rankedTag) => rankedTag.tag.tagId),
      },
      ...diagnosticEvidence,
    ],
    evidenceRefs,
    diagnostics,
    metadata: {
      phase: "line-b-agentmap-ranking-render",
      readonlyOnly: true,
      inputFileCount: preparedSources.inputFileCount,
      processableFileCount: files.length,
      skippedFileCount: diagnostics.filter((diagnostic) => diagnostic.file).length,
      diagnosticCount: diagnostics.length,
      diagnostics: diagnostics.map(agentMapDiagnosticMetadata),
      totalTagCount: tags.length,
      rankedDefinitionCount: ranking.rankedDefinitionCount,
      selectedSymbolCount: render.renderedSymbols.length,
    },
  };
}

function buildAgentMapDiagnosticEvidence(params: {
  diagnostics: AgentMapDiagnostic[];
  preparedSources: PreparedAgentMapSources;
}): AgentMapEvidence[] {
  if (params.diagnostics.length === 0) {
    return [];
  }
  return [{
    evidenceId: "agent-map:evidence:diagnostics",
    type: "diagnostic",
    summary: `Recorded ${params.diagnostics.length} AgentMap hardening diagnostics.`,
    evidenceRefs: mergeEvidenceRefs(params.diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs)),
    metadata: {
      diagnosticCount: params.diagnostics.length,
      diagnosticCodes: uniqueStrings(params.diagnostics.map((diagnostic) => diagnostic.code)),
      inputFileCount: params.preparedSources.inputFileCount,
      processableFileCount: params.preparedSources.files.length,
      skippedFileCount: params.diagnostics.filter((diagnostic) => diagnostic.file).length,
      inputLimits: agentMapInputLimitsMetadata(params.preparedSources.limits),
      diagnostics: params.diagnostics.map(agentMapDiagnosticMetadata),
    },
  }];
}

function agentMapInputLimitsMetadata(
  limits: NormalizedAgentMapInputLimits,
): RuntimeCoreJsonObject {
  return {
    maxFiles: limits.maxFiles,
    maxFileBytes: limits.maxFileBytes,
    ignoredDirectories: limits.ignoredDirectories,
  };
}

function agentMapDiagnosticMetadata(
  diagnostic: AgentMapDiagnostic,
): RuntimeCoreJsonObject {
  const metadata: RuntimeCoreJsonObject = {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
  };
  if (diagnostic.file) {
    metadata.file = diagnostic.file;
  }
  return metadata;
}

function isStringItems(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isRequiredStringItems(value: unknown): value is string[] {
  return isStringItems(value) && value.length > 0;
}

function isEvidenceRefs(value: unknown): value is EvidenceRef[] {
  return Array.isArray(value) && value.every(isEvidenceRef);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

async function loadAgentMapTypeScriptRuntime(): Promise<TypeScriptRuntime> {
  if (agentMapTypeScriptRuntimeForTest) {
    return agentMapTypeScriptRuntimeForTest;
  }
  agentMapTypeScriptRuntimePromise ??= import("typescript");
  return await agentMapTypeScriptRuntimePromise;
}

function prepareAgentMapSourceFiles(
  files: AgentMapSourceFile[],
  inputLimits: AgentMapInputLimits | undefined,
): PreparedAgentMapSources {
  const limits = normalizeAgentMapInputLimits(inputLimits);
  const preparedFiles: AgentMapSourceFile[] = [];
  const diagnostics: AgentMapDiagnostic[] = [];

  for (const source of files) {
    const normalizedSource = normalizeAgentMapSourceFile(source);
    const diagnostic = diagnosticForAgentMapSourceFile(normalizedSource, limits);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }
    if (preparedFiles.length >= limits.maxFiles) {
      diagnostics.push(buildAgentMapSourceDiagnostic({
        code: "max_files_exceeded",
        severity: "info",
        source: normalizedSource,
        message: `Skipped ${normalizedSource.file} because AgentMap reached the max file boundary.`,
        metadata: {
          maxFiles: limits.maxFiles,
          acceptedFileCount: preparedFiles.length,
        },
      }));
      continue;
    }
    preparedFiles.push(normalizedSource);
  }

  return {
    files: preparedFiles,
    diagnostics,
    limits,
    inputFileCount: files.length,
  };
}

function normalizeAgentMapInputLimits(
  inputLimits: AgentMapInputLimits | undefined,
): NormalizedAgentMapInputLimits {
  return {
    maxFiles: normalizeNonNegativeLimit(
      inputLimits?.maxFiles,
      AGENT_MAP_DEFAULT_INPUT_LIMITS.maxFiles,
    ),
    maxFileBytes: normalizeNonNegativeLimit(
      inputLimits?.maxFileBytes,
      AGENT_MAP_DEFAULT_INPUT_LIMITS.maxFileBytes,
    ),
    ignoredDirectories: uniqueStrings([
      ...AGENT_MAP_DEFAULT_INPUT_LIMITS.ignoredDirectories,
      ...(inputLimits?.ignoredDirectories ?? []),
    ].map((directory) => normalizeAgentMapPath(directory).toLowerCase())),
  };
}

function normalizeNonNegativeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(Number(value)));
}

function diagnosticForAgentMapSourceFile(
  source: AgentMapSourceFile,
  limits: NormalizedAgentMapInputLimits,
): AgentMapDiagnostic | undefined {
  const ignoredDirectory = matchedAgentMapIgnoredDirectory(source.file, limits.ignoredDirectories);
  if (ignoredDirectory) {
    return buildAgentMapSourceDiagnostic({
      code: "ignored_directory",
      severity: "info",
      source,
      message: `Skipped ${source.file} because it is under an ignored directory.`,
      metadata: { directory: ignoredDirectory },
    });
  }

  if (!isSupportedAgentMapLanguage(source.language ?? inferAgentMapLanguage(source.file))) {
    return buildAgentMapSourceDiagnostic({
      code: "unsupported_extension",
      severity: "info",
      source,
      message: `Skipped ${source.file} because AgentMap does not extract that extension.`,
      metadata: { supportedExtensions: [...AGENT_MAP_SUPPORTED_EXTENSIONS] },
    });
  }

  const byteLength = agentMapFileByteLength(source.content);
  if (byteLength > limits.maxFileBytes) {
    return buildAgentMapSourceDiagnostic({
      code: "max_file_bytes_exceeded",
      severity: "info",
      source,
      message: `Skipped ${source.file} because it exceeds the AgentMap max file bytes boundary.`,
      metadata: {
        byteLength,
        maxFileBytes: limits.maxFileBytes,
      },
    });
  }

  const binaryReason = detectAgentMapBinaryContent(source.content);
  if (binaryReason) {
    return buildAgentMapSourceDiagnostic({
      code: "binary_file",
      severity: "info",
      source,
      message: `Skipped ${source.file} because AgentMap treats it as binary content.`,
      metadata: { binaryReason },
    });
  }

  const generatedReason = detectAgentMapGeneratedSource(source);
  if (generatedReason) {
    return buildAgentMapSourceDiagnostic({
      code: "generated_file",
      severity: "info",
      source,
      message: `Skipped ${source.file} because AgentMap treats it as generated content.`,
      metadata: { generatedReason },
    });
  }

  return undefined;
}

function buildAgentMapSourceDiagnostic(params: {
  code: AgentMapDiagnosticCode;
  severity: AgentMapDiagnosticSeverity;
  source: AgentMapSourceFile;
  message: string;
  metadata?: RuntimeCoreJsonObject;
}): AgentMapDiagnostic {
  const language = params.source.language ?? inferAgentMapLanguage(params.source.file);
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    file: params.source.file,
    evidenceRefs: [{
      type: "file",
      ref: params.source.file,
      label: "AgentMap input diagnostic",
      metadata: { diagnosticCode: params.code },
    }],
    metadata: {
      readonly: true,
      language,
      byteLength: agentMapFileByteLength(params.source.content),
      ...params.metadata,
    },
  };
}

function buildAgentMapTraceDiagnostic(params: {
  code: AgentMapDiagnosticCode;
  severity: AgentMapDiagnosticSeverity;
  message: string;
  ref: string;
  metadata?: RuntimeCoreJsonObject;
}): AgentMapDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    evidenceRefs: [{
      type: "trace",
      ref: params.ref,
      label: "AgentMap result diagnostic",
      metadata: { diagnosticCode: params.code },
    }],
    metadata: {
      readonly: true,
      ...params.metadata,
    },
  };
}

function matchedAgentMapIgnoredDirectory(
  file: string,
  ignoredDirectories: string[],
): string | undefined {
  const ignored = new Set(ignoredDirectories.map((directory) => directory.toLowerCase()));
  const directories = normalizeAgentMapPath(file).split("/").slice(0, -1);
  return directories.find((directory) => ignored.has(directory.toLowerCase()));
}

function agentMapFileByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

function detectAgentMapBinaryContent(content: string): string | undefined {
  if (content.includes("\u0000")) {
    return "nul-byte";
  }
  const sample = content.slice(0, 8_192);
  if (sample.length === 0) {
    return undefined;
  }
  let controlCharacters = 0;
  for (const character of sample) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCharacters += 1;
    }
  }
  return controlCharacters / sample.length > 0.1
    ? "control-character-ratio"
    : undefined;
}

function detectAgentMapGeneratedSource(source: AgentMapSourceFile): string | undefined {
  const lowerFile = source.file.toLowerCase();
  const fileName = lowerFile.split("/").at(-1) ?? lowerFile;
  if (lowerFile.includes("/__generated__/") || lowerFile.includes("/generated/")) {
    return "generated-directory";
  }
  if (AGENT_MAP_GENERATED_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
    return "generated-file-name";
  }

  const header = source.content.slice(0, 4_096).toLowerCase();
  if (
    header.includes("@generated") ||
    header.includes("<auto-generated") ||
    header.includes("this file is generated") ||
    header.includes("auto-generated")
  ) {
    return "generated-header";
  }
  if (header.includes("generated") && header.includes("do not edit")) {
    return "generated-do-not-edit-header";
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractAgentMapTagsFromSourceWithDiagnostics(
  ts: TypeScriptRuntime,
  source: AgentMapSourceFile,
): AgentMapSourceTagExtraction {
  const normalizedSource = normalizeAgentMapSourceFile(source);
  const language = normalizedSource.language ?? inferAgentMapLanguage(normalizedSource.file);
  if (!isSupportedAgentMapLanguage(language)) {
    return { tags: [] };
  }

  let sourceFile: TypeScriptSourceFile;
  try {
    sourceFile = ts.createSourceFile(
      normalizedSource.file,
      normalizedSource.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForAgentMapLanguage(ts, language),
    );
  } catch (error) {
    return {
      tags: [],
      diagnostic: buildAgentMapSourceDiagnostic({
        code: "parse_failure",
        severity: "warning",
        source: normalizedSource,
        message: `Skipped ${normalizedSource.file} after AgentMap parser threw.`,
        metadata: { error: errorMessage(error) },
      }),
    };
  }

  const parseDiagnostics = (
    sourceFile as TypeScriptSourceFile & { parseDiagnostics?: Array<{ code?: number }> }
  ).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    return {
      tags: [],
      diagnostic: buildAgentMapSourceDiagnostic({
        code: "parse_failure",
        severity: "warning",
        source: normalizedSource,
        message: `Skipped ${normalizedSource.file} after TypeScript parse diagnostics.`,
        metadata: {
          diagnosticCount: parseDiagnostics.length,
          firstDiagnosticCode: parseDiagnostics[0]?.code ?? "unknown",
        },
      }),
    };
  }

  try {
    return { tags: collectAgentMapTagsFromParsedSource(ts, normalizedSource, language, sourceFile) };
  } catch (error) {
    return {
      tags: [],
      diagnostic: buildAgentMapSourceDiagnostic({
        code: "parse_failure",
        severity: "warning",
        source: normalizedSource,
        message: `Skipped ${normalizedSource.file} after AgentMap extraction failed.`,
        metadata: { error: errorMessage(error) },
      }),
    };
  }
}

function collectAgentMapTagsFromParsedSource(
  ts: TypeScriptRuntime,
  normalizedSource: AgentMapSourceFile,
  language: AgentMapLanguage,
  sourceFile: TypeScriptSourceFile,
): AgentMapTag[] {
  const definitionNameNodes = new Set<TypeScriptNode>();
  const definitions: AgentMapTag[] = [];
  const references: AgentMapTag[] = [];
  const lines = normalizedSource.content.split("\n");
  const lineCache: AgentMapLineCache = { lines, trimmedLines: [] };
  let definitionIndex = 0;
  let referenceIndex = 0;

  const collectTags = (node: TypeScriptNode): void => {
    const name = getDefinitionIdentifier(ts, node);
    if (name && shouldCollectDefinition(ts, node)) {
      definitionNameNodes.add(name);
      const tag = buildAgentMapDefinitionTag({
        ts,
        node,
        name,
        sourceFile,
        source: normalizedSource,
        lineCache,
        language,
        index: definitionIndex,
      });
      definitions.push(tag);
      definitionIndex += 1;
    }
    if (
      ts.isIdentifier(node) &&
      !definitionNameNodes.has(node) &&
      isReferenceIdentifier(ts, node)
    ) {
      references.push(buildAgentMapReferenceTag({
        ts,
        node,
        sourceFile,
        source: normalizedSource,
        lineCache,
        language,
        index: referenceIndex,
      }));
      referenceIndex += 1;
    }
    ts.forEachChild(node, collectTags);
  };
  collectTags(sourceFile);

  return [...definitions, ...references];
}

function buildAgentMapDefinitionTag(params: {
  ts: TypeScriptRuntime;
  node: TypeScriptNode;
  name: TypeScriptIdentifier;
  sourceFile: TypeScriptSourceFile;
  source: AgentMapSourceFile;
  lineCache: AgentMapLineCache;
  language: AgentMapLanguage;
  index: number;
}): AgentMapTag {
  const range = rangeForNode(params.sourceFile, params.node);
  const selectionRange = rangeForNode(params.sourceFile, params.name);
  const symbolKind = inferAgentMapSymbolKind(params.ts, params.node, params.name.text, params.language);
  return {
    tagId: tagIdForAgentMapTag({
      file: params.source.file,
      name: params.name.text,
      kind: "definition",
      line: selectionRange.startLine,
      column: selectionRange.startColumn,
      index: params.index,
    }),
    file: params.source.file,
    language: params.language,
    kind: "definition",
    symbolKind,
    name: params.name.text,
    namePath: namePathForNode(params.ts, params.node, params.name.text),
    range,
    selectionRange,
    signature: signatureForNode(params.lineCache, range),
    snippet: lineForRange(params.lineCache, selectionRange),
    exported: isExportedDefinition(params.ts, params.node),
    evidenceRefs: [{
      type: "file",
      ref: `${params.source.file}:${selectionRange.startLine}`,
      label: "AgentMap symbol definition",
      metadata: { extractor: "typescript-compiler-api" },
    }],
    metadata: {
      extractedBy: "typescript-compiler-api",
      readonly: true,
    },
  };
}

function buildAgentMapReferenceTag(params: {
  ts: TypeScriptRuntime;
  node: TypeScriptIdentifier;
  sourceFile: TypeScriptSourceFile;
  source: AgentMapSourceFile;
  lineCache: AgentMapLineCache;
  language: AgentMapLanguage;
  index: number;
}): AgentMapTag {
  const range = rangeForNode(params.sourceFile, params.node);
  return {
    tagId: tagIdForAgentMapTag({
      file: params.source.file,
      name: params.node.text,
      kind: "reference",
      line: range.startLine,
      column: range.startColumn,
      index: params.index,
    }),
    file: params.source.file,
    language: params.language,
    kind: "reference",
    symbolKind: "unknown",
    name: params.node.text,
    namePath: [params.node.text],
    range,
    selectionRange: range,
    snippet: lineForRange(params.lineCache, range),
    evidenceRefs: [{
      type: "file",
      ref: `${params.source.file}:${range.startLine}`,
      label: "AgentMap symbol reference",
      metadata: { extractor: "typescript-compiler-api" },
    }],
    metadata: {
      extractedBy: "typescript-compiler-api",
      readonly: true,
    },
  };
}

function normalizeAgentMapRequestPaths(request: AgentMapRequest): AgentMapRequest {
  return {
    ...request,
    activeFiles: uniqueStrings(request.activeFiles.map(normalizeAgentMapPath)),
    candidateFiles: uniqueStrings(request.candidateFiles.map(normalizeAgentMapPath)),
    mentionedFiles: uniqueStrings(request.mentionedFiles.map(normalizeAgentMapPath)),
    promptPresentFiles: uniqueStrings(request.promptPresentFiles.map(normalizeAgentMapPath)),
  };
}

function normalizeAgentMapSourceFile(source: AgentMapSourceFile): AgentMapSourceFile {
  return {
    ...source,
    file: normalizeAgentMapPath(source.file),
    language: source.language ?? inferAgentMapLanguage(source.file),
    content: source.content.replace(/\r\n/g, "\n"),
  };
}

function normalizeAgentMapPath(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//u, "");
}

function inferAgentMapLanguage(file: string): AgentMapLanguage {
  const lower = normalizeAgentMapPath(file).toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  ) {
    return "typescript";
  }
  if (lower.endsWith(".jsx")) return "jsx";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "javascript";
  }
  return "unknown";
}

function isSupportedAgentMapLanguage(language: AgentMapLanguage): boolean {
  return (
    language === "typescript" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "jsx"
  );
}

function scriptKindForAgentMapLanguage(
  ts: TypeScriptRuntime,
  language: AgentMapLanguage,
): import("typescript").ScriptKind {
  switch (language) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "jsx":
      return ts.ScriptKind.JSX;
    case "javascript":
      return ts.ScriptKind.JS;
    case "typescript":
    case "unknown":
      return ts.ScriptKind.TS;
  }
}

function getDefinitionIdentifier(
  ts: TypeScriptRuntime,
  node: TypeScriptNode,
): TypeScriptIdentifier | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name;
  }
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node)) &&
    ts.isIdentifier(node.name)
  ) {
    return node.name;
  }
  return undefined;
}

function shouldCollectDefinition(ts: TypeScriptRuntime, node: TypeScriptNode): boolean {
  if (ts.isVariableDeclaration(node)) {
    return isTopLevelVariableDeclaration(ts, node);
  }
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node)
  ) {
    return true;
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return isTopLevelLikeDeclaration(ts, node);
  }
  return false;
}

function isTopLevelVariableDeclaration(
  ts: TypeScriptRuntime,
  node: import("typescript").VariableDeclaration,
): boolean {
  const declarationList = node.parent;
  const statement = declarationList.parent;
  return ts.isVariableStatement(statement) && isTopLevelLikeDeclaration(ts, statement);
}

function isTopLevelLikeDeclaration(ts: TypeScriptRuntime, node: TypeScriptNode): boolean {
  const parent = node.parent;
  return ts.isSourceFile(parent) || ts.isModuleBlock(parent);
}

function isReferenceIdentifier(ts: TypeScriptRuntime, node: TypeScriptIdentifier): boolean {
  const text = node.text;
  if (!isReferenceName(text)) {
    return false;
  }
  const parent = node.parent;
  if (
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node)
  ) {
    return false;
  }
  return true;
}

function isReferenceName(name: string): boolean {
  if (name.length === 0 || REFERENCE_NAME_STOP_WORDS.has(name)) {
    return false;
  }
  if (!isReferenceNameStartCode(name.charCodeAt(0))) {
    return false;
  }
  for (let index = 1; index < name.length; index += 1) {
    if (!isReferenceNamePartCode(name.charCodeAt(index))) {
      return false;
    }
  }
  return true;
}

function isReferenceNameStartCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36
  );
}

function isReferenceNamePartCode(code: number): boolean {
  return isReferenceNameStartCode(code) || (code >= 48 && code <= 57);
}

const REFERENCE_NAME_STOP_WORDS = new Set([
  "React",
  "undefined",
  "console",
  "window",
  "document",
  "Promise",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
]);

function inferAgentMapSymbolKind(
  ts: TypeScriptRuntime,
  node: TypeScriptNode,
  name: string,
  language: AgentMapLanguage,
): AgentMapSymbolKind {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return "type";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return "method";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return "property";
  if (ts.isFunctionDeclaration(node)) {
    return functionLikeSymbolKind(name, language);
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      return functionLikeSymbolKind(name, language);
    }
    return /^[A-Z0-9_]+$/u.test(name) ? "constant" : "variable";
  }
  return "unknown";
}

function functionLikeSymbolKind(name: string, language: AgentMapLanguage): AgentMapSymbolKind {
  if (/^use[A-Z0-9]/u.test(name)) return "hook";
  if ((language === "tsx" || language === "jsx") && /^[A-Z]/u.test(name)) return "component";
  return "function";
}

function isExportedDefinition(ts: TypeScriptRuntime, node: TypeScriptNode): boolean {
  const target = ts.isVariableDeclaration(node) && ts.isVariableStatement(node.parent.parent)
    ? node.parent.parent
    : node;
  const modifiers = ts.canHaveModifiers(target) ? ts.getModifiers(target) : undefined;
  return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function namePathForNode(
  ts: TypeScriptRuntime,
  node: TypeScriptNode,
  name: string,
): string[] {
  if (isTopLevelLikeDeclaration(ts, node)) {
    return [name];
  }
  if (ts.isVariableDeclaration(node) && isTopLevelVariableDeclaration(ts, node)) {
    return [name];
  }
  const containers: string[] = [];
  let current: TypeScriptNode | undefined = node.parent;
  while (current) {
    if (
      (ts.isClassDeclaration(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isFunctionDeclaration(current)) &&
      current.name &&
      ts.isIdentifier(current.name)
    ) {
      containers.push(current.name.text);
    }
    current = current.parent;
  }
  return [...containers.reverse(), name];
}

function rangeForNode(
  sourceFile: TypeScriptSourceFile,
  node: TypeScriptNode,
): AgentMapRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character,
    endLine: end.line + 1,
    endColumn: end.character,
  };
}

function lineForRange(lineCache: AgentMapLineCache, range: AgentMapRange): string {
  const index = range.startLine - 1;
  const cached = lineCache.trimmedLines[index];
  if (cached !== undefined) {
    return cached;
  }
  const trimmed = lineCache.lines[index]?.trim() ?? "";
  lineCache.trimmedLines[index] = trimmed;
  return trimmed;
}

function signatureForNode(lineCache: AgentMapLineCache, range: AgentMapRange): string {
  const line = lineForRange(lineCache, range);
  const braceIndex = line.indexOf("{");
  if (braceIndex > 0) {
    return line.slice(0, braceIndex).trimEnd();
  }
  return line;
}

function tagIdForAgentMapTag(params: {
  file: string;
  name: string;
  kind: AgentMapTagKind;
  line: number;
  column: number;
  index: number;
}): string {
  const safeFile = normalizeAgentMapPath(params.file).replace(/[^A-Za-z0-9_./-]/gu, "_");
  const safeName = params.name.replace(/[^A-Za-z0-9_$.-]/gu, "_");
  return `tag:${safeFile}:${params.line}:${params.column}:${safeName}:${params.kind}:${params.index}`;
}

function estimateAgentMapTokens(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateAgentMapTokensForLength(length: number): number {
  return length <= 0 ? 0 : Math.max(1, Math.ceil(length / 4));
}

function splitPathTokens(value: string): string[] {
  return uniqueStrings(
    normalizeAgentMapPath(value)
      .split(/[/. _-]+/u)
      .flatMap((part) => splitSearchTokens(part)),
  );
}

function splitSearchTokens(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2");
  return uniqueStrings(
    spaced
      .split(/[^A-Za-z0-9]+/u)
      .map(normalizeSearchText)
      .filter((token) => token.length > 0),
  );
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function rankedTagTieBreakKey(tag: AgentMapTag): string {
  return `${tag.file}:${tag.name}:${tag.range.startLine}:${tag.range.startColumn}`;
}

function compareAgentMapScoreRecords(
  left: AgentMapScoreRecord,
  right: AgentMapScoreRecord,
): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return left.facts.tieBreakKey.localeCompare(right.facts.tieBreakKey);
}

function mergeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const merged: EvidenceRef[] = [];
  for (const ref of refs) {
    pushUniqueEvidenceRef(merged, seen, ref);
  }
  return merged;
}

function mergeRankedTagEvidenceRefs(
  tagEvidenceRefs: readonly EvidenceRef[],
  reasons: readonly AgentMapRankingReason[],
): EvidenceRef[] {
  const seen = new Set<string>();
  const merged: EvidenceRef[] = [];
  for (const ref of tagEvidenceRefs) {
    pushUniqueEvidenceRef(merged, seen, ref);
  }
  for (const reason of reasons) {
    for (const ref of reason.evidenceRefs) {
      pushUniqueEvidenceRef(merged, seen, ref);
    }
  }
  return merged;
}

function pushUniqueEvidenceRef(
  merged: EvidenceRef[],
  seen: Set<string>,
  ref: EvidenceRef,
): void {
  const key = `${ref.type}:${ref.ref}:${ref.label ?? ""}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  merged.push(ref);
}

function renderAgentMapSymbolBlock(params: {
  rankedTag: AgentMapRankedTag;
  source: AgentMapRenderSourceFacts | undefined;
  contextLines: number;
}): string {
  const tag = params.rankedTag.tag;
  const lines = params.source?.lines ?? [];
  const startLine = Math.max(1, tag.range.startLine - params.contextLines);
  const endLine = Math.min(lines.length, tag.range.endLine + params.contextLines);
  const width = String(endLine).length;
  const sourceLines = lines.slice(startLine - 1, endLine).map((line, index) => {
    const lineNumber = startLine + index;
    return `${String(lineNumber).padStart(width, " ")} | ${line}`;
  });
  const reasons = params.rankedTag.reasons
    .map((reason) => `${reason.kind}${formatScoreDelta(reason.scoreDelta)}`)
    .join(", ");
  return [
    `@@ symbol ${tag.namePath.join(".")} (${tag.symbolKind}) ${tag.file}:${tag.range.startLine}:${tag.range.startColumn}-${tag.range.endLine}:${tag.range.endColumn}`,
    `rank: ${params.rankedTag.rank} score: ${formatScore(params.rankedTag.score)} reasons: ${reasons}`,
    ...sourceLines,
    `@@ end ${tag.tagId}`,
  ].join("\n");
}

function buildAgentMapRenderSourceFacts(
  files: AgentMapSourceFile[],
): Map<string, AgentMapRenderSourceFacts> {
  const facts = new Map<string, AgentMapRenderSourceFacts>();
  for (const file of files) {
    const normalized = normalizeAgentMapSourceFile(file);
    facts.set(normalized.file, {
      lines: normalized.content.split("\n"),
    });
  }
  return facts;
}

function renderAgentMapSymbolBlocks(input: {
  rankedTags: AgentMapRankedTag[];
  files: Map<string, AgentMapRenderSourceFacts>;
  contextLines: number;
}): AgentMapRankedTag[] {
  const renderedSymbols: AgentMapRankedTag[] = [];
  for (const rankedTag of input.rankedTags) {
    renderedSymbols.push(renderAgentMapRankedSymbol({
      rankedTag,
      files: input.files,
      contextLines: input.contextLines,
    }));
  }
  return renderedSymbols;
}

function renderAgentMapRankedSymbol(params: {
  rankedTag: AgentMapRankedTag;
  files: Map<string, AgentMapRenderSourceFacts>;
  contextLines: number;
}): AgentMapRankedTag {
  const source = params.files.get(params.rankedTag.tag.file);
  const renderedBlock = renderAgentMapSymbolBlock({
    rankedTag: params.rankedTag,
    source,
    contextLines: params.contextLines,
  });
  return {
    ...params.rankedTag,
    tokenEstimate: estimateAgentMapTokens(renderedBlock),
    renderedBlock,
    reasons: ensureBudgetFitReason(params.rankedTag.reasons, params.rankedTag.tag.evidenceRefs),
  };
}

function renderAgentMapRenderedContent(input: {
  renderedSymbols: AgentMapRankedTag[];
  tokenBudget?: number;
}): string {
  const fileGroups = groupRankedTagsByFile(input.renderedSymbols);
  const body = fileGroups.flatMap(([file, tags]) => [
    `## ${file}`,
    ...tags.flatMap((tag) => [tag.renderedBlock ?? "", ""]),
  ]);
  return [
    "AgentMap readonly diagnostic",
    `symbolCount: ${input.renderedSymbols.length}`,
    input.tokenBudget === undefined ? "" : `tokenBudget: ${input.tokenBudget}`,
    "",
    ...body,
  ].filter((line, index, values) => line || values[index - 1] !== "").join("\n").trimEnd();
}

function estimateAgentMapRenderedContentLength(input: {
  symbolCount: number;
  tokenBudget?: number;
  bodyLength: number;
}): number {
  let headerLength = "AgentMap readonly diagnostic".length +
    1 +
    `symbolCount: ${input.symbolCount}`.length;
  if (input.tokenBudget !== undefined) {
    headerLength += 1 + `tokenBudget: ${input.tokenBudget}`.length;
  }
  return headerLength + (input.bodyLength > 0 ? 2 + input.bodyLength : 0);
}

function estimateAgentMapRenderedSymbolAppendLength(
  selectedCount: number,
  selectedFiles: Set<string>,
  rankedTag: AgentMapRankedTag,
): number {
  const renderedBlockLength = (rankedTag.renderedBlock ?? "").length;
  if (selectedCount === 0) {
    return 4 + rankedTag.tag.file.length + renderedBlockLength;
  }
  if (selectedFiles.has(rankedTag.tag.file)) {
    return 2 + renderedBlockLength;
  }
  return 6 + rankedTag.tag.file.length + renderedBlockLength;
}

function formatScoreDelta(value: number): string {
  if (value === 0) return "+0";
  return value > 0 ? `+${formatScore(value)}` : formatScore(value);
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function ensureBudgetFitReason(
  reasons: AgentMapRankingReason[],
  evidenceRefs: EvidenceRef[],
): AgentMapRankingReason[] {
  if (reasons.some((reason) => reason.kind === "budgetFit")) {
    return reasons;
  }
  return [
    ...reasons,
    {
      kind: "budgetFit",
      scoreDelta: 0,
      evidenceRefs,
      metadata: { strategy: "reduce-symbol-count-rerender" },
    },
  ];
}

function groupRankedTagsByFile(tags: AgentMapRankedTag[]): Array<[string, AgentMapRankedTag[]]> {
  const groups = new Map<string, AgentMapRankedTag[]>();
  for (const tag of tags) {
    let group = groups.get(tag.tag.file);
    if (!group) {
      group = [];
      groups.set(tag.tag.file, group);
    }
    group.push(tag);
  }
  return [...groups.entries()];
}

function fitAgentMapRenderToBudget(input: {
  rankedTags: AgentMapRankedTag[];
  files: AgentMapSourceFile[];
  tokenBudget: number;
  contextLines?: number;
}): AgentMapRenderOutput {
  const budget = Math.max(0, Math.floor(input.tokenBudget));
  if (budget <= 0 || input.rankedTags.length === 0) {
    return { content: "", tokenEstimate: 0, renderedSymbols: [] };
  }
  const contextLines = Math.max(0, Math.floor(input.contextLines ?? 1));
  const files = buildAgentMapRenderSourceFacts(input.files);
  const selected: AgentMapRankedTag[] = [];
  const selectedFiles = new Set<string>();
  let estimatedBodyLength = 0;
  for (const rankedTag of input.rankedTags) {
    const rendered = renderAgentMapRankedSymbol({
      rankedTag,
      files,
      contextLines,
    });
    const nextBodyLength = estimatedBodyLength +
      estimateAgentMapRenderedSymbolAppendLength(selected.length, selectedFiles, rendered);
    const tokenEstimate = estimateAgentMapTokensForLength(
      estimateAgentMapRenderedContentLength({
        symbolCount: selected.length + 1,
        tokenBudget: budget,
        bodyLength: nextBodyLength,
      }),
    );
    if (tokenEstimate > budget) {
      break;
    }
    selected.push(rendered);
    selectedFiles.add(rendered.tag.file);
    estimatedBodyLength = nextBodyLength;
  }
  if (selected.length === 0) {
    return { content: "", tokenEstimate: 0, renderedSymbols: [] };
  }
  const content = renderAgentMapRenderedContent({
    renderedSymbols: selected,
    tokenBudget: budget,
  });
  return {
    content,
    tokenEstimate: estimateAgentMapTokens(content),
    renderedSymbols: selected,
  };
}

function buildIncludedFileSelections(
  rankedTags: AgentMapRankedTag[],
): AgentMapFileSelection[] {
  return groupRankedTagsByFile(rankedTags).map(([file, tags]) => ({
    file,
    included: true,
    reason: "budget",
    tagIds: tags.map((tag) => tag.tag.tagId),
    tokenEstimate: tags.reduce(
      (sum, tag) => sum + (tag.tokenEstimate ?? estimateAgentMapTokens(tag.renderedBlock ?? "")),
      0,
    ),
    evidenceRefs: [{
      type: "file",
      ref: file,
      label: "Included AgentMap file",
    }],
    metadata: { selectedSymbolCount: tags.length },
  }));
}

function buildExcludedFileSelections(params: {
  request: AgentMapRequest;
  definitions: AgentMapTag[];
  includedTagIds: Set<string>;
  files: AgentMapSourceFile[];
  ranked: AgentMapRankedTag[];
  diagnostics: AgentMapDiagnostic[];
}): AgentMapFileSelection[] {
  const definitionsByFile = new Map<string, AgentMapTag[]>();
  const definitionFileByTagId = new Map<string, string>();
  for (const definition of params.definitions) {
    const file = definition.file;
    definitionFileByTagId.set(definition.tagId, file);
    let definitions = definitionsByFile.get(file);
    if (!definitions) {
      definitions = [];
      definitionsByFile.set(file, definitions);
    }
    definitions.push(definition);
  }
  const rankedByFile = new Map<string, AgentMapRankedTag[]>();
  for (const rankedTag of params.ranked) {
    const file = rankedTag.tag.file;
    let rankedTags = rankedByFile.get(file);
    if (!rankedTags) {
      rankedTags = [];
      rankedByFile.set(file, rankedTags);
    }
    rankedTags.push(rankedTag);
  }
  const diagnosticsByFile = new Map<string, AgentMapDiagnostic[]>();
  for (const diagnostic of params.diagnostics) {
    if (!diagnostic.file) continue;
    const file = normalizeAgentMapPath(diagnostic.file);
    let diagnostics = diagnosticsByFile.get(file);
    if (!diagnostics) {
      diagnostics = [];
      diagnosticsByFile.set(file, diagnostics);
    }
    diagnostics.push(diagnostic);
  }
  const sourcesByFile = new Map<string, AgentMapSourceFile>();
  for (const file of params.files) {
    sourcesByFile.set(file.file, file);
  }
  const includedFiles = new Set<string>();
  for (const tagId of params.includedTagIds) {
    const file = definitionFileByTagId.get(tagId);
    if (file !== undefined) {
      includedFiles.add(file);
    }
  }
  const selections: AgentMapFileSelection[] = [];
  const selectionFiles = uniqueStrings([
    ...params.request.candidateFiles,
    ...diagnosticsByFile.keys(),
  ]);

  for (const file of selectionFiles) {
    if (includedFiles.has(file)) continue;
    const definitions = definitionsByFile.get(file) ?? [];
    const promptPresent = params.request.promptPresentFiles.includes(file);
    const source = sourcesByFile.get(file);
    const language = source?.language ?? inferAgentMapLanguage(file);
    const diagnostics = diagnosticsByFile.get(file) ?? [];
    const reason: AgentMapFileSelectionReason = diagnostics.length > 0
      ? "diagnostic"
      : promptPresent
      ? "promptPresentFile"
      : definitions.length > 0
        ? "budget"
        : language === "unknown"
          ? "unsupportedLanguage"
          : "noTags";
    const rankedTags = rankedByFile.get(file) ?? [];
    selections.push({
      file,
      included: false,
      reason,
      tagIds: definitions.map((tag) => tag.tagId),
      tokenEstimate: rankedTags.reduce((sum, tag) => sum + estimateAgentMapTokens(tag.renderedBlock ?? tag.tag.signature ?? ""), 0),
      evidenceRefs: diagnostics.length > 0
        ? mergeEvidenceRefs(diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs))
        : [{
          type: "file",
          ref: file,
          label: reason === "promptPresentFile" ? "Already present in prompt" : "Excluded AgentMap file",
        }],
      metadata: diagnostics.length > 0
        ? {
          definitionCount: definitions.length,
          diagnosticCodes: uniqueStrings(diagnostics.map((diagnostic) => diagnostic.code)),
          diagnostics: diagnostics.map(agentMapDiagnosticMetadata),
        }
        : { definitionCount: definitions.length },
    });
  }

  return selections;
}

function resolveAgentMapResultStatus(params: {
  candidateDefinitionCount: number;
  rankedDefinitionCount: number;
  includedDefinitionCount: number;
  tokenBudget: number;
}): AgentMapResultStatus {
  if (params.candidateDefinitionCount === 0 || params.rankedDefinitionCount === 0) {
    return "empty";
  }
  if (params.includedDefinitionCount === 0 && params.tokenBudget === 0) {
    return "budget_exhausted";
  }
  if (params.includedDefinitionCount === 0) {
    return "budget_exhausted";
  }
  return "success";
}

function uniqueReasonKinds(rankedTags: AgentMapRankedTag[]): AgentMapRankingReasonKind[] {
  return uniqueStrings(
    rankedTags.flatMap((rankedTag) => rankedTag.reasons.map((reason) => reason.kind)),
  ) as AgentMapRankingReasonKind[];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
