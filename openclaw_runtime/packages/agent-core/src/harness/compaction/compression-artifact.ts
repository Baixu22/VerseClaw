import type { AgentMessage } from "../../types.js";

export type CompressionEvidenceRef = {
  type: "session" | "trace" | "file" | "tool" | "task_ledger" | "clawgraph" | "manual" | "other";
  ref: string;
  label?: string;
};

export type CompressionFact = {
  text: string;
  evidenceRefs: CompressionEvidenceRef[];
};

export type CompressionArtifactQuality = {
  score: number;
  level: "high" | "medium" | "low";
  fieldCoverage: number;
  evidenceCoverage: number;
  artifactTokens: number;
  projectionTokens: number;
  warnings: string[];
};

export type CompressionCvkEvidenceRef = {
  resourceId: string;
  selector: string;
  checksum?: string;
  label?: string;
  kind?: "skill" | "toolset" | "document" | "project_rule" | "codebase" | "trace" | "memory" | "other";
};

export type CompressionRetrievalTraceEntry = CompressionCvkEvidenceRef & {
  chunkId?: string;
  tokenCount?: number;
  reason: "prefetch" | "tool_call_gate" | "hard_claim" | "recovery" | "user_requested" | "model_requested";
};

export type CompressionCapabilityActivation = {
  kind: "skill" | "tool" | "project_rule" | "other";
  name: string;
  resourceId?: string;
  selector?: string;
};

export type CompressionLargeDurableFactRef = {
  evidenceRef: CompressionCvkEvidenceRef;
  text: string;
};

export type CompressionRehydratedFileContext = {
  path: string;
  reason: string;
  lineStart?: number;
  lineEnd?: number;
  excerptHash?: string;
  evidenceRefs: CompressionEvidenceRef[];
};

export type CompressionArtifact = {
  schemaVersion: 1;
  objective: string;
  constraints: CompressionFact[];
  currentState: string;
  done: CompressionFact[];
  inProgress: CompressionFact[];
  blocked: CompressionFact[];
  decisions: CompressionFact[];
  filesTouched: CompressionFact[];
  testsRun: CompressionFact[];
  failedAttempts: CompressionFact[];
  deviations: CompressionFact[];
  nextAction: string;
  reviewNeeded: CompressionFact[];
  evidenceRefs: CompressionEvidenceRef[];
  unverifiedClaims: string[];
  retrievedContext?: CompressionCvkEvidenceRef[];
  requiredSelectors?: CompressionCvkEvidenceRef[];
  capabilityActivations?: CompressionCapabilityActivation[];
  staleReferences?: CompressionCvkEvidenceRef[];
  retrievalTrace?: CompressionRetrievalTraceEntry[];
  tier?: "tier0" | "tier1" | "tier2" | "tier3" | "tier4";
  strategy?: "hot-context" | "micro-compact" | "token-pruning" | "semantic-handoff" | "emergency-collapse";
  compressionRatio?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  rehydratedFiles?: string[];
  rehydratedFileContext?: CompressionRehydratedFileContext[];
  staleExcludedCount?: number;
  causalAnchorCount?: number;
  warnings?: string[];
  quality: CompressionArtifactQuality;
};

export type CompressionArtifactInput = {
  messages: AgentMessage[];
  previousSummary?: string;
  summary?: string;
  readFiles?: string[];
  modifiedFiles?: string[];
  targetArtifactTokens?: number;
  telemetry?: {
    tier?: unknown;
    strategy?: unknown;
    compressionRatio?: unknown;
    tokensBefore?: unknown;
    tokensAfter?: unknown;
    rehydratedFiles?: unknown;
    staleExcludedCount?: unknown;
    causalAnchorCount?: unknown;
    warnings?: unknown;
  };
  rehydratedFileContext?: CompressionRehydratedFileContext[];
  contextRuntimeKit?: {
    retrievedContext?: CompressionCvkEvidenceRef[];
    requiredSelectors?: CompressionCvkEvidenceRef[];
    capabilityActivations?: CompressionCapabilityActivation[];
    staleReferences?: CompressionCvkEvidenceRef[];
    retrievalTrace?: CompressionRetrievalTraceEntry[];
    unverifiedClaims?: string[];
    largeDurableFacts?: CompressionLargeDurableFactRef[];
  };
};

const DEFAULT_TARGET_ARTIFACT_TOKENS = 1800;
const DEFAULT_PROJECTION_TOKENS = 1400;
const EVIDENCE_TYPES = new Set<CompressionEvidenceRef["type"]>([
  "session",
  "trace",
  "file",
  "tool",
  "task_ledger",
  "clawgraph",
  "manual",
  "other",
]);

const CVK_KINDS = new Set<NonNullable<CompressionCvkEvidenceRef["kind"]>>([
  "skill",
  "toolset",
  "document",
  "project_rule",
  "codebase",
  "trace",
  "memory",
  "other",
]);

const RETRIEVAL_REASONS = new Set<CompressionRetrievalTraceEntry["reason"]>([
  "prefetch",
  "tool_call_gate",
  "hard_claim",
  "recovery",
  "user_requested",
  "model_requested",
]);

const COMPRESSION_TIERS = new Set<NonNullable<CompressionArtifact["tier"]>>([
  "tier0",
  "tier1",
  "tier2",
  "tier3",
  "tier4",
]);

const COMPRESSION_STRATEGIES = new Set<NonNullable<CompressionArtifact["strategy"]>>([
  "hot-context",
  "micro-compact",
  "token-pruning",
  "semantic-handoff",
  "emergency-collapse",
]);

const COMPRESSION_ENV_SECRET_RE =
  /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))\b(\s*[=:]\s*)(["']?)([^\s"',;]+)\3/giu;
const COMPRESSION_BEARER_SECRET_RE =
  /\b(Authorization\s*[:=]\s*Bearer\s+)[A-Za-z0-9._\-+=]+/giu;
const COMPRESSION_PREFIX_SECRET_RE =
  /\b(?:sk-(?:proj-)?|ghp_|github_pat_|xox[baprs]-|gsk_|pplx-|npm_)[A-Za-z0-9_-]{8,}\b/giu;

function redactCompressionText(value: string): string {
  return value
    .replace(COMPRESSION_ENV_SECRET_RE, "$1$2[redacted]")
    .replace(COMPRESSION_BEARER_SECRET_RE, "$1[redacted]")
    .replace(COMPRESSION_PREFIX_SECRET_RE, "[redacted-secret]");
}

function normalizeText(value: unknown, maxChars = 600): string {
  if (typeof value !== "string") return "";
  const compact = redactCompressionText(value).replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 24)).trim()} [truncated]`;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") return [record.text];
      if (typeof record.content === "string") return [record.content];
      return [];
    })
    .join("\n");
}

function messageText(message: AgentMessage): string {
  return normalizeText(textFromContent((message as { content?: unknown }).content), 1200);
}

function messageEvidence(message: AgentMessage, index: number): CompressionEvidenceRef {
  const id = (message as { id?: unknown }).id;
  return {
    type: "session",
    ref: typeof id === "string" && id.trim() ? id.trim() : `message:${index + 1}`,
    label: `${message.role} message`,
  };
}

function fact(text: string, evidenceRefs: CompressionEvidenceRef[]): CompressionFact | undefined {
  const normalized = normalizeText(text, 500);
  if (!normalized) return undefined;
  return { text: normalized, evidenceRefs };
}

function pushUniqueFact(target: CompressionFact[], item: CompressionFact | undefined): void {
  if (!item) return;
  const key = item.text.toLowerCase();
  if (target.some((existing) => existing.text.toLowerCase() === key)) return;
  target.push(item);
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateArtifactTokens(artifact: Omit<CompressionArtifact, "quality">): number {
  return estimateTokensFromText(JSON.stringify(artifact));
}

function extractListFromSummary(summary: string | undefined, heading: RegExp, maxItems = 6): string[] {
  const text = summary ?? "";
  const match = heading.exec(text);
  if (!match || match.index < 0) return [];
  const after = text.slice(match.index + match[0].length);
  const nextHeading = after.search(/\n##\s+/);
  const section = nextHeading >= 0 ? after.slice(0, nextHeading) : after;
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)]|\[[ xX]\])\s*/, "").trim())
    .filter((line) => line && line !== "(none)" && !line.endsWith(":"))
    .slice(0, maxItems);
}

function extractObjective(messages: AgentMessage[], summary?: string): string {
  const summaryGoal = extractListFromSummary(summary, /\n?##\s*Goal\s*\n/i, 2).join("; ");
  if (summaryGoal) return normalizeText(summaryGoal, 700);
  const firstUser = messages.find((message) => message.role === "user");
  return normalizeText(firstUser ? messageText(firstUser) : "Continue the current task from compressed context.", 700);
}

function extractNextAction(summary: string | undefined, messages: AgentMessage[]): string {
  const fromSummary = extractListFromSummary(summary, /\n?##\s*Next Steps\s*\n/i, 1)[0];
  if (fromSummary) return normalizeText(fromSummary, 500);
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i]);
    const match = text.match(/(?:next|todo|follow[- ]?up|remaining|continue)[:\s-]+(.{12,260})/i);
    if (match?.[1]) return normalizeText(match[1], 500);
  }
  return "Continue from the latest retained context and verify work against the evidence refs.";
}

function extractTests(text: string): string[] {
  const matches = text.match(/\b(?:pnpm|npm|yarn|vitest|playwright|pytest|cargo|go test|dotnet test|tsc)\b[^\n\r`]*/gi);
  return (matches ?? []).map((item) => normalizeText(item, 240)).filter(Boolean).slice(0, 8);
}

function extractFailures(text: string): string[] {
  const lines = text.split(/\n+/);
  return lines
    .filter((line) => /\b(error|failed|failure|exception|blocked|cannot|unable)\b/i.test(line))
    .map((line) => normalizeText(line, 360))
    .filter(Boolean)
    .slice(0, 8);
}

function extractDecisions(summary: string | undefined): string[] {
  return extractListFromSummary(summary, /\n?##\s*Key Decisions\s*\n/i, 8)
    .map((item) => item.replace(/^\*\*|\*\*$/g, "").trim())
    .filter(Boolean);
}

function baseEvidence(messages: AgentMessage[]): CompressionEvidenceRef[] {
  if (messages.length === 0) return [];
  const first = messageEvidence(messages[0], 0);
  const last = messageEvidence(messages[messages.length - 1], messages.length - 1);
  return first.ref === last.ref ? [first] : [first, last];
}

function trimFacts(items: CompressionFact[], maxItems: number): CompressionFact[] {
  return items.slice(0, maxItems).map((item) => ({
    text: normalizeText(item.text, 360),
    evidenceRefs: item.evidenceRefs.slice(0, 4),
  }));
}

function normalizeCvkEvidenceRefs(value: unknown, maxItems = 24): CompressionCvkEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<CompressionCvkEvidenceRef>;
    const resourceId = normalizeText(record.resourceId, 240);
    const selector = normalizeText(record.selector, 240);
    if (!resourceId || !selector) return [];
    const checksum = normalizeText(record.checksum, 90);
    const label = normalizeText(record.label, 160);
    const kind = typeof record.kind === "string" && CVK_KINDS.has(record.kind as NonNullable<CompressionCvkEvidenceRef["kind"]>)
      ? record.kind as NonNullable<CompressionCvkEvidenceRef["kind"]>
      : undefined;
    return [{
      resourceId,
      selector,
      ...(checksum ? { checksum } : {}),
      ...(label ? { label } : {}),
      ...(kind ? { kind } : {}),
    }];
  }).slice(0, maxItems);
}

function normalizeRetrievalTraceEntries(value: unknown, maxItems = 40): CompressionRetrievalTraceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<CompressionRetrievalTraceEntry>;
    const evidenceRef = normalizeCvkEvidenceRefs([record], 1)[0];
    if (!evidenceRef) return [];
    const reason = typeof record.reason === "string" && RETRIEVAL_REASONS.has(record.reason as CompressionRetrievalTraceEntry["reason"])
      ? record.reason as CompressionRetrievalTraceEntry["reason"]
      : "recovery";
    const chunkId = normalizeText(record.chunkId, 200);
    const tokenCount = Number.isFinite(record.tokenCount) && Number(record.tokenCount) >= 0
      ? Math.floor(Number(record.tokenCount))
      : undefined;
    return [{
      ...evidenceRef,
      ...(chunkId ? { chunkId } : {}),
      ...(tokenCount !== undefined ? { tokenCount } : {}),
      reason,
    }];
  }).slice(0, maxItems);
}

function normalizeCapabilityActivations(value: unknown, maxItems = 24): CompressionCapabilityActivation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<CompressionCapabilityActivation>;
    const name = normalizeText(record.name, 160);
    if (!name) return [];
    const kind: CompressionCapabilityActivation["kind"] =
      record.kind === "skill" || record.kind === "tool" || record.kind === "project_rule"
      ? record.kind
      : "other";
    const resourceId = normalizeText(record.resourceId, 240);
    const selector = normalizeText(record.selector, 240);
    return [{
      kind,
      name,
      ...(resourceId ? { resourceId } : {}),
      ...(selector ? { selector } : {}),
    }];
  }).slice(0, maxItems);
}

function normalizeEvidenceRefs(value: unknown, maxItems = 24): CompressionEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Partial<CompressionEvidenceRef>;
    const ref = normalizeText(entry.ref, 300);
    if (!ref) return [];
    const type = typeof entry.type === "string" && EVIDENCE_TYPES.has(entry.type as CompressionEvidenceRef["type"])
      ? entry.type as CompressionEvidenceRef["type"]
      : "other";
    const label = normalizeText(entry.label, 120);
    return [{
      type,
      ref,
      ...(label ? { label } : {}),
    }];
  }).slice(0, maxItems);
}

function normalizeStringList(value: unknown, maxItems = 24, maxChars = 300): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const normalized = normalizeNonNegativeNumber(value);
  return normalized === undefined ? undefined : Math.floor(normalized);
}

function normalizeCompressionTelemetry(value: unknown): Pick<
  CompressionArtifact,
  | "tier"
  | "strategy"
  | "compressionRatio"
  | "tokensBefore"
  | "tokensAfter"
  | "rehydratedFiles"
  | "staleExcludedCount"
  | "causalAnchorCount"
  | "warnings"
> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const tier = typeof record.tier === "string" && COMPRESSION_TIERS.has(record.tier as NonNullable<CompressionArtifact["tier"]>)
    ? record.tier as NonNullable<CompressionArtifact["tier"]>
    : undefined;
  const strategy = typeof record.strategy === "string"
    && COMPRESSION_STRATEGIES.has(record.strategy as NonNullable<CompressionArtifact["strategy"]>)
    ? record.strategy as NonNullable<CompressionArtifact["strategy"]>
    : undefined;
  const compressionRatio = normalizeNonNegativeNumber(record.compressionRatio);
  const tokensBefore = normalizeNonNegativeInteger(record.tokensBefore);
  const tokensAfter = normalizeNonNegativeInteger(record.tokensAfter);
  const rehydratedFiles = normalizeStringList(record.rehydratedFiles, 24, 400);
  const staleExcludedCount = normalizeNonNegativeInteger(record.staleExcludedCount);
  const causalAnchorCount = normalizeNonNegativeInteger(record.causalAnchorCount);
  const warnings = normalizeStringList(record.warnings, 16, 200);
  return {
    ...(tier ? { tier } : {}),
    ...(strategy ? { strategy } : {}),
    ...(compressionRatio !== undefined ? { compressionRatio } : {}),
    ...(tokensBefore !== undefined ? { tokensBefore } : {}),
    ...(tokensAfter !== undefined ? { tokensAfter } : {}),
    ...(rehydratedFiles.length ? { rehydratedFiles } : {}),
    ...(staleExcludedCount !== undefined ? { staleExcludedCount } : {}),
    ...(causalAnchorCount !== undefined ? { causalAnchorCount } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

function normalizeRehydratedFileContext(
  value: unknown,
  maxItems = 16,
): CompressionRehydratedFileContext[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<CompressionRehydratedFileContext>;
    const path = normalizeText(record.path, 400);
    const reason = normalizeText(record.reason, 120);
    if (!path || !reason) return [];
    const lineStart = normalizeNonNegativeInteger(record.lineStart);
    const lineEnd = normalizeNonNegativeInteger(record.lineEnd);
    const excerptHash = normalizeText(record.excerptHash, 120);
    return [{
      path,
      reason,
      ...(lineStart !== undefined ? { lineStart } : {}),
      ...(lineEnd !== undefined ? { lineEnd } : {}),
      ...(excerptHash ? { excerptHash } : {}),
      evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, 8),
    }];
  }).slice(0, maxItems);
}

function optionalArray<T>(items: T[]): T[] | undefined {
  return items.length ? items : undefined;
}

function buildQuality(
  artifact: Omit<CompressionArtifact, "quality">,
  targetTokens: number,
  additionalWarnings: unknown = [],
): CompressionArtifactQuality {
  const required: Array<keyof Omit<CompressionArtifact, "quality">> = [
    "objective",
    "currentState",
    "nextAction",
    "done",
    "inProgress",
    "decisions",
    "evidenceRefs",
  ];
  const present = required.filter((key) => {
    const value = artifact[key];
    return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
  }).length;
  const factGroups = [
    artifact.constraints,
    artifact.done,
    artifact.inProgress,
    artifact.blocked,
    artifact.decisions,
    artifact.filesTouched,
    artifact.testsRun,
    artifact.failedAttempts,
    artifact.deviations,
    artifact.reviewNeeded,
  ];
  const facts = factGroups.flat();
  const evidencedFacts = facts.filter((item) => item.evidenceRefs.length > 0).length;
  const fieldCoverage = present / required.length;
  const evidenceCoverage = facts.length === 0 ? 1 : evidencedFacts / facts.length;
  const artifactTokens = estimateArtifactTokens(artifact);
  const projectionTokens = estimateTokensFromText(renderRecoveryContextProjection({ ...artifact, quality: {
    score: 0,
    level: "low",
    fieldCoverage,
    evidenceCoverage,
    artifactTokens,
    projectionTokens: 0,
    warnings: [],
  } }, DEFAULT_PROJECTION_TOKENS));
  const warnings: string[] = [];
  if (fieldCoverage < 0.85) warnings.push("missing_recovery_fields");
  if (evidenceCoverage < 0.7) warnings.push("low_evidence_coverage");
  if (artifactTokens > targetTokens) warnings.push("artifact_over_token_budget");
  if (artifact.unverifiedClaims.length > 0) warnings.push("contains_unverified_claims");
  warnings.push(...normalizeStringList(additionalWarnings, 16, 200));
  const score = Math.max(
    0,
    Math.min(1, fieldCoverage * 0.45 + evidenceCoverage * 0.35 + (artifactTokens <= targetTokens ? 0.2 : 0.05)),
  );
  return {
    score: Math.round(score * 100) / 100,
    level: score >= 0.82 ? "high" : score >= 0.6 ? "medium" : "low",
    fieldCoverage: Math.round(fieldCoverage * 100) / 100,
    evidenceCoverage: Math.round(evidenceCoverage * 100) / 100,
    artifactTokens,
    projectionTokens,
    warnings: [...new Set(warnings)],
  };
}

export function buildDeterministicCompressionArtifact(input: CompressionArtifactInput): CompressionArtifact {
  const messages = input.messages;
  const targetTokens = input.targetArtifactTokens ?? DEFAULT_TARGET_ARTIFACT_TOKENS;
  const evidence = baseEvidence(messages);
  const summary = input.summary || input.previousSummary || "";
  const done: CompressionFact[] = [];
  const inProgress: CompressionFact[] = [];
  const blocked: CompressionFact[] = [];
  const testsRun: CompressionFact[] = [];
  const failedAttempts: CompressionFact[] = [];
  const decisions: CompressionFact[] = [];

  for (const item of extractListFromSummary(summary, /\n?###\s*Done\s*\n/i, 8)) {
    pushUniqueFact(done, fact(item, evidence));
  }
  for (const item of extractListFromSummary(summary, /\n?###\s*In Progress\s*\n/i, 5)) {
    pushUniqueFact(inProgress, fact(item, evidence));
  }
  for (const item of extractListFromSummary(summary, /\n?###\s*Blocked\s*\n/i, 5)) {
    pushUniqueFact(blocked, fact(item, evidence));
  }
  for (const item of extractDecisions(summary)) {
    pushUniqueFact(decisions, fact(item, evidence));
  }

  messages.forEach((message, index) => {
    const text = messageText(message);
    const ref = [messageEvidence(message, index)];
    for (const item of extractTests(text)) pushUniqueFact(testsRun, fact(item, ref));
    for (const item of extractFailures(text)) pushUniqueFact(failedAttempts, fact(item, ref));
    if (message.role === "assistant" && /\b(done|implemented|fixed|updated|added|created)\b/i.test(text)) {
      pushUniqueFact(done, fact(text, ref));
    }
  });

  const fileFacts: CompressionFact[] = [];
  for (const file of [...(input.modifiedFiles ?? []), ...(input.readFiles ?? [])]) {
    pushUniqueFact(fileFacts, fact(file, [{ type: "file", ref: file }]));
  }

  const objective = extractObjective(messages, summary);
  const nextAction = extractNextAction(summary, messages);
  if (inProgress.length === 0) {
    pushUniqueFact(inProgress, fact(nextAction, evidence));
  }
  const telemetry = normalizeCompressionTelemetry(input.telemetry);
  const rehydratedFileContext = normalizeRehydratedFileContext(input.rehydratedFileContext);

  const artifactWithoutQuality: Omit<CompressionArtifact, "quality"> = {
    schemaVersion: 1,
    objective,
    constraints: trimFacts(
      extractListFromSummary(summary, /\n?##\s*Constraints & Preferences\s*\n/i, 8)
        .map((item) => fact(item, evidence))
        .filter((item): item is CompressionFact => Boolean(item)),
      8,
    ),
    currentState: normalizeText(done[0]?.text || inProgress[0]?.text || summary || objective, 700),
    done: trimFacts(done, 8),
    inProgress: trimFacts(inProgress, 5),
    blocked: trimFacts(blocked, 5),
    decisions: trimFacts(decisions, 8),
    filesTouched: trimFacts(fileFacts, 12),
    testsRun: trimFacts(testsRun, 8),
    failedAttempts: trimFacts(failedAttempts, 6),
    deviations: [],
    nextAction,
    reviewNeeded: [],
    evidenceRefs: [...evidence, ...fileFacts.flatMap((item) => item.evidenceRefs)].slice(0, 24),
    unverifiedClaims: [
      ...normalizeCvkEvidenceRefs(input.contextRuntimeKit?.staleReferences, 8)
        .map((ref) => `Stale reference must be revalidated: ${ref.resourceId} ${ref.selector}`),
      ...(input.contextRuntimeKit?.unverifiedClaims ?? []).map((item) => normalizeText(item, 300)).filter(Boolean),
    ].slice(0, 8),
    ...(optionalArray(normalizeCvkEvidenceRefs(input.contextRuntimeKit?.retrievedContext)) ? {
      retrievedContext: optionalArray(normalizeCvkEvidenceRefs(input.contextRuntimeKit?.retrievedContext)),
    } : {}),
    ...(optionalArray(normalizeCvkEvidenceRefs(input.contextRuntimeKit?.requiredSelectors)) ? {
      requiredSelectors: optionalArray(normalizeCvkEvidenceRefs(input.contextRuntimeKit?.requiredSelectors)),
    } : {}),
    ...(optionalArray(normalizeCapabilityActivations(input.contextRuntimeKit?.capabilityActivations)) ? {
      capabilityActivations: optionalArray(normalizeCapabilityActivations(input.contextRuntimeKit?.capabilityActivations)),
    } : {}),
    ...(optionalArray(normalizeCvkEvidenceRefs(input.contextRuntimeKit?.staleReferences)) ? {
      staleReferences: optionalArray(normalizeCvkEvidenceRefs(input.contextRuntimeKit?.staleReferences)),
    } : {}),
    ...(optionalArray(normalizeRetrievalTraceEntries(input.contextRuntimeKit?.retrievalTrace)) ? {
      retrievalTrace: optionalArray(normalizeRetrievalTraceEntries(input.contextRuntimeKit?.retrievalTrace)),
    } : {}),
    ...telemetry,
    ...(rehydratedFileContext.length ? { rehydratedFileContext } : {}),
  };
  const quality = buildQuality(artifactWithoutQuality, targetTokens, telemetry.warnings);
  return { ...artifactWithoutQuality, quality };
}

function formatFactList(items: CompressionFact[], empty = "- none"): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item.text}`).join("\n");
}

function formatCvkRefList(items: CompressionCvkEvidenceRef[] | undefined, empty = "- none"): string {
  if (!items?.length) return empty;
  return items.map((item) => (
    `- ${item.resourceId} ${item.selector}${item.checksum ? ` ${item.checksum}` : ""}${item.label ? ` (${item.label})` : ""}`
  )).join("\n");
}

function formatRetrievalTrace(items: CompressionRetrievalTraceEntry[] | undefined, empty = "- none"): string {
  if (!items?.length) return empty;
  return items.map((item) => (
    `- ${item.reason}: ${item.resourceId} ${item.selector}${item.checksum ? ` ${item.checksum}` : ""}`
  )).join("\n");
}

function formatCapabilityActivations(items: CompressionCapabilityActivation[] | undefined, empty = "- none"): string {
  if (!items?.length) return empty;
  return items.map((item) => (
    `- ${item.kind}:${item.name}${item.resourceId ? ` ${item.resourceId}` : ""}${item.selector ? ` ${item.selector}` : ""}`
  )).join("\n");
}

export function renderCompressionArtifactSummary(artifact: CompressionArtifact): string {
  return redactCompressionText([
    "## Goal",
    artifact.objective || "Continue the current task.",
    "",
    "## Constraints & Preferences",
    formatFactList(artifact.constraints),
    "",
    "## Progress",
    "### Done",
    formatFactList(artifact.done),
    "",
    "### In Progress",
    formatFactList(artifact.inProgress),
    "",
    "### Blocked",
    formatFactList(artifact.blocked),
    "",
    "## Key Decisions",
    formatFactList(artifact.decisions),
    "",
    "## Next Steps",
    `1. ${artifact.nextAction}`,
    "",
    "## Critical Context",
    formatFactList([...artifact.filesTouched, ...artifact.testsRun, ...artifact.failedAttempts].slice(0, 12)),
  ].join("\n"));
}

export function renderRecoveryContextProjection(
  artifact: CompressionArtifact,
  budgetTokens = DEFAULT_PROJECTION_TOKENS,
): string {
  const sections = [
    "Recovery Context Projection",
    `quality: ${artifact.quality.level} score=${artifact.quality.score}`,
    artifact.tier || artifact.strategy
      ? `compression: ${artifact.tier ?? "unknown"} / ${artifact.strategy ?? "unknown"}`
      : "",
    artifact.tokensBefore !== undefined || artifact.tokensAfter !== undefined
      ? `tokens: before=${artifact.tokensBefore ?? "unknown"} after=${artifact.tokensAfter ?? "unknown"} ratio=${artifact.compressionRatio ?? "unknown"}`
      : "",
    artifact.rehydratedFileContext?.length
      ? `rehydratedFileContext:\n${artifact.rehydratedFileContext.slice(0, 8).map((item) => {
          const lineRange = item.lineStart !== undefined
            ? `:${item.lineStart}${item.lineEnd !== undefined ? `-${item.lineEnd}` : ""}`
            : "";
          return `- ${item.path}${lineRange} reason=${item.reason}${item.excerptHash ? ` hash=${item.excerptHash}` : ""}`;
        }).join("\n")}`
      : "",
    `objective: ${artifact.objective}`,
    `currentState: ${artifact.currentState}`,
    artifact.constraints.length ? `constraints:\n${formatFactList(artifact.constraints.slice(0, 5))}` : "",
    artifact.inProgress.length ? `active:\n${formatFactList(artifact.inProgress.slice(0, 3))}` : "",
    artifact.blocked.length ? `blocked:\n${formatFactList(artifact.blocked.slice(0, 3))}` : "",
    artifact.decisions.length ? `decisions:\n${formatFactList(artifact.decisions.slice(0, 5))}` : "",
    artifact.filesTouched.length ? `files:\n${formatFactList(artifact.filesTouched.slice(0, 8))}` : "",
    artifact.testsRun.length ? `tests:\n${formatFactList(artifact.testsRun.slice(0, 5))}` : "",
    artifact.failedAttempts.length ? `failedAttempts:\n${formatFactList(artifact.failedAttempts.slice(0, 4))}` : "",
    `nextAction: ${artifact.nextAction}`,
    artifact.reviewNeeded.length ? `reviewNeeded:\n${formatFactList(artifact.reviewNeeded.slice(0, 4))}` : "",
    artifact.evidenceRefs.length
      ? `evidenceRefs:\n${artifact.evidenceRefs.slice(0, 12).map((ref) => `- ${ref.type}:${ref.ref}${ref.label ? ` (${ref.label})` : ""}`).join("\n")}`
      : "",
    artifact.retrievedContext?.length
      ? `retrievedContext:\n${formatCvkRefList(artifact.retrievedContext.slice(0, 12))}`
      : "",
    artifact.requiredSelectors?.length
      ? `requiredSelectors:\n${formatCvkRefList(artifact.requiredSelectors.slice(0, 12))}`
      : "",
    artifact.retrievalTrace?.length
      ? `retrievalTrace:\n${formatRetrievalTrace(artifact.retrievalTrace.slice(0, 12))}`
      : "",
    artifact.capabilityActivations?.length
      ? `capabilityActivations:\n${formatCapabilityActivations(artifact.capabilityActivations.slice(0, 8))}`
      : "",
    artifact.staleReferences?.length
      ? `staleReferences:\n${formatCvkRefList(artifact.staleReferences.slice(0, 8))}`
      : "",
    artifact.unverifiedClaims.length
      ? `unverifiedClaims:\n${artifact.unverifiedClaims.slice(0, 4).map((item) => `- ${item}`).join("\n")}`
      : "",
  ].filter(Boolean);
  let text = sections.join("\n\n");
  const maxChars = Math.max(800, Math.floor(budgetTokens * 4));
  if (text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars - 80)).trim()}\n[projection truncated to budget]`;
  }
  return redactCompressionText(text);
}

export function normalizeCompressionArtifact(value: unknown): CompressionArtifact | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<CompressionArtifact>;
  if (record.schemaVersion !== 1) return undefined;
  const normalizeFacts = (items: unknown, maxItems: number): CompressionFact[] => (
    Array.isArray(items)
      ? items.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as Partial<CompressionFact>;
          const text = normalizeText(entry.text, 360);
          if (!text) return [];
          return [{ text, evidenceRefs: normalizeEvidenceRefs(entry.evidenceRefs) }];
        }).slice(0, maxItems)
      : []
  );
  const telemetry = normalizeCompressionTelemetry(record);
  const rehydratedFileContext = normalizeRehydratedFileContext(record.rehydratedFileContext);
  const artifactWithoutQuality: Omit<CompressionArtifact, "quality"> = {
    schemaVersion: 1,
    objective: normalizeText(record.objective, 700) || "Continue the current task from compressed context.",
    constraints: normalizeFacts(record.constraints, 8),
    currentState: normalizeText(record.currentState, 700) || "Compressed context is available.",
    done: normalizeFacts(record.done, 8),
    inProgress: normalizeFacts(record.inProgress, 5),
    blocked: normalizeFacts(record.blocked, 5),
    decisions: normalizeFacts(record.decisions, 8),
    filesTouched: normalizeFacts(record.filesTouched, 12),
    testsRun: normalizeFacts(record.testsRun, 8),
    failedAttempts: normalizeFacts(record.failedAttempts, 6),
    deviations: normalizeFacts(record.deviations, 6),
    nextAction: normalizeText(record.nextAction, 500) || "Continue from compressed recovery context.",
    reviewNeeded: normalizeFacts(record.reviewNeeded, 6),
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs),
    unverifiedClaims: Array.isArray(record.unverifiedClaims)
      ? record.unverifiedClaims.map((item) => normalizeText(item, 300)).filter(Boolean).slice(0, 8)
      : [],
    ...(optionalArray(normalizeCvkEvidenceRefs(record.retrievedContext)) ? {
      retrievedContext: optionalArray(normalizeCvkEvidenceRefs(record.retrievedContext)),
    } : {}),
    ...(optionalArray(normalizeCvkEvidenceRefs(record.requiredSelectors)) ? {
      requiredSelectors: optionalArray(normalizeCvkEvidenceRefs(record.requiredSelectors)),
    } : {}),
    ...(optionalArray(normalizeCapabilityActivations(record.capabilityActivations)) ? {
      capabilityActivations: optionalArray(normalizeCapabilityActivations(record.capabilityActivations)),
    } : {}),
    ...(optionalArray(normalizeCvkEvidenceRefs(record.staleReferences)) ? {
      staleReferences: optionalArray(normalizeCvkEvidenceRefs(record.staleReferences)),
    } : {}),
    ...(optionalArray(normalizeRetrievalTraceEntries(record.retrievalTrace)) ? {
      retrievalTrace: optionalArray(normalizeRetrievalTraceEntries(record.retrievalTrace)),
    } : {}),
    ...telemetry,
    ...(rehydratedFileContext.length ? { rehydratedFileContext } : {}),
  };
  return {
    ...artifactWithoutQuality,
    quality: buildQuality(
      artifactWithoutQuality,
      DEFAULT_TARGET_ARTIFACT_TOKENS,
      [
        ...(record.quality?.warnings ?? []),
        ...(telemetry.warnings ?? []),
      ],
    ),
  };
}

function cvkRefKey(ref: CompressionCvkEvidenceRef): string {
  return `${ref.resourceId}\u0000${ref.selector}\u0000${ref.checksum ?? ""}`;
}

export function calculateCompressionEvidenceRetentionRate(artifact: CompressionArtifact): {
  required: number;
  retained: number;
  rate: number;
} {
  const requiredSelectors = artifact.requiredSelectors ?? [];
  if (requiredSelectors.length === 0) {
    return { required: 0, retained: 0, rate: 1 };
  }
  const retainedKeys = new Set([
    ...(artifact.retrievedContext ?? []).map(cvkRefKey),
    ...(artifact.retrievalTrace ?? []).map(cvkRefKey),
  ]);
  const retained = requiredSelectors.filter((ref) => retainedKeys.has(cvkRefKey(ref))).length;
  return {
    required: requiredSelectors.length,
    retained,
    rate: retained / requiredSelectors.length,
  };
}
