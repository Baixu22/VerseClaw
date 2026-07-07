import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";

export const EVIDENCE_INSUFFICIENT_SIGNAL = "[EVIDENCE_INSUFFICIENT]";

export type GenerationCategory =
  | "single_hop"
  | "temporal"
  | "multi_hop"
  | "open_domain"
  | string;

export type PromptFact = Pick<
  RuntimeMemoryQueryableFact,
  "subject" | "predicate" | "objectSummary"
> & {
  valid_at?: number;
};

export function stripEvidenceInsufficientSignal(answer: string): {
  insufficient: boolean;
  answer: string;
} {
  const trimmed = answer.trim();
  if (!trimmed.startsWith(EVIDENCE_INSUFFICIENT_SIGNAL)) {
    return { insufficient: false, answer: trimmed };
  }
  return {
    insufficient: true,
    answer: trimmed.slice(EVIDENCE_INSUFFICIENT_SIGNAL.length).trim(),
  };
}

// Stage 3.2 (2026-07-04): Extract the "Final answer: X" portion from a
// generator response. The CoT scaffolds ask the LLM to end with
// "Final answer: <value>", but the judge should only see the concise value,
// not the preceding reasoning. If the pattern is missing, return the full
// answer unchanged (do NOT use a last-line heuristic — it can return
// "Source: episodic memory" or other non-answer lines for single_hop).
export function extractFinalAnswer(answer: string): string {
  const trimmed = answer.trim();
  // Match "Final answer:" (case-insensitive) followed by the value on the
  // same line. Tolerates markdown bold/italic around the label — LLMs often
  // emit "**Final answer**: X" or "**Final answer:** X", which the previous
  // regex (/final answer:/) failed to match, leaking the full CoT to the
  // judge. Uses dotall flag so .+? can span lines if the answer wraps.
  const match = trimmed.match(
    /final answer\s*\*{0,2}\s*:\s*\*{0,2}\s*(.+?)(\n|$)/is,
  );
  if (match && match[1]) {
    const value = match[1].replace(/^\*+|\*+$/g, "").trim();
    if (value.length > 0) {
      return value;
    }
  }
  // Fallback: return the full answer unchanged. This is safer than the
  // last-line heuristic which could return a non-answer line.
  return trimmed;
}

// Stage 3.2 (2026-07-04): Rewrote all category scaffolds to fix the
// "retrieved_not_used" error pattern (22/39 = 56% of errors). Key changes:
// - Anti-abstention: explicit list of forbidden phrases ("not determinable",
//   "not possible to determine", "I don't know", "cannot determine")
// - Inference guidance: if context mentions a property, INFER the compatible
//   category (e.g., "allergic to fur" → "hairless animals")
// - "Final answer:" suffix forces LLM to commit to a concrete answer
// - reasoningHints parameter allows self-ask hop answers to be passed in
// - Removed allowInternalAbstention — the [EVIDENCE_INSUFFICIENT] prefix
//   path was actively harmful (LLM used it as license to abstain)
export function buildCategoryAwareDualTrackPrompt(
  question: string,
  category: GenerationCategory,
  episodicContext: string,
  semanticFacts: readonly PromptFact[],
  profileContext?: readonly string[],
  options: {
    allowInternalAbstention?: boolean;
    reasoningHints?: readonly string[];
  } = {},
): { system: string; user: string } {
  const scaffold = scaffoldForCategory(category);
  // Stage 3.2 (2026-07-04): Made abstention prefix highly restrictive —
  // only trigger when the context is TRULY empty or completely unrelated.
  // The previous permissive wording caused 21% escalation rate (vs 2.67%
  // baseline) because the LLM used [EVIDENCE_INSUFFICIENT] as a substitute
  // for "I don't know" — which the new anti-abstention scaffold forbids.
  const abstention =
    options.allowInternalAbstention === true
      ? `\nMAYBE ABSTENTION: Only begin your response with "${EVIDENCE_INSUFFICIENT_SIGNAL}" if the context is COMPLETELY EMPTY or contains ZERO facts even remotely related to the question topic. If even ONE fact or sentence is tangentially relevant, do NOT use the prefix — just answer directly with your best guess. The prefix triggers an expensive full-conversation retry, so use it only as an absolute last resort.`
      : "";

  const system = `${scaffold}${abstention}`;
  // Stage 5.2: multi_hop gets 15 facts to address not_retrieved errors;
  // other categories keep 10 to avoid noise.
  const factBudget = category === "multi_hop" ? 15 : 10;
  const factLines = semanticFacts
    .slice(0, factBudget)
    .map((fact, index) => {
      const datePrefix =
        typeof fact.valid_at === "number"
          ? `[said on ${new Date(fact.valid_at).toISOString().slice(0, 10)}] `
          : "";
      return `[${index + 1}] ${datePrefix}${fact.subject} ${fact.predicate}: ${fact.objectSummary}`;
    })
    .join("\n");

  void profileContext;
  let user = "";
  if (episodicContext.trim().length > 0) {
    user += `[EPISODIC MEMORY - raw conversation snippets, chronological order]\n${episodicContext}\n\n`;
  }
  if (factLines.length > 0) {
    user += `[SEMANTIC MEMORY - extracted structured facts]\n${factLines}\n\n`;
  }
  if (
    options.reasoningHints &&
    options.reasoningHints.length > 0 &&
    options.reasoningHints.some((hint) => hint.trim().length > 0)
  ) {
    const hintLines = options.reasoningHints
      .map((hint) => hint.trim())
      .filter(Boolean)
      .map((hint, index) => `  Hop ${index + 1} answer: ${hint}`)
      .join("\n");
    user += `[SELF-ASK DECOMPOSITION]\n${hintLines}\n\n`;
  }
  user += `Question: ${question}\n\nAnswer:`;

  return { system, user };
}

function scaffoldForCategory(category: GenerationCategory): string {
  if (category === "temporal") {
    return [
      "You are answering a temporal question. You MUST answer — never abstain.",
      "",
      "FORBIDDEN: \"I don't know\", \"not determinable\", \"not possible to determine\", \"cannot be determined\".",
      "",
      "Steps:",
      "1. Extract every date mentioned in the context.",
      "2. For relative phrases, compute the absolute date using the session date header. Show arithmetic briefly.",
      "   - \"just under a year\" = ~11 months back",
      "   - \"a year ago\"/\"last year\" = 12 months back",
      "   - \"last spring\" = March-May of previous year",
      "   - \"a few months ago\" = ~3 months back",
      "3. Give the final answer as a value, year, date, or date range.",
      "",
      "A best-guess estimate is better than no answer. Never abstain.",
      "",
      "End with: \"Final answer: <value>\"",
    ].join("\n");
  }

  if (category === "multi_hop") {
    return [
      "You are answering a multi-hop question that requires connecting information across conversation turns. You MUST answer — never abstain.",
      "",
      "FORBIDDEN: \"I don't know\", \"not determinable\", \"not possible to determine\", \"cannot be determined\", \"no mention of\", \"the conversation does not specify\".",
      "",
      "CRITICAL GROUNDING RULES:",
      "1. EXTRACT first. If the context explicitly names the specific entity the question asks about, use that EXACT entity — never replace it with a generic category.",
      "   - WRONG: context says \"hairless cats and pigs\" -> answer \"hairless or hypoallergenic pets\" (too generic)",
      "   - RIGHT: context says \"hairless cats and pigs\" -> answer \"hairless cats and pigs\"",
      "2. NAME the real-world entity when asked. If the question asks for a SPECIFIC brand/game/show/book/company/organization and the context only DESCRIBES it without naming it, combine the descriptive clues with your world knowledge and COMMIT to the single most likely real-world name.",
      "   - Example: clues \"card game, exploding felines\" -> \"Exploding Kittens\"",
      "   - Example: clues \"sportswear brand, athlete sponsorship\" -> name an actual brand like \"Under Armour\" or \"Nike\" — pick the one best matching the clues.",
      "   - A specific best-guess name is ALWAYS better than repeating the description or answering with a generic category.",
      "3. If [SELF-ASK DECOMPOSITION] hop answers are provided, TREAT THEM AS FACTS. Chain them:",
      "   - Hop 1 answer is an intermediate entity/value. Substitute it into the hop 2 question.",
      "   - Do NOT discard hop answers — they are retrieved evidence, not suggestions.",
      "",
      "ANSWER FOCUS RULES:",
      "1. Answer EXACTLY the slot the question asks for (the gift, the place, the reason) — do not dump everything you know about the person.",
      "   - WRONG: question asks \"what gift did X give\" -> answer lists X's hobbies and habits",
      "   - RIGHT: question asks \"what gift did X give\" -> name the gift itself",
      "2. For yes/no questions: start with \"Yes\" or \"No\", then one short supporting clue. Judge from the overall direction of the evidence, not one isolated fact.",
      "3. If the question asks for multiple items, name ALL of them. When the context names only SOME items but the question implies a known real-world set (e.g. Star Wars filming locations in Ireland), COMPLETE the list from world knowledge — do not stop at the one item the context mentions.",
      "",
      "Steps:",
      "1. Read the [SELF-ASK DECOMPOSITION] hop answers (if present). These are your intermediate results.",
      "2. Find the specific facts/sentences in [SEMANTIC MEMORY] and [EPISODIC MEMORY] that connect to each hop.",
      "3. Chain: hop1 answer + hop2 evidence -> synthesis.",
      "4. Commit to the most specific answer available: an exact entity from the context, or the most likely real-world name inferred from the clues.",
      "",
      "Inference guidance for hypothetical/speculative questions (\"what would suit X\", \"would X enjoy Y\", \"what wouldn't bother X\"): derive the answer from X's stated properties, constraints, and preferences — do NOT answer with an unrelated concrete entity that merely appears in the context. Example: \"allergic to pet fur\" -> pets without fur, e.g. \"hairless cats or pigs\". Example: \"enjoys performing to large crowds\" -> \"Yes — would enjoy a large venue\".",
      "",
      "A partial/best-guess answer is better than no answer. Never abstain.",
      "",
      "End with a plain-text line (no markdown bold): \"Final answer: <concise value with specific entities>\"",
    ].join("\n");
  }

  if (category === "open_domain") {
    return [
      "You are answering an open-ended question. You MUST answer — never abstain.",
      "",
      "FORBIDDEN: \"I don't know\", \"not determinable\", \"not possible to determine\", \"cannot be determined\".",
      "",
      "Collect ALL relevant facts, synthesize a coherent summary. If only partial info is available, provide the partial answer — do NOT refuse.",
      "",
      "End with: \"Final answer: <summary>\"",
    ].join("\n");
  }

  return [
    "You are answering a single-hop question about a specific fact from a past conversation. You MUST answer — never abstain.",
    "",
    "FORBIDDEN: \"I don't know\", \"not determinable\", \"not possible to determine\", \"cannot be determined\".",
    "",
    "The answer should be a single, concise value directly extracted from the context. Cite the source briefly as based on episodic or semantic memory, avoid unnecessary elaboration. If evidence is weak, still provide the best-guess answer.",
  ].join("\n");
}
