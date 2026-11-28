---
title: openclaw_runtime/src/runtime-core/memory-temporal-detector.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/runtime-core/memory-temporal-detector.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
// Temporal query detection for retrieval mode selection.
// Classifies questions into temporal modes and multi-hop/open-domain categories
// to drive the appropriate retrieval strategy.

const STRICT_PATTERNS: readonly RegExp[] = [
  /when did/i,
  /what date/i,
  /on what day/i,
  /in \d{4}/i,
  /what .* before/i,
  /what .* after/i,
  /at the time of/i,
  /what year/i,
  /how old/i,
  /since when/i,
];

const FILTER_PATTERNS: readonly RegExp[] = [
  /\bcurrently\b/i,
  /\bnow\b/i,
  /\bstill\b/i,
  /anymore/i,
  /recently/i,
  /latest/i,
  /\bthese days\b/i,
  /nowadays/i,
];

const MULTI_HOP_PATTERNS: readonly RegExp[] = [
  /how long/i,
  /how many .* since/i,
  /what .* before .* after/i,
  /compare/i,
  /relationship between/i,
  /both .* and/i,
  /difference between/i,
  /what does .* do for/i,
  /what is .* 's/i,
  /who .* and/i,
];

const OPEN_DOMAIN_PATTERNS: readonly RegExp[] = [
  /what can you tell me about/i,
  /tell me about/i,
  /what do you know about/i,
  /describe/i,
  /overview/i,
  /summarize/i,
];

export type TemporalMode = "filter" | "boost" | "strict";

export function detectQueryTemporalMode(question: string): TemporalMode {
  if (STRICT_PATTERNS.some((p) => p.test(question))) return "strict";
  if (FILTER_PATTERNS.some((p) => p.test(question))) return "filter";
  return "boost";
}

export function isMultiHopQuestion(question: string): boolean {
  return MULTI_HOP_PATTERNS.some((p) => p.test(question));
}

export function isOpenDomainQuestion(question: string): boolean {
  return OPEN_DOMAIN_PATTERNS.some((p) => p.test(question));
}

~~~
