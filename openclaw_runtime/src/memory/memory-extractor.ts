import type { MemoryEvidenceRef, MemoryProposalDraft } from "./types.js";

export type MemoryExtractionInput = {
  text: string;
  roleName?: string;
  scopeKey?: string | null;
  source?: "manual" | "trace_summary" | "session_summary" | "orchestration_handoff" | "memory_search";
  evidenceRefs?: MemoryEvidenceRef[];
};

const REMEMBER_PATTERNS = [
  /\bremember\b/i,
  /\bkeep in mind\b/i,
  /\bnext time\b/i,
  /记住/,
  /以后/,
  /下次/,
  /这个角色应该/,
];

export function extractMemoryProposalDrafts(input: MemoryExtractionInput): MemoryProposalDraft[] {
  const text = input.text.trim();
  if (!text) return [];
  const explicitRemember = REMEMBER_PATTERNS.some((pattern) => pattern.test(text));
  const source = input.source ?? (explicitRemember ? "manual" : undefined);
  if (!source) return [];
  const roleTags = input.roleName ? [input.roleName] : [];
  const evidenceRefs = [...(input.evidenceRefs ?? [])];
  if (source === "memory_search") {
    evidenceRefs.push({ type: "memory_search", ref: input.scopeKey ?? "memory-search" });
  }
  const draftSource = explicitRemember ? "explicit_remember" : source;
  return [{
    draftSource,
    type: source === "orchestration_handoff" ? "procedural" : "role_experience",
    scope: source === "session_summary" ? "session" : source === "trace_summary" ? "project" : roleTags.length > 0 ? "role" : "project",
    scopeKey: input.scopeKey ?? null,
    roleTags,
    content: text.replace(/^(remember|keep in mind)[:\s-]*/i, "").trim(),
    evidenceRefs,
    confidence: explicitRemember ? 0.82 : 0.72,
    importance: explicitRemember ? 0.7 : 0.55,
    source: source === "manual" ? "user" : source === "session_summary" ? "session_summary" : source === "trace_summary" ? "trace" : "role",
  }];
}
