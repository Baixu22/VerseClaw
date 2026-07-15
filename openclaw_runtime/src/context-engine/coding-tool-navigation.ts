/**
 * C1-3: coding navigation routing hint for CVK systemPromptAddition / tool_registry.
 * Chinese retrieval normalization + RRF already exist; this is only the routing layer.
 */
export const CODING_TOOL_ROUTING_PROMPT =
  "[Coding nav] Prefer context_impact for callers/blast-radius; context_understand for where-a-feature-lives packs; context_verify for diff/test risk; context_reuse before writing helpers. Use native grep/read for exact text or when Fact tools miss. Expand full tool schemas via context_read('tool_registry') when needed.";

/** Stable one-line summary entries for context_* tools (C1-1 on_demand). */
export const CONTEXT_TOOL_SUMMARY_BY_NAME: Record<string, string> = {
  context_read: "Read full content of a context block on demand",
  context_search: "Search context blocks by entity or free-text query",
  context_write: "Append/replace/clear agent notes context block",
  context_understand: "Build a ContextPack for a coding goal or question",
  context_impact: "Analyze callers/callees and blast radius for a symbol/file",
  context_reuse: "Find existing helpers before writing new code",
  context_verify: "Review a diff for related tests and blast radius",
};

export function isContextAgentToolName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONTEXT_TOOL_SUMMARY_BY_NAME, name);
}

export function contextToolOneLineSummary(name: string, fallback = ""): string {
  const known = CONTEXT_TOOL_SUMMARY_BY_NAME[name];
  if (known) return known;
  const fb = fallback.trim();
  return fb || name;
}

/** Character length of the routing prompt (W0-4 counter input). */
export function codingToolRoutingPromptChars(): number {
  return CODING_TOOL_ROUTING_PROMPT.length;
}
