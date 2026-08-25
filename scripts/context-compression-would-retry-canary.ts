/**
 * P6 Phase 3 would-retry canary.
 *
 * Runs the fixed production-manifest-30 preparations through a real
 * OpenAI-compatible compaction provider in both arms:
 *   - shadow: no retry
 *   - would-retry: one bounded retry when finalizeSafeguardCompaction says
 *     wouldRetry
 *
 * Outputs paired summaries and a JSON metrics report. The API key is read
 * from the environment only and is never written.
 *
 * Run from openclaw_runtime so tsx resolves runtime node_modules:
 *   COMPACTION_API_KEY=... COMPACTION_BASE_URL=https://api.deepseek.com/v1 \
 *   COMPACTION_MODEL=deepseek-chat pnpm --dir openclaw_runtime exec tsx \
 *     D:/verse_claw_worktree_compact/scripts/context-compression-would-retry-canary.ts \
 *     --manifest D:/verse_claw_worktree_compact/reports/context-compression/production-manifest-30.json \
 *     --meta D:/verse_claw_worktree_compact/reports/context-compression/production-summaries-30-generated.meta.json \
 *     --out D:/verse_claw_worktree_compact/artifacts/p6-would-retry-canary
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  type CompactionPreparation,
} from "../openclaw_runtime/packages/agent-core/src/index.js";
import {
  buildValidatedCompactionOutput,
} from "../openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.js";
import {
  extractOpaqueIdentifiers,
  summaryIncludesIdentifier,
} from "../openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.js";
import {
  REQUIRED_COMPACTION_SECTIONS,
} from "../openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.js";
import {
  normalizeCompactionPromotionStage,
  resolveCompactionPromotionEnforcement,
} from "../openclaw_runtime/src/agents/agent-hooks/compaction-promotion.js";

const require = createRequire(import.meta.url);
const sdk = require("../openclaw_runtime/node_modules/openclaw/dist/plugin-sdk/agent-sessions.js");
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function workspacePath(file: string): string {
  return resolve(WORKSPACE_ROOT, file);
}

function providerConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env.COMPACTION_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "";
  const configuredBaseUrl = (
    process.env.COMPACTION_BASE_URL?.trim()
    || process.env.DEEPSEEK_BASE_URL?.trim()
    || "https://api.deepseek.com/v1"
  ).replace(/\/+$/u, "");
  let baseUrl = configuredBaseUrl;
  try {
    const parsed = new URL(configuredBaseUrl);
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/v1";
    baseUrl = parsed.toString().replace(/\/+$/u, "");
  } catch {
    // Keep the original value so fetch reports the malformed endpoint clearly.
  }
  const model = process.env.COMPACTION_MODEL?.trim() || "deepseek-chat";
  return { apiKey, baseUrl, model };
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: any): string {
  return sha256(stableJson(value));
}

function normalizePressureCohort(value: any): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "emergency") return raw || "emergency";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric) : raw;
}

function normalizeProviderCohort(value: any): string {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]/gu, "-");
  return raw || "unknown";
}

function manifestSampleKeyV2(sample: any): string {
  return hashJson({
    source: "real",
    version: 2,
    transcriptIdentity: {
      pathHash: sample.transcript?.fileHash,
      basename: sample.transcript?.basename,
      size: sample.transcript?.size,
      mtimeMs: sample.transcript?.mtimeMs,
    },
    turnCohort: sample.cohort?.turn,
    pressureCohort: normalizePressureCohort(sample.cohort?.pressure),
    providerCohort: normalizeProviderCohort(sample.cohort?.provider),
    splitTurnCohort: sample.cohort?.splitTurn ?? "unknown",
    previousSummaryCohort: sample.cohort?.previousSummary ?? "unknown",
    fileHunkCohort: sample.cohort?.fileHunk ?? "unknown",
    evidenceMessageIds: sample.evidenceMessageIds ?? [],
  });
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

function sourceFingerprint(): any {
  const files = [
    "scripts/context-compression-would-retry-canary.ts",
    "scripts/context-compression-recovery-ledger.mjs",
    "openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.ts",
    "openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.ts",
  ];
  return {
    gitHead: gitHead(),
    worktreeStatusSha256: (() => {
      try {
        return sha256(execFileSync("git", ["status", "--short", "--untracked-files=all"], { encoding: "utf8" }));
      } catch {
        return "unavailable";
      }
    })(),
    files: files.map((file) => ({
      file,
      sha256: sha256(readFileSync(workspacePath(file))),
    })),
    treeHash: hashJson(files.map((file) => ({ file, sha256: sha256(readFileSync(workspacePath(file))) }))),
  };
}

function validateCanaryManifest(manifest: any, manifestPath: string, meta: any, only: string[]): any {
  const errors: string[] = [];
  const samples = Array.isArray(manifest?.samples) ? manifest.samples : [];
  if (manifest?.version !== 2) errors.push(`manifest_version:${String(manifest?.version ?? "missing")}`);
  if (!Number.isInteger(manifest?.requestedSampleCount)) errors.push("requestedSampleCount_invalid");
  if (manifest?.requestedSampleCount !== samples.length) {
    errors.push(`requestedSampleCount_mismatch:${manifest?.requestedSampleCount ?? "missing"}!=${samples.length}`);
  }
  if (manifest?.sampleSelectionHash !== hashJson(samples)) errors.push("sampleSelectionHash_mismatch");
  if (manifest?.sourceManifestPath && manifest?.sourceManifestSha256) {
    try {
      if (sha256(readFileSync(manifest.sourceManifestPath)) !== manifest.sourceManifestSha256) {
        errors.push("sourceManifestSha256_mismatch");
      }
    } catch {
      errors.push("sourceManifest_unreadable");
    }
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const sample of samples) {
    if (!sample?.id || ids.has(sample.id)) errors.push(`duplicate_or_missing_sample_id:${sample?.id ?? "missing"}`);
    ids.add(sample?.id);
    if (!sample?.key || keys.has(sample.key)) errors.push(`duplicate_or_missing_sample_key:${sample?.id ?? "missing"}`);
    keys.add(sample?.key);
    if (sample?.source !== "real") errors.push(`sample_source_invalid:${sample?.id ?? "missing"}`);
    if (sample?.key !== manifestSampleKeyV2(sample)) errors.push(`sample_key_mismatch:${sample?.id ?? "missing"}`);
  }
  const metaById = new Map<string, any>((meta?.entries ?? []).map((entry: any) => [entry.sampleId, entry]));
  for (const sample of samples) {
    const entry = metaById.get(sample.id);
    if (!entry?.file) {
      errors.push(`meta_missing:${sample.id}`);
      continue;
    }
    try {
      const absolute = resolve(entry.file);
      const stat = statSync(absolute);
      const pathHash = sha256(absolute.toLowerCase());
      if (
        pathHash !== sample.transcript?.fileHash
        || basename(absolute) !== sample.transcript?.basename
        || stat.size !== sample.transcript?.size
        || Math.floor(stat.mtimeMs) !== sample.transcript?.mtimeMs
      ) errors.push(`transcript_identity_mismatch:${sample.id}`);
    } catch {
      errors.push(`transcript_unreadable:${sample.id}`);
    }
  }
  const selectedIds = only.length ? only : samples.map((sample: any) => sample.id);
  for (const id of selectedIds) {
    if (!ids.has(id)) errors.push(`selected_sample_missing:${id}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    manifestPath,
    manifestSha256: sha256(readFileSync(manifestPath)),
    version: manifest?.version,
    requestedSampleCount: manifest?.requestedSampleCount,
    sampleCount: samples.length,
    sampleSelectionHash: manifest?.sampleSelectionHash,
    selectedIds,
    sourceManifestSha256: manifest?.sourceManifestSha256 ?? null,
  };
}

function messageText(message: any): string {
  const content = message?.content ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (typeof block === "string" ? block : block?.text ?? block?.content ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

function roleFor(message: any): string {
  const role = message?.role;
  if (role === "assistant") return "assistant";
  if (role === "user") return "user";
  return "user";
}

const [
  DECISIONS_HEADING,
  OPEN_TODOS_HEADING,
  CONSTRAINTS_HEADING,
  PENDING_ASKS_HEADING,
  EXACT_IDENTIFIERS_HEADING,
] = REQUIRED_COMPACTION_SECTIONS;

const HANDOFF_SECTIONS = [
  "## Goal and Progress",
  "## Attempts and Failures",
  DECISIONS_HEADING,
  OPEN_TODOS_HEADING,
  CONSTRAINTS_HEADING,
  PENDING_ASKS_HEADING,
  "## Current State",
  "## Files Touched",
  "## Tests",
  EXACT_IDENTIFIERS_HEADING,
  "## Next Actions",
] as const;

const HANDOFF_SECTION_ALIASES: Record<string, readonly string[]> = {
  "## Failed Attempts": ["## Attempts and Failures"],
  "## Key Decisions": [DECISIONS_HEADING],
  "## Key Decisions and Constraints": [DECISIONS_HEADING, CONSTRAINTS_HEADING],
  "## Files Touched / Relevant Files": ["## Files Touched"],
  "## Tests and Results": ["## Tests"],
};

function handoffSectionHeadings(value: string): readonly string[] {
  const exact = HANDOFF_SECTIONS.find((heading) => heading === value);
  return exact ? [exact] : HANDOFF_SECTION_ALIASES[value] ?? [];
}

function collectHandoffSections(lines: readonly string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let activeHeadings: readonly string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+/u.test(trimmed)) {
      activeHeadings = handoffSectionHeadings(trimmed);
      for (const heading of activeHeadings) {
        if (!sections.has(heading)) sections.set(heading, []);
      }
      continue;
    }
    for (const heading of activeHeadings) sections.get(heading)?.push(line);
  }
  return sections;
}

const PROVIDER_PROMPT = `You are a pluggable compaction provider. Create a concise context handoff for another LLM.
Use these exact section headings, each on its own line, in this order:
${HANDOFF_SECTIONS.join("\n")}

Evidence-fidelity rules:
- Treat the conversation as the only source of truth. Do not infer or invent facts, paths, usernames, completion state, pending reports, or intent.
- Preserve exact user objectives, file paths, function names, command lines, error messages, exit codes, test counts, and verification evidence.
- For failures preserve attempt -> exact failure -> evidenced root cause -> adjustment -> validation -> next action.
- Do not add numeric counts, permissions, cost/risk, or intent that are not explicitly evidenced.
- Mark completed work as completed and pending work as pending. A final report or explicit success response in the conversation means the work is complete; do not rewrite it as pending.
- Prefer the latest evidenced outcome and current user ask over stale earlier next-action text. Do not direct the next LLM to repeat completed work.
- Under ## Open TODOs and ## Pending user asks, write "None." when no unresolved work is evidenced.
- Do not emit analysis, planning notes, or alternate handoff drafts outside the named sections.
- Preserve redaction markers exactly. Never replace [REDACTED_USER] with a guessed username or concrete home-directory path.
- The authoritative recovery ledger and continuation directive are evidence to reconcile, not permission to add unsupported claims.`;

function redactProviderText(value: string): string {
  return String(value ?? "")
    .replace(/\bC:\\+Users\\+[^\\\s/]+/giu, "C:\\Users\\[REDACTED_USER]")
    .replace(/\bC:\/+Users\/+[^/\s\\]+/giu, "C:/Users/[REDACTED_USER]")
    .replace(/(?:\/Users|\/home)\/+[^/\s]+/giu, (match) => `${match.slice(0, match.lastIndexOf("/") + 1)}[REDACTED_USER]`)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/gu, "[REDACTED_API_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [REDACTED_AUTH_TOKEN]");
}

function redactEvidenceView<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(
    JSON.stringify(value),
    (_key, item) => typeof item === "string" ? redactProviderText(item) : item,
  ) as T;
}

function sanitizeProviderSummary(value: string): string {
  const lines = redactProviderText(value)
    .split(/\r?\n/u)
    .map((line) => line.trimEnd());
  const ledgerStart = lines.findIndex((line) => [
    "## Critical Recovery Ledger",
    "## Important Recovery Ledger",
    "## Nice-to-Have Recovery Ledger",
    "## Continuation Directive (authoritative)",
  ].includes(line.trim()));
  const narrative = ledgerStart >= 0 ? lines.slice(0, ledgerStart) : lines;
  let start = -1;
  for (let index = 0; index < narrative.length; index += 1) {
    if (narrative[index]?.trim() === HANDOFF_SECTIONS[0]) start = index;
  }
  if (start < 0) return narrative.join("\n").trim();
  const sections = collectHandoffSections(narrative.slice(start));
  const normalized = HANDOFF_SECTIONS.map((heading) => {
    const content = sections.get(heading)?.join("\n").trim();
    return content ? `${heading}\n${content}` : "";
  }).filter(Boolean);
  return normalized.join("\n\n").trim();
}

type RecoveryMaterial = {
  ledgerText: string;
  directiveText: string;
  identifiers: string[];
};

const EMPTY_HANDOFF_SECTION_TEXT: Record<string, string> = {
  "## Goal and Progress": "- No objective was promoted in this narrative; see the authoritative recovery ledger below.",
  "## Attempts and Failures": "- No failure evidence was promoted in this narrative; see the authoritative recovery ledger below.",
  [DECISIONS_HEADING]: "- No decision was promoted in this narrative; see the authoritative recovery ledger below.",
  [OPEN_TODOS_HEADING]: "- See the authoritative continuation directive below.",
  [CONSTRAINTS_HEADING]: "- No constraint was promoted in this narrative; see the authoritative recovery ledger below.",
  [PENDING_ASKS_HEADING]: "- See the authoritative continuation directive below.",
  "## Current State": "- No current-state claim was promoted in this narrative; see the authoritative recovery ledger below.",
  "## Files Touched": "- No file path was promoted in this narrative; see the authoritative recovery ledger below.",
  "## Tests": "- No validation result was promoted in this narrative; see the authoritative recovery ledger below.",
  [EXACT_IDENTIFIERS_HEADING]: "- None evidenced.",
  "## Next Actions": "- See the authoritative continuation directive below.",
};

function continuationActionId(recovery?: RecoveryMaterial): string | undefined {
  return /candidate action id "([^"]+)"/u.exec(recovery?.directiveText ?? "")?.[1];
}

function repairHandoffStructure(summary: string, recovery?: RecoveryMaterial): string {
  const sections = collectHandoffSections(String(summary ?? "").split(/\r?\n/u));
  const actionId = continuationActionId(recovery);
  return HANDOFF_SECTIONS.flatMap((heading) => {
    const existing = sections.get(heading)?.join("\n").trim();
    const fallback = heading === "## Next Actions" && actionId
      ? `- Follow authoritative candidate action id "${actionId}"; see directive below.`
      : EMPTY_HANDOFF_SECTION_TEXT[heading];
    return [heading, existing || fallback, ""];
  }).join("\n").trim();
}

const IDENTIFIER_FACT_CATEGORIES = new Set([
  "objective",
  "decision",
  "constraint",
  "file_context",
  "file_mutation",
  "test_result",
]);

function buildEvidenceBackedIdentifiers(ledger: any, directive: any): string[] {
  const facts = (ledger.expected ?? []).filter((item: any) => IDENTIFIER_FACT_CATEGORIES.has(item.category));
  const fileIdentifiers = facts
    .filter((item: any) => item.category === "file_context" || item.category === "file_mutation")
    .map((item: any) => item.text);
  const extractedIdentifiers = facts.flatMap((item: any) => extractOpaqueIdentifiers(item.text));
  const actionIdentifiers = [directive.primary, ...(directive.support ?? [])]
    .map((action: any) => action?.id)
    .filter((value: unknown): value is string => typeof value === "string" && value.length > 0);
  return [...new Set([...fileIdentifiers, ...extractedIdentifiers, ...actionIdentifiers]
    .map((value) => redactProviderText(value))
    .filter((value) => value.length >= 4))]
    .slice(0, 16);
}

function buildRetryInstructions(params: {
  stage: "shadow" | "would-retry";
  reasons: string[];
  recovery?: RecoveryMaterial;
}): string {
  const feedback = [
    `P6 ${params.stage} feedback:`,
    ...params.reasons.slice(0, 8),
  ].join("\n");
  if (!params.recovery) return feedback;
  const identifierList = params.recovery.identifiers.length
    ? `\n\nRequired evidence-backed exact identifiers:\n${params.recovery.identifiers.map((item) => `- ${item}`).join("\n")}`
    : "";
  return `${feedback}

Authoritative recovery material follows. Use it to repair the narrative without contradicting it.
Do not paraphrase or repeat the named ledger/directive sections; the caller appends them verbatim.
${identifierList}

${params.recovery.ledgerText}

${params.recovery.directiveText}`;
}

function appendRecoveryMaterial(summary: string, recovery?: RecoveryMaterial): string {
  return recovery
    ? `${summary}

${recovery.ledgerText}

${recovery.directiveText}`.trim()
    : summary;
}

const COMPLETED_OUTCOME_DIRECTIVE = "Do not repeat completed work; preserve the validated outcome:";
const ACTIONABLE_PENDING_PATTERN = /(?:\b(?:pending|in progress|unfinished|outstanding|still needs?|remains? to be|not yet (?:completed|delivered|reported|run|executed|attempted|performed|verified|evidenced))\b|(?:待办|待交付|未完成|尚未|仍需|待执行|待报告|未交付|未尝试|未验证))/iu;
const NEGATED_PENDING_PATTERN = /\b(?:no|none|not)\b.{0,24}\b(?:pending|in progress|unfinished|outstanding|still needs?|remains? to be)\b|(?:无|没有|不再).{0,12}(?:待办|待交付|未完成|尚未|仍需)/giu;
const COMPLETION_CLEARED_SECTIONS = new Set([
  OPEN_TODOS_HEADING,
  PENDING_ASKS_HEADING,
  "## Next Actions",
]);
const COMPLETION_FILTERED_SECTIONS = new Set([
  "## Goal and Progress",
  "## Attempts and Failures",
  "## Current State",
]);

function sectionText(summary: string, headings: readonly string[]): string {
  const lines = summary.split(/\r?\n/u);
  const selected: string[] = [];
  let capture = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+/u.test(trimmed)) {
      capture = headings.includes(trimmed);
      continue;
    }
    if (capture) selected.push(trimmed);
  }
  return selected
    .map((line) => line.replace(NEGATED_PENDING_PATTERN, "").trim())
    .filter(Boolean)
    .join("\n");
}

function hasUnredactedUserPath(value: string): boolean {
  return [
    /\bC:\\+Users\\+(?!\[REDACTED_USER\](?:\\|\/|$))[^\\/\s]+/iu,
    /\bC:\/+Users\/+(?!\[REDACTED_USER\](?:\\|\/|$))[^\\/\s]+/iu,
    /(?:\/Users|\/home)\/+(?!\[REDACTED_USER\](?:\/|$))[^/\s]+/iu,
  ].some((pattern) => pattern.test(value));
}

function hasCompletedOutcome(recovery?: RecoveryMaterial): boolean {
  return recovery?.directiveText.includes(COMPLETED_OUTCOME_DIRECTIVE) ?? false;
}

function hasActionablePending(summary: string): boolean {
  const actionableStatus = sectionText(summary, [
    "## Goal and Progress",
    "## Attempts and Failures",
    OPEN_TODOS_HEADING,
    PENDING_ASKS_HEADING,
    "## Current State",
    "## Next Actions",
  ]);
  return actionableStatus.split(/\r?\n/u).some((line) => ACTIONABLE_PENDING_PATTERN.test(line));
}

function reconcileCompletedNarrative(summary: string, recovery?: RecoveryMaterial): string {
  if (!hasCompletedOutcome(recovery)) return summary;
  const output: string[] = [];
  let activeHeading = "";
  for (const line of summary.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (/^##\s+/u.test(trimmed)) {
      if (COMPLETION_CLEARED_SECTIONS.has(activeHeading)) output.push("None.", "");
      activeHeading = trimmed;
      output.push(trimmed);
      continue;
    }
    if (COMPLETION_CLEARED_SECTIONS.has(activeHeading)) continue;
    if (
      COMPLETION_FILTERED_SECTIONS.has(activeHeading)
      && ACTIONABLE_PENDING_PATTERN.test(trimmed.replace(NEGATED_PENDING_PATTERN, "").trim())
    ) {
      continue;
    }
    output.push(line);
  }
  if (COMPLETION_CLEARED_SECTIONS.has(activeHeading)) output.push("None.");
  return output.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function withCompletionConflict(
  decision: any,
  narrativeSummary: string,
  recovery?: RecoveryMaterial,
): any {
  if (!hasCompletedOutcome(recovery) || !hasActionablePending(narrativeSummary)) return decision;
  return {
    ...decision,
    wouldRetry: true,
    reasons: [...new Set([...(decision.reasons ?? []), "stale_completed_pending"])],
  };
}

function missingRecoveryIdentifiers(summary: string, recovery?: RecoveryMaterial): string[] {
  return (recovery?.identifiers ?? []).filter((identifier) => !summaryIncludesIdentifier(summary, identifier));
}

function withIdentifierConflict(
  decision: any,
  narrativeSummary: string,
  recovery?: RecoveryMaterial,
): any {
  const missing = missingRecoveryIdentifiers(narrativeSummary, recovery);
  if (missing.length === 0) return decision;
  const missingReasons = missing.map((identifier) => `missing_exact_identifier:${identifier}`);
  return {
    ...decision,
    wouldRetry: true,
    reasons: [...new Set([...(decision.reasons ?? []), ...missingReasons])],
    criticalLedger: {
      ...decision.criticalLedger,
      missingExactIdentifiers: missingReasons,
    },
  };
}

function withRecoveryConflicts(
  decision: any,
  narrativeSummary: string,
  recovery?: RecoveryMaterial,
): any {
  return withIdentifierConflict(
    withCompletionConflict(decision, narrativeSummary, recovery),
    narrativeSummary,
    recovery,
  );
}

function reconcileExactIdentifiers(summary: string, recovery?: RecoveryMaterial): string {
  const missing = missingRecoveryIdentifiers(summary, recovery);
  if (missing.length === 0) return summary;
  const lines = summary.split(/\r?\n/u);
  const exactIndex = lines.findIndex((line) => line.trim() === EXACT_IDENTIFIERS_HEADING);
  const bullets = missing.map((identifier) => `- ${identifier}`);
  if (exactIndex >= 0) {
    const nextHeading = lines.findIndex(
      (line, index) => index > exactIndex && /^##\s+/u.test(line.trim()),
    );
    const sectionEnd = nextHeading >= 0 ? nextHeading : lines.length;
    const existing = lines
      .slice(exactIndex + 1, sectionEnd)
      .filter((line) => line.trim() && line.trim().toLowerCase() !== "none.");
    return [
      ...lines.slice(0, exactIndex + 1),
      ...existing,
      ...bullets,
      "",
      ...lines.slice(sectionEnd),
    ].join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  }
  const nextActionsIndex = lines.findIndex((line) => line.trim() === "## Next Actions");
  const insertAt = nextActionsIndex >= 0 ? nextActionsIndex : lines.length;
  return [
    ...lines.slice(0, insertAt),
    EXACT_IDENTIFIERS_HEADING,
    ...bullets,
    "",
    ...lines.slice(insertAt),
  ].join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function verifyArmOutput(params: {
  narrativeSummary: string;
  summary: string;
  recovery?: RecoveryMaterial;
  retryCount: number;
  decision: { wouldRetry: boolean };
}): {
  retryWithinLimit: boolean;
  userPathRedacted: boolean;
  completedOutcomePreserved: boolean;
  exactIdentifiersPreserved: boolean;
  missingExactIdentifiers: string[];
  missingHandoffSections: string[];
  handoffSectionsComplete: boolean;
  duplicateHandoffSections: string[];
  requestedChecksPassed: boolean;
  finalGatePassed: boolean;
  retryBudgetExhausted: boolean;
  passed: boolean;
} {
  const headingLines = params.narrativeSummary.split(/\r?\n/u);
  const missingHandoffSections = HANDOFF_SECTIONS.filter(
    (heading) => !headingLines.some((line) => line.trim() === heading),
  );
  const duplicateHandoffSections = HANDOFF_SECTIONS.filter(
    (heading) => headingLines.filter((line) => line.trim() === heading).length > 1,
  );
  const handoffSectionsComplete = missingHandoffSections.length === 0 && duplicateHandoffSections.length === 0;
  const completedOutcome = hasCompletedOutcome(params.recovery);
  const retryWithinLimit = params.retryCount <= 1;
  const userPathRedacted = !hasUnredactedUserPath(params.summary);
  const completedOutcomePreserved = !completedOutcome || !hasActionablePending(params.narrativeSummary);
  const missingExactIdentifiers = missingRecoveryIdentifiers(params.narrativeSummary, params.recovery);
  const exactIdentifiersPreserved = missingExactIdentifiers.length === 0;
  const requestedChecksPassed = retryWithinLimit
    && userPathRedacted
    && completedOutcomePreserved
    && exactIdentifiersPreserved
    && handoffSectionsComplete;
  const finalGatePassed = !params.decision.wouldRetry;
  const retryBudgetExhausted = params.retryCount > 0 && !finalGatePassed;
  return {
    retryWithinLimit,
    userPathRedacted,
    completedOutcomePreserved,
    exactIdentifiersPreserved,
    missingExactIdentifiers,
    missingHandoffSections,
    handoffSectionsComplete,
    duplicateHandoffSections: [...duplicateHandoffSections],
    requestedChecksPassed,
    finalGatePassed,
    retryBudgetExhausted,
    passed: requestedChecksPassed && finalGatePassed,
  };
}

function runSelfTest(): void {
  const recovery = {
    ledgerText: "## Critical Recovery Ledger\n- [decision] Keep production in shadow.",
    directiveText: "## Continuation Directive (authoritative)\nDo not repeat completed work; preserve the validated outcome: fixed.",
    identifiers: [],
  };
  const instructions = buildRetryInstructions({
    stage: "would-retry",
    reasons: ["critical facts dropped"],
    recovery,
  });
  const summary = appendRecoveryMaterial("## Goal and Progress\nRetry repaired the narrative.", recovery);
  for (const expected of [recovery.ledgerText, recovery.directiveText]) {
    if (!instructions.includes(expected) || !summary.includes(expected)) {
      throw new Error(`self-test failed: missing ${expected.split("\n", 1)[0]}`);
    }
  }
  const redacted = redactProviderText("C:\\Users\\27933\\Desktop\\JForum\\README.md C:/Users/27933/Desktop/JForum/README.md sk-abcdefghijklmnop");
  if (redacted.includes("27933") || redacted.includes("sk-abcdefghijklmnop")) {
    throw new Error("self-test failed: provider input was not redacted");
  }
  const normalized = sanitizeProviderSummary(`I must follow the prompt.

## Goal and Progress — draft outline

## Goal and Progress
- The fix is complete.

## Attempts and Failures
None.

## Decisions
- Preserve the completed result.

## Open TODOs
None.

## Constraints/Rules
- Preserve [REDACTED_USER].

## Pending user asks
None.

## Current State
- Complete.

## Files Touched
- C:\\Users\\27933\\Desktop\\JForum\\README.md

## Tests
- grep passed.

## Exact identifiers
- C:\\Users\\27933\\Desktop\\JForum\\README.md

## Next Actions
- Do not repeat completed work.

## Critical Recovery Ledger
- authoritative`);
  if (
    normalized.includes("I must")
    || normalized.includes("draft outline")
    || normalized.includes("27933")
    || HANDOFF_SECTIONS.some(
      (heading) => normalized.split(/\r?\n/u).filter((line) => line === heading).length !== 1,
    )
  ) {
    throw new Error("self-test failed: provider summary was not normalized");
  }
  const aliasNormalized = sanitizeProviderSummary(`## Goal and Progress
- Alias headings must retain their evidence.

## Key Decisions and Constraints
- Preserve the verified decision and constraint text.

## Files Touched / Relevant Files
- src/auth/middleware.ts

## Tests and Results
- grep passed.`);
  if (
    !aliasNormalized.includes(`${DECISIONS_HEADING}\n- Preserve the verified decision and constraint text.`)
    || !aliasNormalized.includes(`${CONSTRAINTS_HEADING}\n- Preserve the verified decision and constraint text.`)
    || !aliasNormalized.includes("## Files Touched\n- src/auth/middleware.ts")
    || !aliasNormalized.includes("## Tests\n- grep passed.")
  ) {
    throw new Error("self-test failed: provider section aliases dropped evidence");
  }
  const validationMessages = redactEvidenceView([{
    role: "user",
    content: "Fix C:\\Users\\27933\\Desktop\\JForum\\README.md.",
  }]);
  const validation = buildValidatedCompactionOutput({
    source: "provider",
    summary: normalized,
    messages: validationMessages as any,
    readFiles: [],
    modifiedFiles: [],
    identifiers: recovery.identifiers,
    latestAsk: null,
    identifierPolicy: "custom",
    promotionStage: "would-retry",
  });
  const verification = verifyArmOutput({
    narrativeSummary: normalized,
    summary: appendRecoveryMaterial(normalized, recovery),
    recovery,
    retryCount: 1,
    decision: withRecoveryConflicts(validation.decision, normalized, recovery),
  });
  if (!verification.passed || verification.retryBudgetExhausted) {
    throw new Error(`self-test failed: clean redacted handoff did not pass: ${validation.decision.reasons.join(", ")}`);
  }
  const repairedMissing = repairHandoffStructure(
    sanitizeProviderSummary(`## Goal and Progress
- R27 objective retained.

## Attempts and Failures
- Prior shell failure.`),
    {
      ...recovery,
      directiveText: "## Continuation Directive (authoritative)\nThe only valid next action is candidate action id \"R27-continue\" (decision): rerun the fixed-string scan.",
    },
  );
  const repairedHeadingCount = HANDOFF_SECTIONS.filter(
    (heading) => repairedMissing.split(/\r?\n/u).filter((line) => line === heading).length === 1,
  ).length;
  if (
    repairedHeadingCount !== HANDOFF_SECTIONS.length
    || !repairedMissing.includes('candidate action id "R27-continue"')
  ) {
    throw new Error("self-test failed: missing handoff sections were not deterministically repaired");
  }
  const falsePendingNarrative = sanitizeProviderSummary(normalized.replace(
      "## Open TODOs\nNone.",
      "## Open TODOs\nNo pending items; the completed report is still pending.",
  ));
  const falsePendingDecision = withCompletionConflict(
    { wouldRetry: false, reasons: [] },
    falsePendingNarrative,
    recovery,
  );
  const exhausted = verifyArmOutput({
    narrativeSummary: falsePendingNarrative,
    summary: normalized,
    recovery,
    retryCount: 1,
    decision: falsePendingDecision,
  });
  if (
    !falsePendingNarrative.includes("the completed report is still pending.")
    || exhausted.passed
    || exhausted.completedOutcomePreserved
    || !exhausted.retryBudgetExhausted
    || falsePendingDecision.reasons[0] !== "stale_completed_pending"
  ) {
    throw new Error("self-test failed: exhausted retry or false pending claim was reported as passed");
  }
  const reconciled = reconcileCompletedNarrative(`## Goal and Progress
- The first cycle is complete.
- The second cycle is in progress even though the latest outcome completed it.

## Attempts and Failures
- The second-cycle deletion was not yet performed or evidenced.
- A historical provider attempt failed with HTTP 502.

## Decisions
- Preserve the completed result.

## Open TODOs
- Deliver the completed report.

## Constraints/Rules
- Preserve evidence.

## Pending user asks
- The completed report remains to be delivered.

## Current State
- The operation is complete.
- Its final report is still pending.

## Files Touched
None.

## Tests
- Passed.

## Exact identifiers
- R16-continue.

## Next Actions
- Repeat the completed operation.`, recovery);
  const reconciledVerification = verifyArmOutput({
    narrativeSummary: reconciled,
    summary: appendRecoveryMaterial(reconciled, recovery),
    recovery,
    retryCount: 1,
    decision: withRecoveryConflicts({ wouldRetry: false, reasons: [] }, reconciled, recovery),
  });
  if (
    reconciled.includes("in progress")
    || reconciled.includes("still pending")
    || reconciled.includes("not yet performed")
    || !reconciled.includes("historical provider attempt failed with HTTP 502")
    || !reconciled.includes("## Open TODOs\nNone.")
    || !reconciled.includes("## Pending user asks\nNone.")
    || !reconciled.includes("## Next Actions\nNone.")
    || !reconciledVerification.passed
  ) {
    throw new Error("self-test failed: completed outcome was not reconciled deterministically");
  }
  const realPendingRecovery = {
    ...recovery,
    directiveText: "## Continuation Directive (authoritative)\nContinue the evidence-backed unfinished task.",
  };
  const realPending = "## Open TODOs\n- Run the pending test.";
  if (reconcileCompletedNarrative(realPending, realPendingRecovery) !== realPending) {
    throw new Error("self-test failed: real pending work was modified without a completed outcome");
  }
  const identifierRecovery = {
    ...recovery,
    identifiers: [
      "src/auth/middleware.ts",
      "C:\\Users\\[REDACTED_USER]\\workspace\\README.md",
      "R16-continue",
    ],
  };
  const missingIdentifierNarrative = normalized.replace("- Do not repeat completed work.", "- Continue the handoff.");
  const missingIdentifierDecision = withRecoveryConflicts(
    validation.decision,
    missingIdentifierNarrative,
    identifierRecovery,
  );
  if (!missingIdentifierDecision.reasons.includes("missing_exact_identifier:src/auth/middleware.ts")) {
    throw new Error("self-test failed: evidence-backed identifier omission did not request retry");
  }
  const reconciledIdentifiers = reconcileExactIdentifiers(missingIdentifierNarrative, identifierRecovery);
  const identifierVerification = verifyArmOutput({
    narrativeSummary: reconciledIdentifiers,
    summary: appendRecoveryMaterial(reconciledIdentifiers, identifierRecovery),
    recovery: identifierRecovery,
    retryCount: 1,
    decision: withRecoveryConflicts(validation.decision, reconciledIdentifiers, identifierRecovery),
  });
  if (
    !identifierVerification.exactIdentifiersPreserved
    || !identifierVerification.passed
    || !reconciledIdentifiers.includes("C:\\Users\\[REDACTED_USER]\\workspace\\README.md")
    || reconciledIdentifiers.includes("C:\\Users\\27933")
  ) {
    throw new Error("self-test failed: evidence-backed identifiers were not reconciled");
  }
  console.log("would-retry recovery injection self-test passed");
}

async function providerSummarize(params: {
  messages: any[];
  customInstructions?: string;
}): Promise<{ text: string; usage: { input: number; output: number } }> {
  const provider = providerConfig();
  if (!provider.apiKey) throw new Error("COMPACTION_API_KEY is not set");
  const transcript = providerTranscript(params.messages);
  const userPrompt = `<conversation>\n${transcript}\n</conversation>\n\n${PROVIDER_PROMPT}${
    params.customInstructions ? `\n\nAdditional focus: ${redactProviderText(params.customInstructions)}` : ""
  }`;
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${provider.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0,
          max_tokens: 8192,
          stream: false,
          messages: [
            { role: "system", content: "You are a software-task compaction provider." },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000 * attempt));
    }
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  if (!response.ok) {
    throw new Error(`compaction provider ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const data: any = await response.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty provider summary");
  return {
    text: sanitizeProviderSummary(text),
    usage: {
      input: data?.usage?.prompt_tokens ?? 0,
      output: data?.usage?.completion_tokens ?? 0,
    },
  };
}

function providerTranscript(messages: any[]): string {
  return providerEvidenceMessages(messages)
    .map((message) => `[${message.role}] ${message.content}`)
    .join("\n")
    .slice(-120_000);
}

function providerEvidenceMessages(messages: any[]): Array<{ role: string; content: string }> {
  return messages.slice(-80).map((message) => ({
    role: roleFor(message),
    content: redactProviderText(messageText(message)).slice(0, 6000),
  }));
}

async function runArm(params: {
  sampleId: string;
  preparation: CompactionPreparation;
  stage: "shadow" | "would-retry";
  recovery?: RecoveryMaterial;
}): Promise<any> {
  const messages = [
    ...params.preparation.messagesToSummarize,
    ...params.preparation.turnPrefixMessages,
  ];
  const validationMessages = providerEvidenceMessages(messages);
  const validationPreviousSummary = redactEvidenceView(params.preparation.previousSummary);
  const validationPreviousArtifact = redactEvidenceView(params.preparation.previousArtifact);
  const stage = normalizeCompactionPromotionStage(params.stage);
  const startedAt = Date.now();
  let retryCount = 0;
  let retryUsage = { input: 0, output: 0 };
  const first = await providerSummarize({ messages });
  const firstUsage = first.usage;
  let narrativeSummary = first.text;
  const validateNarrative = (summary: string) => buildValidatedCompactionOutput({
    source: "provider",
    summary,
    messages: validationMessages as any,
    previousSummary: validationPreviousSummary,
    previousArtifact: validationPreviousArtifact,
    readFiles: [],
    modifiedFiles: [],
    identifiers: params.recovery?.identifiers ?? [],
    latestAsk: null,
    identifierPolicy: params.recovery ? "custom" : "off",
    promotionStage: stage,
  });
  let finalized = validateNarrative(narrativeSummary);
  if (!finalized || !finalized.decision) {
    throw new Error(`${params.sampleId}: finalized decision missing messages=${messages.length}`);
  }
  while (retryCount < 1) {
    const checkedDecision = withRecoveryConflicts(finalized.decision, narrativeSummary, params.recovery);
    const enforcement = resolveCompactionPromotionEnforcement({
      stage,
      decision: checkedDecision,
      repairAttempts: retryCount,
      maxRetries: 1,
      isBoundary: false,
    });
    if (enforcement.action !== "retry") break;
    const retried = await providerSummarize({
      messages,
      customInstructions: buildRetryInstructions({
        stage: params.stage,
        reasons: checkedDecision.reasons,
        recovery: params.recovery,
      }),
    });
    retryUsage = retried.usage;
    retryCount += 1;
    narrativeSummary = retried.text;
    finalized = validateNarrative(narrativeSummary);
  }
  narrativeSummary = reconcileCompletedNarrative(narrativeSummary, params.recovery);
  narrativeSummary = reconcileExactIdentifiers(narrativeSummary, params.recovery);
  if (retryCount > 0 && params.stage === "would-retry") {
    narrativeSummary = repairHandoffStructure(narrativeSummary, params.recovery);
  }
  finalized = validateNarrative(narrativeSummary);
  const checkedDecision = withRecoveryConflicts(finalized.decision, narrativeSummary, params.recovery);
  const appendedRecovery = retryCount > 0 ? params.recovery : undefined;
  const summary = appendRecoveryMaterial(narrativeSummary, appendedRecovery);
  const verification = verifyArmOutput({
    narrativeSummary,
    summary,
    recovery: params.recovery,
    retryCount,
    decision: checkedDecision,
  });
  return {
    sampleId: params.sampleId,
    stage,
    summary,
    narrativeSummary,
    rawSummary: first.text,
    retryCount,
    recoveryInjected: retryCount > 0 && Boolean(params.recovery),
    decision: checkedDecision,
    verification,
    latencyMs: Date.now() - startedAt,
    usage: {
      first: firstUsage,
      retry: retryUsage,
      inputTotal: firstUsage.input + retryUsage.input,
      outputTotal: firstUsage.output + retryUsage.output,
    },
  };
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }
  const provider = providerConfig();
  if (!provider.apiKey) throw new Error("COMPACTION_API_KEY is not set");
  const manifestPath = resolve(argValue("--manifest") ?? "reports/context-compression/production-manifest-30.json");
  const metaPath = resolve(argValue("--meta") ?? "reports/context-compression/production-summaries-30-generated.meta.json");
  const outRoot = resolve(argValue("--out") ?? "artifacts/p6-would-retry-canary");
  mkdirSync(outRoot, { recursive: true });
  const manifest = readJson(manifestPath);
  const meta = readJson(metaPath);
  const only = (argValue("--only") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const armFilter = argValue("--arm");
  const manifestValidation = validateCanaryManifest(manifest, manifestPath, meta, only);
  if (!manifestValidation.valid) {
    throw new Error(`manifest validation failed: ${manifestValidation.errors.join(", ")}`);
  }
  const fingerprint = sourceFingerprint();
  const recovery = await import("./context-compression-recovery-ledger.mjs");
  const metaBySample = new Map<string, any>((meta.entries ?? []).map((entry: any) => [entry.sampleId, entry]));
  const rows: any[] = [];
  for (const sample of manifest.samples ?? []) {
    const sampleId = String(sample.id);
    if (only.length && !only.includes(sampleId)) {
      continue;
    }
    const file = metaBySample.get(sampleId)?.file;
    if (!file) throw new Error(`${sampleId}: missing meta file`);
    const raw: any[] = sdk
      .loadEntriesFromFile(file)
      .filter((entry: any) => entry.type !== "session" && entry.type !== "compaction");
    const entries: any[] = JSON.parse(JSON.stringify(raw));
    const settings: any = {
      ...DEFAULT_COMPACTION_SETTINGS,
      contextWindow: 32000,
      keepRecentTokens: 120,
    };
    const prepared: any = prepareCompaction(entries as any, settings);
    if (!prepared.ok || !prepared.value) throw new Error(`${sampleId}: prepare failed`);
    const ledger = recovery.buildRecoveryLedger(file, sampleId, {
      windowSize: Number(sample.cohort?.turn ?? 200),
      ordinalIndex: Number(/^R(\d+)$/u.exec(sampleId)?.[1] ?? 1) - 1,
    });
    const directive = recovery.buildContinuationDirective(ledger);
    const recoveryMaterial = redactEvidenceView({
      ledgerText: recovery.ledgerText(ledger),
      directiveText: directive.text,
      identifiers: buildEvidenceBackedIdentifiers(ledger, directive),
    });
    const shadow = armFilter && armFilter !== "shadow"
      ? undefined
      : await runArm({
          sampleId,
          preparation: prepared.value as CompactionPreparation,
          stage: "shadow",
        });
    const wouldRetry = armFilter && armFilter !== "would-retry"
      ? undefined
      : await runArm({
          sampleId,
          preparation: prepared.value as CompactionPreparation,
          stage: "would-retry",
          recovery: recoveryMaterial,
        });
    rows.push({ sampleId, shadow, wouldRetry });
    console.log(`${sampleId}: shadow_retries=${shadow?.retryCount ?? "skipped"} would_retries=${wouldRetry?.retryCount ?? "skipped"}`);
  }
  const presentShadow = rows.filter((row) => row.shadow);
  const presentWouldRetry = rows.filter((row) => row.wouldRetry);
  if (presentShadow.length) {
    writeFileSync(
      `${outRoot}/shadow-summaries.jsonl`,
      `${presentShadow.map((row) => JSON.stringify({ sampleId: row.sampleId, compressedSummary: row.shadow.summary })).join("\n")}\n`,
      "utf8",
    );
  }
  if (presentWouldRetry.length) {
    writeFileSync(
      `${outRoot}/would-retry-summaries.jsonl`,
      `${presentWouldRetry.map((row) => JSON.stringify({ sampleId: row.sampleId, compressedSummary: row.wouldRetry.summary })).join("\n")}\n`,
      "utf8",
    );
  }

  writeFileSync(
    `${outRoot}/canary-metrics.json`,
    `${JSON.stringify(
      {
        schema: "p6-would-retry-canary/v3",
        generatedAt: new Date().toISOString(),
        sampleCount: rows.length,
        manifest: manifestPath,
        manifestValidation,
        sourceFingerprint: fingerprint,
        provider: {
          baseUrl: provider.baseUrl,
          model: provider.model,
        },
        retryStrategy: "deterministic-recovery-ledger+authoritative-continuation-directive",
        arms: {
          shadow: presentShadow.length
            ? {
                retryTotal: presentShadow.reduce((sum, row) => sum + row.shadow.retryCount, 0),
                latencyMsMean: presentShadow.reduce((sum, row) => sum + row.shadow.latencyMs, 0) / presentShadow.length,
                inputTokensTotal: presentShadow.reduce((sum, row) => sum + row.shadow.usage.inputTotal, 0),
                outputTokensTotal: presentShadow.reduce((sum, row) => sum + row.shadow.usage.outputTotal, 0),
              }
            : undefined,
          wouldRetry: presentWouldRetry.length
            ? {
                retryTotal: presentWouldRetry.reduce((sum, row) => sum + row.wouldRetry.retryCount, 0),
                latencyMsMean: presentWouldRetry.reduce((sum, row) => sum + row.wouldRetry.latencyMs, 0) / presentWouldRetry.length,
                inputTokensTotal: presentWouldRetry.reduce((sum, row) => sum + row.wouldRetry.usage.inputTotal, 0),
                outputTokensTotal: presentWouldRetry.reduce((sum, row) => sum + row.wouldRetry.usage.outputTotal, 0),
                recoveryInjectedSamples: presentWouldRetry.filter((row) => row.wouldRetry.recoveryInjected).length,
                requestedChecksPassedSamples: presentWouldRetry.filter(
                  (row) => row.wouldRetry.verification.requestedChecksPassed,
                ).length,
                finalGatePassedSamples: presentWouldRetry.filter(
                  (row) => row.wouldRetry.verification.finalGatePassed,
                ).length,
                exactIdentifiersPreservedSamples: presentWouldRetry.filter(
                  (row) => row.wouldRetry.verification.exactIdentifiersPreserved,
                ).length,
                handoffSectionsCompleteSamples: presentWouldRetry.filter(
                  (row) => row.wouldRetry.verification.handoffSectionsComplete,
                ).length,
                retryBudgetExhaustedSamples: presentWouldRetry.filter(
                  (row) => row.wouldRetry.verification.retryBudgetExhausted,
                ).length,
              }
            : undefined,
        },
        rows,
      },
      null,
      2,
    )}
`,
    "utf8",
  );
  console.log(`canary complete out=${outRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
