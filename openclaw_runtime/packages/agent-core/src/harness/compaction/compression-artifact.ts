import type { AgentMessage } from "../../types.js";
import type { CompressionTelemetry } from "./compression-planner.js";

export type SemanticAtomStatus = "verified" | "unverified" | "stale" | "superseded";
export type SemanticAtomPolarity = "positive" | "negative" | "neutral";
export type SemanticAtomType =
  | "goal"
  | "latest_user_ask"
  | "decision"
  | "constraint"
  | "failed_attempt"
  | "entity"
  | "next_action"
  | "outcome"
  | "safety_boundary";
export type SemanticAtomSeverity = "critical" | "important" | "nice_to_have";

export type CompressionSemanticAtom = {
  id: string;
  type: SemanticAtomType;
  canonicalIdentity: string;
  severity: SemanticAtomSeverity;
  confidence: number;
  scope: string;
  polarity: SemanticAtomPolarity;
  status: SemanticAtomStatus;
  text: string;
  evidenceRefs: CompressionEvidenceRef[];
  supersedes?: string[];
  conflicts?: string[];
  updatedAt?: number;
  source?: {
    kind: "summary" | "message" | "ledger" | "cvk" | "archive";
    ref: string;
  };
};

export type CompressionEvidenceRef = {
  type: "session" | "trace" | "file" | "tool" | "task_ledger" | "clawgraph" | "manual" | "archive" | "cvk" | "other";
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
  reason?: string;
  lineStart?: number;
  lineEnd?: number;
  excerptHash?: string;
  evidenceRefs?: CompressionEvidenceRef[];
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
  rehydratedFileContext?: CompressionRehydratedFileContext[];
  telemetry?: Partial<CompressionTelemetry>;
  semanticAtoms?: CompressionSemanticAtom[];
  quality: CompressionArtifactQuality;
};

export type CompressionArtifactInput = {
  messages: AgentMessage[];
  previousSummary?: string;
  summary?: string;
  readFiles?: string[];
  modifiedFiles?: string[];
  rehydratedFileContext?: CompressionRehydratedFileContext[];
  targetArtifactTokens?: number;
  telemetry?: Partial<CompressionTelemetry>;
  semanticAtoms?: CompressionSemanticAtom[];
  previousArtifact?: CompressionArtifact;
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
  "archive",
  "cvk",
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

const SEMANTIC_ATOM_TYPES = new Set<SemanticAtomType>([
  "goal",
  "latest_user_ask",
  "decision",
  "constraint",
  "failed_attempt",
  "entity",
  "next_action",
  "outcome",
  "safety_boundary",
]);

const SEMANTIC_ATOM_SEVERITIES = new Set<SemanticAtomSeverity>([
  "critical",
  "important",
  "nice_to_have",
]);

const SEMANTIC_ATOM_STATUSES = new Set<SemanticAtomStatus>([
  "verified",
  "unverified",
  "stale",
  "superseded",
]);

const SEMANTIC_ATOM_POLARITIES = new Set<SemanticAtomPolarity>([
  "positive",
  "negative",
  "neutral",
]);

const SEMANTIC_ATOM_SOURCE_KINDS = new Set<NonNullable<CompressionSemanticAtom["source"]>["kind"]>([
  "summary",
  "message",
  "ledger",
  "cvk",
  "archive",
]);

const MAX_SEMANTIC_ATOMS = 48;
const MAX_SEMANTIC_ATOM_TEXT = 240;

function redactSecretLikeText(text: string): string {
  if (!text) return text;
  // Keep secret labels (e.g. OPENAI_API_KEY) while stripping values and raw token prefixes.
  let out = text.replace(
    /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Za-z0-9_]*)\s*[=:]\s*([^\s"',;]+)/gi,
    (_match, name: string) => `${name}=[REDACTED]`,
  );
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  out = out.replace(/\b(ghp|github_pat|gsk|xox[baprs]|xapp|pplx|npm|hf|r8)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  out = out.replace(/\bBearer\s+[A-Za-z0-9._\-+=]{18,}\b/gi, "Bearer [REDACTED]");
  return out;
}

function normalizeText(value: unknown, maxChars = 600): string {
  if (typeof value !== "string") return "";
  const compact = redactSecretLikeText(value.replace(/\s+/g, " ").trim());
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 24)).trim()} [truncated]`;
}

function normalizeSemanticAtomText(value: unknown): string {
  if (typeof value !== "string") return "";
  // Fenced code bodies and large JSON/tool-schema-shaped blocks are projections, not
  // durable fact storage. Replace them before the bounded text normalization so a long
  // body can never leak into atom.text.
  const withoutCodeBlocks = value.replace(/```[\w-]*\n[\s\S]*?```/g, "[code block omitted]");
  const bounded = withoutCodeBlocks.length > MAX_SEMANTIC_ATOM_TEXT
    ? `${withoutCodeBlocks.slice(0, Math.max(0, MAX_SEMANTIC_ATOM_TEXT - 24)).trim()} [truncated]`
    : withoutCodeBlocks;
  return normalizeText(bounded, MAX_SEMANTIC_ATOM_TEXT);
}

function normalizeStringSet(value: unknown, maxItems = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeText(item, 160))
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length > 0 ? items : undefined;
}

function normalizeSemanticAtomEvidenceRefs(value: unknown): CompressionEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Partial<CompressionEvidenceRef>;
    const ref = normalizeText(entry.ref, 300);
    if (!ref) return [];
    const type = typeof entry.type === "string" && EVIDENCE_TYPES.has(entry.type as CompressionEvidenceRef["type"])
      ? entry.type as CompressionEvidenceRef["type"]
      : "other";
    return [{
      type,
      ref,
      ...(entry.label ? { label: normalizeText(entry.label, 120) } : {}),
    }];
  });
  const recoverable = normalized.filter((ref) => (
    ref.type === "file" || ref.type === "archive" || ref.type === "cvk"
  ));
  const other = normalized.filter((ref) => (
    ref.type !== "file" && ref.type !== "archive" && ref.type !== "cvk"
  ));
  return [...recoverable, ...other].slice(0, 8);
}

type SemanticAtomNormalizeResult = {
  atom?: CompressionSemanticAtom;
  warning?: string;
};

function normalizeSemanticAtom(value: unknown, index: number): SemanticAtomNormalizeResult {
  if (!value || typeof value !== "object") return {};
  const record = value as Partial<CompressionSemanticAtom>;
  const id = normalizeText(record.id, 120) || `atom-${index + 1}`;
  const type = typeof record.type === "string" && SEMANTIC_ATOM_TYPES.has(record.type as SemanticAtomType)
    ? record.type as SemanticAtomType
    : undefined;
  if (!type) return {};
  const severity = typeof record.severity === "string" && SEMANTIC_ATOM_SEVERITIES.has(record.severity as SemanticAtomSeverity)
    ? record.severity as SemanticAtomSeverity
    : "nice_to_have";
  const status = typeof record.status === "string" && SEMANTIC_ATOM_STATUSES.has(record.status as SemanticAtomStatus)
    ? record.status as SemanticAtomStatus
    : "unverified";
  const polarity = typeof record.polarity === "string" && SEMANTIC_ATOM_POLARITIES.has(record.polarity as SemanticAtomPolarity)
    ? record.polarity as SemanticAtomPolarity
    : "neutral";
  const text = normalizeSemanticAtomText(record.text);
  if (!text) return {};
  const evidenceRefs = normalizeSemanticAtomEvidenceRefs(record.evidenceRefs);
  let normalizedStatus = status;
  let warning: string | undefined;
  if (severity === "critical" && evidenceRefs.length === 0) {
    if (normalizedStatus === "verified") normalizedStatus = "unverified";
    warning = "critical_atom_missing_evidence";
  }
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) && record.updatedAt >= 0
    ? Math.floor(record.updatedAt)
    : undefined;
  const sourceValue = record.source;
  let source: CompressionSemanticAtom["source"] | undefined;
  if (sourceValue) {
    const sourceKind = SEMANTIC_ATOM_SOURCE_KINDS.has(sourceValue.kind)
      ? sourceValue.kind
      : "ledger";
    source = { kind: sourceKind, ref: normalizeText(sourceValue.ref, 240) || "ledger" };
  }
  return {
    atom: {
      id,
      type,
      canonicalIdentity: normalizeText(record.canonicalIdentity, 200) || id,
      severity,
      confidence,
      scope: normalizeText(record.scope, 120) || "session",
      polarity,
      status: normalizedStatus,
      text,
      evidenceRefs,
      ...(normalizeStringSet(record.supersedes) ? { supersedes: normalizeStringSet(record.supersedes) } : {}),
      ...(normalizeStringSet(record.conflicts) ? { conflicts: normalizeStringSet(record.conflicts) } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(source ? { source } : {}),
    },
    ...(warning ? { warning } : {}),
  };
}

function normalizeSemanticAtoms(value: unknown): { atoms: CompressionSemanticAtom[]; warnings: string[] } {
  if (!Array.isArray(value)) return { atoms: [], warnings: [] };
  const atoms: CompressionSemanticAtom[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < value.length && atoms.length < MAX_SEMANTIC_ATOMS; index += 1) {
    const result = normalizeSemanticAtom(value[index], index);
    if (result.warning) warnings.push(result.warning);
    if (result.atom) atoms.push(result.atom);
  }
  return { atoms, warnings };
}

function dedupeWarnings(items: string[]): string[] {
  return [...new Set(items.map((item) => normalizeText(item, 240)).filter(Boolean))].slice(0, 16);
}

function isActiveAtom(atom: CompressionSemanticAtom): boolean {
  return atom.status !== "stale" && atom.status !== "superseded";
}

function atomsToFacts(atoms: CompressionSemanticAtom[], types: SemanticAtomType[], maxItems: number): CompressionFact[] {
  return atoms
    .filter((atom) => isActiveAtom(atom) && types.includes(atom.type))
    .slice(0, maxItems)
    .map((atom) => ({ text: atom.text, evidenceRefs: atom.evidenceRefs }));
}

function atomTextByType(atoms: CompressionSemanticAtom[], types: SemanticAtomType[]): string | undefined {
  return atoms.find((atom) => isActiveAtom(atom) && types.includes(atom.type))?.text;
}

function buildSemanticAtomLedger(input: CompressionArtifactInput): {
  atoms: CompressionSemanticAtom[] | undefined;
  warnings: string[];
} {
  const previous = normalizeSemanticAtoms(input.previousArtifact?.semanticAtoms);
  const incoming = normalizeSemanticAtoms(input.semanticAtoms);
  const atoms = [...previous.atoms];
  const warnings = dedupeWarnings([...previous.warnings, ...incoming.warnings]);

  for (const atom of incoming.atoms) {
    if (atoms.some((existing) => existing.id === atom.id)) continue;
    atoms.push(atom);
    for (const target of atom.supersedes ?? []) {
      const match = atoms.find((existing) => (
        existing.id === target || existing.canonicalIdentity === target
      ));
      if (match) match.status = "superseded";
    }
  }
  return { atoms: optionalArray(atoms), warnings };
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
  const summaryGoal = extractListFromSummary(
    summary,
    /\n?##\s*Goal(?:\s+and\s+Progress)?\s*\n/i,
    2,
  ).join("; ");
  if (summaryGoal) return normalizeText(summaryGoal, 700);
  const firstUser = messages.find((message) => message.role === "user");
  return normalizeText(firstUser ? messageText(firstUser) : "Continue the current task from compressed context.", 700);
}

function extractNextAction(summary: string | undefined, messages: AgentMessage[]): string {
  const fromSummary = extractListFromSummary(summary, /\n?##\s*Next (?:Steps|Actions)\s*\n/i, 1)[0];
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

function optionalArray<T>(items: T[]): T[] | undefined {
  return items.length ? items : undefined;
}

function normalizeTelemetry(value: unknown): Partial<CompressionTelemetry> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<CompressionTelemetry>;
  const out: Partial<CompressionTelemetry> = {};
  if (typeof record.tier === "string") out.tier = record.tier as CompressionTelemetry["tier"];
  if (typeof record.strategy === "string") out.strategy = record.strategy as CompressionTelemetry["strategy"];
  if (typeof record.pressure === "number" && Number.isFinite(record.pressure)) out.pressure = record.pressure;
  if (typeof record.tokensBefore === "number" && Number.isFinite(record.tokensBefore)) out.tokensBefore = record.tokensBefore;
  if (typeof record.tokensAfter === "number" && Number.isFinite(record.tokensAfter)) out.tokensAfter = record.tokensAfter;
  if (typeof record.compressionRatio === "number" && Number.isFinite(record.compressionRatio)) {
    out.compressionRatio = record.compressionRatio;
  }
  if (typeof record.staleExcludedCount === "number" && Number.isFinite(record.staleExcludedCount)) {
    out.staleExcludedCount = record.staleExcludedCount;
  }
  if (typeof record.causalAnchorCount === "number" && Number.isFinite(record.causalAnchorCount)) {
    out.causalAnchorCount = record.causalAnchorCount;
  }
  if (Array.isArray(record.rehydratedFiles)) {
    out.rehydratedFiles = record.rehydratedFiles
      .map((item) => normalizeText(item, 300))
      .filter(Boolean)
      .slice(0, 24);
  }
  if (Array.isArray(record.warnings)) {
    out.warnings = record.warnings
      .map((item) => normalizeText(item, 240))
      .filter(Boolean)
      .slice(0, 12);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeRehydratedFileContext(value: unknown, maxItems = 12): CompressionRehydratedFileContext[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<CompressionRehydratedFileContext>;
    const path = normalizeText(record.path, 400);
    if (!path) return [];
    const evidenceRefs = Array.isArray(record.evidenceRefs)
      ? record.evidenceRefs.flatMap((ref) => {
          if (!ref || typeof ref !== "object") return [];
          const entry = ref as Partial<CompressionEvidenceRef>;
          const refValue = normalizeText(entry.ref, 300);
          if (!refValue) return [];
          const type = typeof entry.type === "string" && EVIDENCE_TYPES.has(entry.type as CompressionEvidenceRef["type"])
            ? entry.type as CompressionEvidenceRef["type"]
            : "file";
          return [{
            type,
            ref: refValue,
            ...(entry.label ? { label: normalizeText(entry.label, 120) } : {}),
          }];
        })
      : [];
    return [{
      path,
      ...(record.reason ? { reason: normalizeText(record.reason, 120) } : {}),
      ...(typeof record.lineStart === "number" && Number.isFinite(record.lineStart)
        ? { lineStart: Math.floor(record.lineStart) }
        : {}),
      ...(typeof record.lineEnd === "number" && Number.isFinite(record.lineEnd)
        ? { lineEnd: Math.floor(record.lineEnd) }
        : {}),
      ...(record.excerptHash ? { excerptHash: normalizeText(record.excerptHash, 120) } : {}),
      ...(evidenceRefs.length ? { evidenceRefs } : {}),
    }];
  }).slice(0, maxItems);
}

function buildQuality(
  artifact: Omit<CompressionArtifact, "quality">,
  targetTokens: number,
  atomWarnings: string[] = [],
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
  for (const warning of [...atomWarnings, ...(artifact.telemetry?.warnings ?? [])]) {
    const text = normalizeText(warning, 240);
    if (text && !warnings.includes(text)) warnings.push(text);
  }
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
    warnings,
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

  // The atom ledger is the structured carrier. Legacy string fields are generated by
  // this adapter from the ledger and must never become the source of truth themselves.
  const atomLedger = buildSemanticAtomLedger(input);
  const atoms = atomLedger.atoms ?? [];
  const legacyConstraints = trimFacts(
    extractListFromSummary(
      summary,
      /\n?##\s*(?:Key Decisions and Constraints|Constraints & Preferences)\s*\n/i,
      8,
    )
      .map((item) => fact(item, evidence))
      .filter((item): item is CompressionFact => Boolean(item)),
    8,
  );
  const constraints = atoms.some((atom) => atom.type === "constraint" || atom.type === "safety_boundary")
    ? trimFacts(atomsToFacts(atoms, ["constraint", "safety_boundary"], 8), 8)
    : legacyConstraints;
  const ledgerDecisions = atoms.some((atom) => atom.type === "decision")
    ? trimFacts(atomsToFacts(atoms, ["decision"], 8), 8)
    : trimFacts(decisions, 8);
  const ledgerFailedAttempts = atoms.some((atom) => atom.type === "failed_attempt")
    ? trimFacts(atomsToFacts(atoms, ["failed_attempt"], 6), 6)
    : trimFacts(failedAttempts, 6);
  let objective = extractObjective(messages, summary);
  let nextAction = extractNextAction(summary, messages);
  if (atoms.length > 0) {
    const ledgerObjective = atomTextByType(atoms, ["goal", "latest_user_ask"]);
    const ledgerNextAction = atomTextByType(atoms, ["next_action"]);
    if (ledgerObjective) objective = ledgerObjective;
    if (ledgerNextAction) nextAction = ledgerNextAction;
  }
  if (inProgress.length === 0) {
    pushUniqueFact(inProgress, fact(nextAction, evidence));
  }
  const outcome = atomTextByType(atoms, ["outcome"]);
  const currentState = outcome ?? normalizeText(done[0]?.text || inProgress[0]?.text || summary || objective, 700);
  const reviewNeeded = atoms.length > 0
    ? trimFacts(atomsToFacts(
        atoms.filter((atom) => atom.status === "unverified" && atom.severity === "critical"),
        ["goal", "latest_user_ask", "decision", "constraint", "failed_attempt", "entity", "next_action", "outcome", "safety_boundary"],
        6,
      ), 6)
    : [];
  const atomEvidence = atoms.flatMap((atom) => atom.evidenceRefs);

  const artifactWithoutQuality: Omit<CompressionArtifact, "quality"> = {
    schemaVersion: 1,
    objective,
    constraints,
    currentState,
    done: trimFacts(done, 8),
    inProgress: trimFacts(inProgress, 5),
    blocked: trimFacts(blocked, 5),
    decisions: ledgerDecisions,
    filesTouched: trimFacts(fileFacts, 12),
    testsRun: trimFacts(testsRun, 8),
    failedAttempts: ledgerFailedAttempts,
    deviations: [],
    nextAction,
    reviewNeeded,
    evidenceRefs: [...evidence, ...fileFacts.flatMap((item) => item.evidenceRefs), ...atomEvidence].slice(0, 24),
    unverifiedClaims: [
      ...normalizeCvkEvidenceRefs(input.contextRuntimeKit?.staleReferences, 8)
        .map((ref) => `Stale reference must be revalidated: ${ref.resourceId} ${ref.selector}`),
      ...(input.contextRuntimeKit?.unverifiedClaims ?? []).map((item) => normalizeText(item, 300)).filter(Boolean),
      ...atoms
        .filter((atom) => atom.status === "unverified")
        .map((atom) => `Unverified semantic atom: ${atom.text}`)
        .slice(0, 4),
    ].slice(0, 8),
    ...(atomLedger.atoms ? { semanticAtoms: atomLedger.atoms } : {}),
    ...(normalizeTelemetry(input.telemetry) ? { telemetry: normalizeTelemetry(input.telemetry) } : {}),
    ...(optionalArray(normalizeRehydratedFileContext(input.rehydratedFileContext)) ? {
      rehydratedFileContext: optionalArray(normalizeRehydratedFileContext(input.rehydratedFileContext)),
    } : {}),
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
  };
  const quality = buildQuality(artifactWithoutQuality, targetTokens, atomLedger.warnings);
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

function formatSemanticAtomCounts(atoms: CompressionSemanticAtom[] | undefined): string | undefined {
  if (!atoms?.length) return undefined;
  const count = (status: SemanticAtomStatus) => atoms.filter((atom) => atom.status === status).length;
  const conflicts = atoms.filter((atom) => (atom.conflicts?.length ?? 0) > 0).length;
  return [
    `semanticAtoms: verified=${count("verified")}`,
    `unverified=${count("unverified")}`,
    `stale=${count("stale")}`,
    `superseded=${count("superseded")}`,
    `conflicts=${conflicts}`,
  ].join(" ");
}

function formatSemanticAtomLedger(atoms: CompressionSemanticAtom[] | undefined, maxItems = 10): string {
  if (!atoms?.length) return "- none";
  return atoms.slice(0, maxItems).map((atom) => {
    const relations = [
      ...(atom.supersedes?.length ? [`supersedes:${atom.supersedes.join(",")}`] : []),
      ...(atom.conflicts?.length ? [`conflicts:${atom.conflicts.join(",")}`] : []),
    ].join(" ");
    return `- [${atom.type}:${atom.status}:${atom.severity}] ${atom.text}${relations ? ` (${relations})` : ""}`;
  }).join("\n");
}

export function renderCompressionArtifactSummary(artifact: CompressionArtifact): string {
  const legacySections = [
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
  ];
  if (!artifact.semanticAtoms?.length) {
    return legacySections.join("\n");
  }
  return [
    ...legacySections,
    "",
    "## Semantic Atoms",
    formatSemanticAtomLedger(artifact.semanticAtoms),
  ].join("\n");
}

export function renderRecoveryContextProjection(
  artifact: CompressionArtifact,
  budgetTokens = DEFAULT_PROJECTION_TOKENS,
): string {
  const sections = [
    "Recovery Context Projection",
    `quality: ${artifact.quality.level} score=${artifact.quality.score}`,
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
    formatSemanticAtomCounts(artifact.semanticAtoms) ?? "",
    artifact.semanticAtoms?.length
      ? `semanticAtomLedger:\n${formatSemanticAtomLedger(artifact.semanticAtoms)}`
      : "",
    artifact.telemetry
      ? `compression: ${artifact.telemetry.tier ?? "unknown"} / ${artifact.telemetry.strategy ?? "unknown"}`
      : "",
    artifact.rehydratedFileContext?.length
      ? artifact.rehydratedFileContext.slice(0, 8).map((item) => {
          const range = item.lineStart !== undefined && item.lineEnd !== undefined
            ? `${item.path}:${item.lineStart}-${item.lineEnd}`
            : item.path;
          const hash = item.excerptHash ? ` hash=${item.excerptHash}` : "";
          return `${range}${hash}`;
        }).join("\n")
      : "",
  ].filter(Boolean);
  let text = sections.join("\n\n");
  const maxChars = Math.max(800, Math.floor(budgetTokens * 4));
  if (text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars - 80)).trim()}\n[projection truncated to budget]`;
  }
  return text;
}

export function normalizeCompressionArtifact(value: unknown): CompressionArtifact | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<CompressionArtifact>;
  if (record.schemaVersion !== 1) return undefined;
  const normalizeEvidence = (refs: unknown): CompressionEvidenceRef[] => (
    Array.isArray(refs)
      ? refs.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as Partial<CompressionEvidenceRef>;
          const ref = normalizeText(entry.ref, 300);
          if (!ref) return [];
          const type = typeof entry.type === "string" && EVIDENCE_TYPES.has(entry.type as CompressionEvidenceRef["type"])
            ? entry.type as CompressionEvidenceRef["type"]
            : "other";
          return [{
            type,
            ref,
            ...(entry.label ? { label: normalizeText(entry.label, 120) } : {}),
          }];
        })
      : []
  );
  const normalizeFacts = (items: unknown, maxItems: number): CompressionFact[] => (
    Array.isArray(items)
      ? items.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as Partial<CompressionFact>;
          const text = normalizeText(entry.text, 360);
          if (!text) return [];
          return [{ text, evidenceRefs: normalizeEvidence(entry.evidenceRefs) }];
        }).slice(0, maxItems)
      : []
  );
  const normalizedAtoms = normalizeSemanticAtoms(record.semanticAtoms);
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
    evidenceRefs: normalizeEvidence(record.evidenceRefs).slice(0, 24),
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
    ...(normalizeTelemetry(record.telemetry) ? { telemetry: normalizeTelemetry(record.telemetry) } : {}),
    ...(optionalArray(normalizeRehydratedFileContext(record.rehydratedFileContext)) ? {
      rehydratedFileContext: optionalArray(normalizeRehydratedFileContext(record.rehydratedFileContext)),
    } : {}),
    ...(optionalArray(normalizedAtoms.atoms) ? { semanticAtoms: optionalArray(normalizedAtoms.atoms) } : {}),
  };
  return {
    ...artifactWithoutQuality,
    quality: buildQuality(artifactWithoutQuality, DEFAULT_TARGET_ARTIFACT_TOKENS, normalizedAtoms.warnings),
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
