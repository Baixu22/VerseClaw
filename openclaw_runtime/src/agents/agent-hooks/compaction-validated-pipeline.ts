/**
 * P2 shared validated compaction pipeline.
 *
 * Both compaction providers and the built-in LLM summarizer are untrusted
 * string renderers. This module turns either output into the same
 * normalize -> artifact -> critical ledger comparison -> damage audit ->
 * shadow decision flow before details are persisted. It never calls a model,
 * never changes the returned summary, and never enforces repair.
 */
import type { AgentMessage } from "../runtime/index.js";
import {
  buildDeterministicCompressionArtifact,
  type CompressionArtifact,
  type CompressionEvidenceRef,
  type CompressionSemanticAtom,
  type SemanticAtomType,
} from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import {
  auditCompactionDamage,
  type CompactionDamageAudit,
} from "./compaction-damage-rules.js";
import {
  normalizeCompactionPromotionStage,
  type CompactionPromotionStage,
} from "./compaction-promotion.js";
import {
  auditSummaryQuality,
  extractOpaqueIdentifiers,
  summaryIncludesIdentifier,
} from "./compaction-safeguard-quality.js";

export const COMPACTION_VALIDATED_PIPELINE_SCHEMA = "compaction-validated-pipeline/v1" as const;

export type CompactionValidatedSource = "provider" | "llm" | "boundary";

export type CompactionCriticalLedgerAudit = {
  compared: number;
  missingAtomIds: string[];
  missingExactIdentifiers: string[];
};

export type CompactionValidatedDecision = {
  schema: typeof COMPACTION_VALIDATED_PIPELINE_SCHEMA;
  mode: CompactionPromotionStage;
  source: CompactionValidatedSource;
  wouldRetry: boolean;
  wouldFallback: boolean;
  wouldPreserveTurns: boolean;
  reasons: string[];
  quality: { ok: boolean; reasons: string[] };
  damage: CompactionDamageAudit;
  criticalLedger: CompactionCriticalLedgerAudit;
  repairAttempts: number;
};

export type ValidatedCompactionOutput = {
  artifact: CompressionArtifact;
  decision: CompactionValidatedDecision;
};

const MAX_CANDIDATE_ATOMS = 48;
const MAX_CANDIDATE_ATOM_TEXT = 240;
const MAX_RECENT_MESSAGES_FOR_IDENTIFIERS = 10;

/**
 * Low-information English verbs/nouns that should not count as meaningful
 * projection overlap. Exact canonicalIdentity matches still win; this only
 * prevents a shallow two-token overlap from treating a materially different
 * decision/goal as retained.
 */
const GENERIC_PROJECTION_TOKENS = new Set([
  "use",
  "using",
  "used",
  "make",
  "makes",
  "making",
  "made",
  "get",
  "gets",
  "getting",
  "got",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "keep",
  "keeps",
  "keeping",
  "kept",
  "run",
  "runs",
  "running",
  "ran",
  "implement",
  "implements",
  "implementing",
  "implemented",
  "fix",
  "fixes",
  "fixing",
  "fixed",
  "add",
  "adds",
  "adding",
  "added",
  "update",
  "updates",
  "updating",
  "updated",
  "write",
  "writes",
  "writing",
  "wrote",
  "review",
  "reviews",
  "reviewing",
  "reviewed",
  "check",
  "checks",
  "checking",
  "checked",
  "need",
  "needs",
  "needed",
  "try",
  "tries",
  "trying",
  "tried",
  "work",
  "works",
  "working",
  "worked",
  "thing",
  "things",
  "stuff",
  "way",
  "ways",
  "also",
  "still",
  "already",
  "just",
  "now",
  "new",
  "old",
]);

const CANDIDATE_HEADING_PATTERNS: Record<SemanticAtomType, RegExp[]> = {
  goal: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Goal(?:\s+and\s+Progress)?|Objective)\*{0,2}\s*:?\s*$/i,
  ],
  latest_user_ask: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Pending user asks?|Latest User Ask)\*{0,2}\s*:?\s*$/i,
  ],
  decision: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Key\s+)?Decisions?\*{0,2}\s*:?\s*$/i,
  ],
  constraint: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Key\s+Decisions\s+and\s+Constraints|Constraints?(?:\/Rules| & Preferences)?|Rules)\*{0,2}\s*:?\s*$/i,
  ],
  failed_attempt: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Attempts\s+and\s+Failures|Failed\s+Attempts?|Failures?|Failed\s+Attempts?\s+&\s+Failures?)\*{0,2}\s*:?\s*$/i,
  ],
  entity: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Exact\s+identifiers?|Entities|Files(?:\s+Touched)?)\*{0,2}\s*:?\s*$/i,
  ],
  next_action: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Next\s+Steps?|Next\s+Actions?|Open\s+TODOs?)\*{0,2}\s*:?\s*$/i,
  ],
  outcome: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Outcomes?|Results?|Current\s+State|Progress)\*{0,2}\s*:?\s*$/i,
  ],
  safety_boundary: [
    /^\s{0,3}#{1,6}\s+\*{0,2}(?:Safety(?:\s+Boundaries?)?|Red\s+Lines?|Hard\s+Rules?)\*{0,2}\s*:?\s*$/i,
  ],
};

const CRITICAL_ATOM_TYPES: ReadonlySet<SemanticAtomType> = new Set<SemanticAtomType>([
  "goal",
  "latest_user_ask",
  "decision",
  "constraint",
  "failed_attempt",
  "next_action",
]);

const CRITICAL_MARKER_PATTERNS: Array<{ type: SemanticAtomType; pattern: RegExp }> = [
  { type: "goal", pattern: /^\s*(?:objective|goal)\s*:\s*(.+)$/i },
  { type: "latest_user_ask", pattern: /^\s*(?:latest user ask|user ask|request|ask)\s*:\s*(.+)$/i },
  { type: "decision", pattern: /^\s*(?:decision|decided|choice)\s*:\s*(.+)$/i },
  { type: "constraint", pattern: /^\s*(?:constraint|rule|red line)\s*:\s*(.+)$/i },
  { type: "failed_attempt", pattern: /^\s*(?:failed attempt|failure|blocker|blocked|error)\s*:\s*(.+)$/i },
  { type: "next_action", pattern: /^\s*(?:next action|next step|todo|to-do|follow[- ]?up|remaining)\s*:\s*(.+)$/i },
];

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function collapseText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function atomIdentity(type: SemanticAtomType, text: string): string {
  return `${type}:${collapseText(text).toLowerCase()}`.slice(0, 200);
}

function truncateAtomText(text: string): string {
  const compact = collapseText(text);
  if (compact.length <= MAX_CANDIDATE_ATOM_TEXT) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, MAX_CANDIDATE_ATOM_TEXT - 24)).trim()} [truncated]`;
}

function atomSeverity(type: SemanticAtomType): CompressionSemanticAtom["severity"] {
  return CRITICAL_ATOM_TYPES.has(type) ? "critical" : "important";
}

function atomPolarity(type: SemanticAtomType): CompressionSemanticAtom["polarity"] {
  if (type === "failed_attempt") {
    return "negative";
  }
  if (type === "goal" || type === "next_action") {
    return "positive";
  }
  return "neutral";
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function messageEvidence(message: AgentMessage, index: number): CompressionEvidenceRef {
  const id = (message as { id?: unknown }).id;
  return {
    type: "session",
    ref: typeof id === "string" && id.trim() ? id.trim() : `message:${index + 1}`,
    label: `${message.role} message`,
  };
}

function baseEvidence(messages: AgentMessage[]): CompressionEvidenceRef[] {
  if (messages.length === 0) {
    return [];
  }
  const first = messageEvidence(messages[0]!, 0);
  const last = messageEvidence(messages[messages.length - 1]!, messages.length - 1);
  return first.ref === last.ref ? [first] : [first, last];
}

function isHeadingLine(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function headingType(line: string): SemanticAtomType | undefined {
  const trimmed = line.trim();
  for (const [type, patterns] of Object.entries(CANDIDATE_HEADING_PATTERNS) as [
    SemanticAtomType,
    RegExp[],
  ][]) {
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      return type;
    }
  }
  return undefined;
}

type SummarySection = {
  type: SemanticAtomType;
  lines: string[];
};

function collectSummarySections(summary: string): SummarySection[] {
  const lines = summary.split(/\r?\n/u);
  const sections: SummarySection[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const type = headingType(lines[cursor] ?? "");
    if (!type) {
      cursor += 1;
      continue;
    }
    const body: string[] = [];
    let next = cursor + 1;
    while (next < lines.length && !isHeadingLine(lines[next] ?? "")) {
      body.push(lines[next] ?? "");
      next += 1;
    }
    sections.push({ type, lines: body });
    cursor = next;
  }
  return sections;
}

function isPlaceholderLine(line: string): boolean {
  const normalized = collapseText(line).toLowerCase().replace(/^[-*+]\s*/, "");
  return (
    normalized.length === 0 ||
    /^(none|n\/a|nothing|no prior history|not applicable|cannot be determined)[.:]?$/u.test(normalized) ||
    /^(none|cannot be determined) captured\.?$/u.test(normalized)
  );
}

function splitSectionItems(section: SummarySection): string[] {
  const bulletItems = section.lines
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)]|\[[ xX]\])\s*/u, "").trim())
    .filter((line) => line.length > 0 && !isPlaceholderLine(line));
  if (bulletItems.length > 0) {
    return bulletItems;
  }
  const prose = collapseText(section.lines.join(" "));
  if (!prose || isPlaceholderLine(prose)) {
    return [];
  }
  return [prose];
}

function previousAtomMatch(
  previousArtifact: CompressionArtifact | undefined,
  type: SemanticAtomType,
  text: string,
): CompressionSemanticAtom | undefined {
  const atoms = previousArtifact?.semanticAtoms ?? [];
  const identity = atomIdentity(type, text);
  return atoms.find(
    (item) =>
      item.type === type &&
      (collapseText(item.canonicalIdentity).toLowerCase() === identity ||
        atomIdentity(item.type, item.text) === identity),
  );
}

function toCandidateAtom(params: {
  type: SemanticAtomType;
  text: string;
  index: number;
  messages: AgentMessage[];
  previousArtifact?: CompressionArtifact;
}): CompressionSemanticAtom {
  const { type, text, index } = params;
  const boundedText = truncateAtomText(text);
  const identity = atomIdentity(type, boundedText);
  const previous = previousAtomMatch(params.previousArtifact, type, boundedText);
  const evidence = previous?.evidenceRefs ?? baseEvidence(params.messages);
  return {
    id: previous?.id ?? `atom-${type}-${fnv1a(identity)}-${index + 1}`,
    type,
    canonicalIdentity: previous?.canonicalIdentity ?? identity,
    severity: previous?.severity ?? atomSeverity(type),
    confidence: previous?.confidence ?? 1,
    scope: previous?.scope ?? "session",
    polarity: previous?.polarity ?? atomPolarity(type),
    status: previous?.status ?? (evidence.length > 0 ? "verified" : "unverified"),
    text: boundedText,
    evidenceRefs: evidence,
    ...(previous?.supersedes?.length ? { supersedes: previous.supersedes } : {}),
    ...(previous?.conflicts?.length ? { conflicts: previous.conflicts } : {}),
    ...(previous?.updatedAt !== undefined ? { updatedAt: previous.updatedAt } : {}),
    source: previous?.source ?? { kind: "summary", ref: "compaction-summary" },
  };
}

export function extractCandidateSemanticAtoms(params: {
  summary: string;
  messages: AgentMessage[];
  previousArtifact?: CompressionArtifact;
}): CompressionSemanticAtom[] {
  const candidates: CompressionSemanticAtom[] = [];
  const counts = new Map<SemanticAtomType, number>();
  for (const section of collectSummarySections(params.summary)) {
    for (const item of splitSectionItems(section)) {
      if (candidates.length >= MAX_CANDIDATE_ATOMS) {
        return candidates;
      }
      const index = counts.get(section.type) ?? 0;
      const candidate = toCandidateAtom({
        type: section.type,
        text: item,
        index,
        messages: params.messages,
        previousArtifact: params.previousArtifact,
      });
      if (
        !candidates.some(
          (existing) =>
            existing.type === candidate.type &&
            atomIdentity(existing.type, existing.text) === atomIdentity(candidate.type, candidate.text),
        )
      ) {
        candidates.push(candidate);
      }
      counts.set(section.type, index + 1);
    }
  }
  for (const line of params.summary.split(/\r?\n/u)) {
    for (const marker of CRITICAL_MARKER_PATTERNS) {
      const match = marker.pattern.exec(line);
      if (!match?.[1]?.trim() || candidates.length >= MAX_CANDIDATE_ATOMS) continue;
      const index = counts.get(marker.type) ?? 0;
      const candidate = toCandidateAtom({
        type: marker.type,
        text: match[1].trim(),
        index,
        messages: params.messages,
        previousArtifact: params.previousArtifact,
      });
      if (!candidates.some((existing) => (
        existing.type === candidate.type
        && atomIdentity(existing.type, existing.text) === atomIdentity(candidate.type, candidate.text)
      ))) {
        candidates.push(candidate);
      }
      counts.set(marker.type, index + 1);
      break;
    }
  }
  return candidates;
}

/**
 * Build the first-compaction comparison side from explicit, structured message
 * markers. Raw transcript prose is intentionally ignored: only messages that
 * declare a recoverability-relevant fact become an authoritative baseline.
 */
function extractAuthoritativeCriticalAtoms(params: {
  messages: AgentMessage[];
  previousArtifact?: CompressionArtifact;
}): CompressionSemanticAtom[] {
  const entries: Array<{ type: SemanticAtomType; text: string }> = [];
  for (const message of params.messages) {
    const text = messageText(message);
    for (const section of collectSummarySections(text)) {
      if (!CRITICAL_ATOM_TYPES.has(section.type)) continue;
      for (const item of splitSectionItems(section)) {
        entries.push({ type: section.type, text: item });
      }
    }
    for (const line of text.split(/\r?\n/u)) {
      for (const marker of CRITICAL_MARKER_PATTERNS) {
        const match = marker.pattern.exec(line);
        if (match?.[1]?.trim()) {
          entries.push({ type: marker.type, text: match[1].trim() });
          break;
        }
      }
    }
  }
  const atoms: CompressionSemanticAtom[] = [];
  const counts = new Map<SemanticAtomType, number>();
  for (const entry of entries) {
    const index = counts.get(entry.type) ?? 0;
    const candidate = toCandidateAtom({
      type: entry.type,
      text: entry.text,
      index,
      messages: params.messages,
      previousArtifact: params.previousArtifact,
    });
    counts.set(entry.type, index + 1);
    if (!atoms.some((existing) => (
      existing.type === candidate.type
      && atomIdentity(existing.type, existing.text) === atomIdentity(candidate.type, candidate.text)
    ))) {
      atoms.push(candidate);
    }
    if (atoms.length >= MAX_CANDIDATE_ATOMS) break;
  }
  return atoms;
}

function meaningfulTokens(value: string): string[] {
  const tokens = value
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [
    ...new Set(
      tokens.filter(
        (token) => token.length >= 2 && !GENERIC_PROJECTION_TOKENS.has(token),
      ),
    ),
  ];
}

function projectionOverlap(previous: CompressionSemanticAtom, candidate: CompressionSemanticAtom): boolean {
  const previousTokens = meaningfulTokens(previous.text);
  const candidateTokens = new Set(meaningfulTokens(candidate.text));
  const overlapCount = previousTokens.filter((token) => candidateTokens.has(token)).length;
  const requiredMatches = Math.min(2, previousTokens.length, candidateTokens.size);
  return overlapCount >= requiredMatches;
}

function previousAtomMatchesCandidate(previous: CompressionSemanticAtom, candidate: CompressionSemanticAtom): boolean {
  if (
    previous.type === candidate.type &&
    collapseText(previous.canonicalIdentity).toLowerCase() ===
      collapseText(candidate.canonicalIdentity).toLowerCase()
  ) {
    return true;
  }
  return projectionOverlap(previous, candidate);
}

function comparedCriticalAtoms(
  previousArtifact: CompressionArtifact | undefined,
  messages: AgentMessage[] = [],
): CompressionSemanticAtom[] {
  const retained = (previousArtifact?.semanticAtoms ?? []).filter(
    (atom) =>
      atom.severity === "critical" &&
      atom.status !== "superseded" &&
      atom.status !== "stale",
  );
  return retained.length > 0
    ? retained
    : extractAuthoritativeCriticalAtoms({ messages, previousArtifact });
}

function compareCriticalLedger(params: {
  previousArtifact: CompressionArtifact | undefined;
  messages: AgentMessage[];
  candidates: CompressionSemanticAtom[];
}): { compared: number; missingAtomIds: string[] } {
  const comparedAtoms = comparedCriticalAtoms(params.previousArtifact, params.messages);
  const missingAtomIds: string[] = [];
  for (const previous of comparedAtoms) {
    const matched = params.candidates.some((candidate) =>
      previousAtomMatchesCandidate(previous, candidate),
    );
    if (!matched) {
      missingAtomIds.push(`missing_atom:${previous.id}`);
    }
  }
  return { compared: comparedAtoms.length, missingAtomIds };
}

function recentMessageText(messages: AgentMessage[]): string {
  return messages.slice(-MAX_RECENT_MESSAGES_FOR_IDENTIFIERS).map(messageText).filter(Boolean).join("\n");
}

function criticalAtomIdentifierText(atoms: CompressionSemanticAtom[]): string {
  return atoms
    .map((atom) => `${atom.canonicalIdentity}\n${atom.text}`)
    .join("\n");
}

function collectExactIdentifierSources(params: {
  identifiers?: string[];
  messages: AgentMessage[];
  comparedAtoms: CompressionSemanticAtom[];
}): string[] {
  const fromCaller = params.identifiers ?? [];
  const fromMessages = extractOpaqueIdentifiers(recentMessageText(params.messages));
  const fromCriticalAtoms = extractOpaqueIdentifiers(
    criticalAtomIdentifierText(params.comparedAtoms),
  );
  return [...new Set([...fromCaller, ...fromMessages, ...fromCriticalAtoms])];
}

function compareExactIdentifiers(summary: string, identifiers: string[]): string[] {
  return identifiers
    .filter((identifier) => !summaryIncludesIdentifier(summary, identifier))
    .map((identifier) => `missing_exact_identifier:${identifier}`);
}

function buildDecision(params: {
  source: CompactionValidatedSource;
  quality: { ok: boolean; reasons: string[] };
  damage: CompactionDamageAudit;
  criticalLedger: CompactionCriticalLedgerAudit;
  promotionStage?: CompactionPromotionStage;
}): CompactionValidatedDecision {
  const { quality, damage, criticalLedger } = params;
  const hasCriticalGoalDecay = damage.damages.some(
    (item) => item.type === "goal_token_decay" && item.severity === "critical",
  );
  const wouldRetry =
    !quality.ok ||
    damage.verdict === "suspect" ||
    criticalLedger.missingAtomIds.length > 0 ||
    criticalLedger.missingExactIdentifiers.length > 0;
  const wouldFallback = hasCriticalGoalDecay || criticalLedger.missingAtomIds.length > 0;
  const wouldPreserveTurns = wouldFallback;
  const reasons = [
    ...quality.reasons,
    ...damage.damages.map((item) => `${item.type}:${item.detail}`),
    ...criticalLedger.missingAtomIds,
    ...criticalLedger.missingExactIdentifiers,
  ];
  return {
    schema: COMPACTION_VALIDATED_PIPELINE_SCHEMA,
    mode: normalizeCompactionPromotionStage(params.promotionStage),
    source: params.source,
    wouldRetry,
    wouldFallback,
    wouldPreserveTurns,
    reasons,
    quality,
    damage,
    criticalLedger,
    repairAttempts: 0,
  };
}

export function buildValidatedCompactionOutput(params: {
  source: CompactionValidatedSource;
  summary: string;
  messages: AgentMessage[];
  previousSummary?: string;
  previousArtifact?: CompressionArtifact;
  readFiles?: string[];
  modifiedFiles?: string[];
  identifiers?: string[];
  latestAsk?: string | null;
  identifierPolicy?: "strict" | "off" | "custom";
  promotionStage?: CompactionPromotionStage;
}): ValidatedCompactionOutput {
  const candidates = extractCandidateSemanticAtoms({
    summary: params.summary,
    messages: params.messages,
    previousArtifact: params.previousArtifact,
  });
  const comparedAtoms = comparedCriticalAtoms(params.previousArtifact, params.messages);
  const ledger = compareCriticalLedger({
    previousArtifact: params.previousArtifact,
    messages: params.messages,
    candidates,
  });
  const exactIdentifiers = collectExactIdentifierSources({
    identifiers: params.identifiers,
    messages: params.messages,
    comparedAtoms,
  });
  const enforceExactIdentifiers = (params.identifierPolicy ?? "strict") === "strict";
  const missingExactIdentifiers = enforceExactIdentifiers
    ? compareExactIdentifiers(params.summary, exactIdentifiers)
    : [];
  const quality = auditSummaryQuality({
    summary: params.summary,
    identifiers: exactIdentifiers,
    latestAsk: params.latestAsk ?? null,
    identifierPolicy: params.identifierPolicy,
  });
  const damage = auditCompactionDamage(params.summary, { mode: "shadow" });
  const decision = buildDecision({
    source: params.source,
    quality,
    damage,
    criticalLedger: {
      compared: ledger.compared,
      missingAtomIds: ledger.missingAtomIds,
      missingExactIdentifiers,
    },
    promotionStage: params.promotionStage,
  });
  const artifact = buildDeterministicCompressionArtifact({
    messages: params.messages,
    previousSummary: params.previousSummary,
    previousArtifact: params.previousArtifact,
    summary: params.summary,
    readFiles: params.readFiles,
    modifiedFiles: params.modifiedFiles,
    semanticAtoms: candidates,
  });

  return { artifact, decision };
}
