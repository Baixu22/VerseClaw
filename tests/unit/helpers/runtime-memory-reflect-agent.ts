// Stage 4 (2026-07-04): Reflect Agent (conservative redesign).
//
// After the initial generator produces an answer, the reflect agent:
//   0. PRE-CHECK: only runs critique on SUSPICIOUS answers (abstention-like,
//      too short, or category-suspicious). This keeps trigger rate ~15-20%
//      instead of the 53% that caused the -18pp regression in v1.
//   1. Critiques the answer against the retrieved context (cheap, 1 LLM call).
//   2. (REMOVED in v2) Never directly trusts critique.betterAnswer — this was
//      the root cause of the v1 regression. The critique LLM's "betterAnswer"
//      is often a wrong guess that overwrites a correct initial answer.
//   3. If critique says "missing info" and a retrieval fn is available,
//      reforms the query, re-retrieves, and regenerates (agentic retrieval).
//   4. Otherwise regenerates with a stricter prompt that uses betterAnswer
//      only as a HINT, never as the final answer.
//   5. Confidence check: if the regenerated answer looks worse (shorter than
//      3 chars, or newly abstention-like when the original wasn't), keep the
//      original answer.
//
// This addresses the two dominant error classes from Stage 3:
//   - retrieved_not_used (37%): critique + regeneration with hint
//   - not_retrieved (54%): re-retrieval with reformed query
//
// Disposition traits (Hindsight §3.2-3.3) control critique strictness:
//   skepticism: how strictly to question evidence support
//   literalism: how literally to interpret context
//   empathy: how generously to interpret user intent

export type ReflectDisposition = {
  skepticism: number; // 0-3
  literalism: number; // 0-3
  empathy: number; // 0-3
};

export type ReflectCritique = {
  supported: boolean;
  addresses: boolean;
  issue: "none" | "missing" | "wrong" | "unsupported";
  missingConcept?: string;
  betterAnswer?: string;
};

export type ReflectResult = {
  used: boolean;
  iterations: number;
  finalAnswer: string;
  critique: ReflectCritique | null;
  reRetrieved: boolean;
  reformedQuery?: string;
  // v2: pre-check skipped reflect entirely (no critique call).
  skipped?: boolean;
  // v2: confidence check reverted to initial answer after regeneration.
  reverted?: boolean;
};

export type ReflectLLMCall = (
  system: string,
  user: string,
  options?: { temperature?: number; maxTokens?: number },
) => Promise<{ content: string }>;

export type ReflectRetrieveFn = (
  query: string,
) => Promise<
  Array<{
    factId: string;
    subject: string;
    predicate: string;
    objectSummary: string;
    valid_at?: number;
  }>
>;

export type ReflectRegenerateFn = (expandedContext: string) => Promise<string>;

const DEFAULT_DISPOSITION: ReflectDisposition = {
  skepticism: 2,
  literalism: 2,
  empathy: 3,
};

// Detect abstention-like answers. The generator already strips the
// `[EVIDENCE_INSUFFICIENT]` prefix via stripEvidenceInsufficientSignal before
// reflect runs, so we focus on natural-language abstention phrases that slip
// through. This is conservative — only matches obvious hedging.
export function looksLikeAbstention(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  if (a.length === 0) return true;
  const ABSTENTION_PATTERNS = [
    "i don't know",
    "i do not know",
    "i'm not sure",
    "i am not sure",
    "not sure",
    "cannot determine",
    "can't determine",
    "not enough information",
    "insufficient information",
    "no information",
    "not mentioned",
    "not specified",
    "not determinable",
    "unclear",
    "no clear",
    "no relevant",
    "the context does not",
    "the provided context",
    "based on the context, i",
    "there is no",
  ];
  // Also catch answers that are JUST the abstention signal remnant.
  if (a === "[evidence_insufficient]") return true;
  for (const p of ABSTENTION_PATTERNS) {
    if (a.startsWith(p) || a === p) return true;
  }
  return false;
}

// Pre-check: should we spend an LLM critique call on this answer?
//
// v2.3 tuning (2026-07-04 Stage 5.5): with SILICONFLOW_API_KEY now available,
// re-retrieval can bring NEW facts. So we widen triggering to:
//   1. abstention-like answers (v2.2 baseline)
//   2. multi_hop questions (re-retrieval has highest ROI on multi_hop
//      because not_retrieved is the dominant error class there)
//   3. short answers (< 3 chars)
//
// v2.2 lesson: regeneration with critique prompt is harmful on multi_hop
// (-14.28pp). v2.3 mitigates this by ONLY doing re-retrieval when critique
// says "missing" — regeneration only happens if new facts are found AND
// the confidence check passes (looksWorseThan reverts harmful regen).
//
// The budget (30% of questions) caps the expensive re-retrieval path.
export function shouldReflect(
  question: string,
  answer: string,
  category: string,
): boolean {
  const a = answer.trim();
  // v2.2: abstention-like answers always trigger
  if (looksLikeAbstention(a)) return true;

  // v2.2: very short empty-ish answers
  if (a.length < 3) return true;

  // v2.3: multi_hop questions — re-retrieval can recover not_retrieved facts.
  // The retrieve fn must be available (caller passes undefined when no
  // embedding provider), so this is gated by the caller's setup.
  if (category === "multi_hop") return true;

  return false;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  "that",
  "this",
  "these",
  "those",
  "with",
  "from",
  "into",
  "onto",
  "upon",
  "about",
  "for",
  "in",
  "on",
  "at",
  "by",
  "to",
  "of",
  "your",
  "their",
  "there",
  "then",
  "than",
]);

// Category-aware disposition: multi_hop needs more skepticism (catch
// unsupported inferences), temporal needs more literalism (exact dates),
// single_hop needs balance, open_domain needs more empathy (synthesis).
export function dispositionForCategory(category: string): ReflectDisposition {
  if (category === "multi_hop") {
    return { skepticism: 3, literalism: 2, empathy: 2 };
  }
  if (category === "temporal") {
    return { skepticism: 2, literalism: 3, empathy: 2 };
  }
  if (category === "open_domain") {
    return { skepticism: 1, literalism: 1, empathy: 3 };
  }
  return DEFAULT_DISPOSITION;
}

export function buildCritiquePrompt(
  question: string,
  context: string,
  answer: string,
  disposition: ReflectDisposition = DEFAULT_DISPOSITION,
): { system: string; user: string } {
  const system = [
    "You are a strict evaluator for a memory-augmented QA system.",
    `Disposition: skepticism=${disposition.skepticism}/3, literalism=${disposition.literalism}/3, empathy=${disposition.empathy}/3.`,
    "",
    "Given a question, retrieved context, and a proposed answer, evaluate:",
    "1. SUPPORTED: Is the answer supported by facts/sentences in the context?",
    "2. ADDRESSES: Does the answer directly address what the question asks?",
    "",
    "Respond in EXACTLY this JSON format (no other text):",
    '{"supported": <true|false>, "addresses": <true|false>, "issue": "<none|missing|wrong|unsupported>", "missingConcept": "<concept or empty>", "betterAnswer": "<better answer or empty>"}',
    "",
    "Issue types:",
    "- none: answer is correct and complete",
    "- missing: context lacks needed info; missingConcept = what specific info is missing",
    "- wrong: answer is supported but factually incorrect; betterAnswer = corrected answer",
    "- unsupported: answer is not supported by context; betterAnswer = best guess FROM context",
    "",
    "Important: For 'wrong' and 'unsupported', always provide a betterAnswer (your best guess).",
    "For 'missing', provide the missingConcept (a short phrase that could be used as a search query).",
  ].join("\n");

  // Cap context to keep critique fast (~200 tokens output).
  const user = [
    `Question: ${question}`,
    "",
    "Context:",
    context.slice(0, 2500),
    "",
    `Proposed answer: ${answer}`,
    "",
    "Evaluate (JSON only):",
  ].join("\n");

  return { system, user };
}

export function parseCritiqueResponse(content: string): ReflectCritique | null {
  // Extract JSON object from response (LLM may wrap in markdown fences).
  const jsonMatch = content.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.supported !== "boolean" || typeof parsed.addresses !== "boolean") {
      return null;
    }
    const validIssues = ["none", "missing", "wrong", "unsupported"] as const;
    const issue = validIssues.includes(parsed.issue)
      ? (parsed.issue as (typeof validIssues)[number])
      : "none";
    return {
      supported: parsed.supported,
      addresses: parsed.addresses,
      issue,
      missingConcept:
        typeof parsed.missingConcept === "string" && parsed.missingConcept.trim().length > 0
          ? parsed.missingConcept.trim()
          : undefined,
      betterAnswer:
        typeof parsed.betterAnswer === "string" && parsed.betterAnswer.trim().length > 0
          ? parsed.betterAnswer.trim()
          : undefined,
    };
  } catch {
    return null;
  }
}

// Reform the query to focus on the missing concept.
// Strategy: use the missing concept as the primary search term, supplemented
// by key entities from the original question.
export function buildReformedQuery(
  question: string,
  missingConcept: string,
): string {
  const concept = missingConcept.trim();
  if (concept.length === 0) return question;
  // If the concept is already fully contained in the question, search for
  // the concept alone (it was apparently not retrieved well by the full question).
  if (question.toLowerCase().includes(concept.toLowerCase())) {
    return concept;
  }
  // Otherwise, combine concept with the first few words of the question
  // to provide entity context.
  const questionStart = question.split(/\s+/).slice(0, 4).join(" ");
  return `${concept} ${questionStart}`;
}

// Build the reflective regeneration prompt. This is used when critique says
// "unsupported" or when re-retrieval produced new facts.
export function buildReflectiveRegenerationPrompt(
  question: string,
  category: string,
  context: string,
  critique: ReflectCritique,
): { system: string; user: string } {
  const guidance: string[] = [];
  if (critique.issue === "missing") {
    guidance.push(
      `The previous answer was missing information about: ${critique.missingConcept ?? "unknown"}.`,
      "The context has been expanded with re-retrieved facts. Use ALL relevant evidence.",
    );
  } else if (critique.issue === "wrong") {
    guidance.push(
      "The previous answer was supported but factually incorrect.",
      critique.betterAnswer
        ? `A critique suggested a possible correction: "${critique.betterAnswer}". Treat this ONLY as a hint — verify it against the context before using it. If the hint conflicts with the context, ignore the hint and answer from the context.`
        : "No correction hint was provided.",
      "Provide a corrected answer grounded in the context.",
    );
  } else if (critique.issue === "unsupported") {
    guidance.push(
      "The previous answer was NOT supported by the context.",
      critique.betterAnswer
        ? `A critique suggested a possible answer: "${critique.betterAnswer}". Treat this ONLY as a hint — verify it against the context before using it. If the hint conflicts with the context, ignore the hint and answer from the context.`
        : "No hint was provided.",
      "Provide a new answer grounded STRICTLY in the context. Do not invent information.",
    );
  }

  const system = [
    `You are answering a ${category} question using retrieved memory context.`,
    "A previous answer was critiqued as insufficient. You MUST provide a better answer.",
    'Never say "I don\'t know" or "not determinable". End with: "Final answer: <value>"',
    "",
    ...guidance,
  ].join("\n");

  const user = [
    "Context:",
    context.slice(0, 3000),
    "",
    `Question: ${question}`,
    "",
    "Better answer (end with 'Final answer: <value>'):",
  ].join("\n");

  return { system, user };
}

// Budget for re-retrieval (the expensive part of reflect agent).
// Critique is always allowed (cheap). Re-retrieval is capped.
export class ReflectBudget {
  private reRetrieveUsed = 0;
  private reRetrieveCapped = 0;
  private regenerateUsed = 0;

  constructor(
    readonly totalQuestions: number,
    readonly maxReRetrieveRate = 0.3,
  ) {}

  tryReRetrieve(): boolean {
    if (this.reRetrieveUsed >= this.maxReRetrieve) {
      this.reRetrieveCapped += 1;
      return false;
    }
    this.reRetrieveUsed += 1;
    return true;
  }

  tryRegenerate(): boolean {
    this.regenerateUsed += 1;
    return true; // regeneration is cheap, always allow
  }

  get maxReRetrieve(): number {
    return Math.floor(this.totalQuestions * this.maxReRetrieveRate);
  }

  get stats() {
    return {
      reRetrieveUsed: this.reRetrieveUsed,
      reRetrieveCapped: this.reRetrieveCapped,
      regenerateUsed: this.regenerateUsed,
      maxReRetrieve: this.maxReRetrieve,
    };
  }
}

// Main entry point for the reflect agent (v2 — conservative redesign).
//
// v1 regression root cause: 53% trigger rate + directly trusting
// critique.betterAnswer overwrote correct initial answers with the critique
// LLM's wrong guesses (-18pp J Score). v2 fixes:
//   - Pre-check (shouldReflect) skips critique on confident-looking answers
//   - Never uses critique.betterAnswer directly — always regenerates
//   - Confidence check reverts to initial answer if regeneration looks worse
export async function runReflectAgent(args: {
  question: string;
  category: string;
  initialAnswer: string;
  context: string;
  callLLM: ReflectLLMCall;
  retrieve?: ReflectRetrieveFn;
  regenerateWithContext?: ReflectRegenerateFn;
  budget?: ReflectBudget;
  disposition?: ReflectDisposition;
  extractFinalAnswer: (answer: string) => string;
}): Promise<ReflectResult> {
  const {
    question,
    category,
    initialAnswer,
    context,
    callLLM,
    retrieve,
    regenerateWithContext,
    budget,
    disposition = dispositionForCategory(category),
    extractFinalAnswer,
  } = args;

  // Step 0: Pre-check — only critique SUSPICIOUS answers. This is the key
  // change from v1 (which critiqued every answer, causing 53% trigger rate).
  if (!shouldReflect(question, initialAnswer, category)) {
    return {
      used: false,
      iterations: 0,
      finalAnswer: initialAnswer,
      critique: null,
      reRetrieved: false,
      skipped: true,
    };
  }

  // Step 1: Critique the initial answer (cheap, 1 LLM call).
  const { system: critSystem, user: critUser } = buildCritiquePrompt(
    question,
    context,
    initialAnswer,
    disposition,
  );
  const critResponse = await callLLM(critSystem, critUser, {
    temperature: 0,
    maxTokens: 200,
  });
  const critique = parseCritiqueResponse(critResponse.content);

  // If critique failed to parse or says "none", keep initial answer.
  if (!critique || critique.issue === "none") {
    return {
      used: false,
      iterations: 0,
      finalAnswer: initialAnswer,
      critique,
      reRetrieved: false,
    };
  }

  // Step 2 (REMOVED in v2): Never directly use critique.betterAnswer.
  // The v1 code returned extractFinalAnswer(critique.betterAnswer) here for
  // "wrong"/"unsupported" issues, which caused the -18pp regression because
  // the critique LLM's guesses were often wrong. v2 always regenerates.

  // Step 3: If missing info and retrieval is available and budget allows,
  // reform query → re-retrieve → regenerate.
  if (
    critique.issue === "missing" &&
    critique.missingConcept &&
    retrieve &&
    regenerateWithContext &&
    (!budget || budget.tryReRetrieve())
  ) {
    const reformedQuery = buildReformedQuery(question, critique.missingConcept);
    try {
      const newFacts = await retrieve(reformedQuery);
      if (newFacts.length > 0) {
        const newFactsText = newFacts
          .slice(0, 5)
          .map(
            (f, i) =>
              `[${i + 1}] ${f.subject} ${f.predicate}: ${f.objectSummary}`,
          )
          .join("\n");
        const expandedContext = `${context}\n\n[REFLECT AGENT - re-retrieved facts for "${critique.missingConcept}"]\n${newFactsText}`;
        const regenerated = await regenerateWithContext(expandedContext);
        const regenAnswer = extractFinalAnswer(regenerated);
        // Confidence check: if regeneration produced a worse-looking answer
        // (empty, abstention-like when original wasn't, or very short),
        // revert to the initial answer.
        if (looksWorseThan(regenAnswer, initialAnswer)) {
          return {
            used: false,
            iterations: 1,
            finalAnswer: initialAnswer,
            critique,
            reRetrieved: true,
            reformedQuery,
            reverted: true,
          };
        }
        return {
          used: true,
          iterations: 1,
          finalAnswer: regenAnswer,
          critique,
          reRetrieved: true,
          reformedQuery,
        };
      }
    } catch {
      // Re-retrieval failed; fall through to regeneration.
    }
  }

  // Step 4: Regenerate with stricter reflective prompt. betterAnswer is now
  // only a HINT in the prompt (see buildReflectiveRegenerationPrompt), never
  // used directly as the final answer.
  if (regenerateWithContext) {
    budget?.tryRegenerate();
    const { system: regenSystem, user: regenUser } =
      buildReflectiveRegenerationPrompt(question, category, context, critique);
    const regenResponse = await callLLM(regenSystem, regenUser, {
      temperature: 0,
      maxTokens: 384,
    });
    const regenerated = regenResponse.content.trim();
    if (regenerated.length > 0) {
      const regenAnswer = extractFinalAnswer(regenerated);
      // Confidence check: revert if regeneration looks worse.
      if (looksWorseThan(regenAnswer, initialAnswer)) {
        return {
          used: false,
          iterations: 1,
          finalAnswer: initialAnswer,
          critique,
          reRetrieved: false,
          reverted: true,
        };
      }
      return {
        used: true,
        iterations: 1,
        finalAnswer: regenAnswer,
        critique,
        reRetrieved: false,
      };
    }
  }

  // Fallback: keep initial answer.
  return {
    used: false,
    iterations: 0,
    finalAnswer: initialAnswer,
    critique,
    reRetrieved: false,
  };
}

// Confidence check helper: does the regenerated answer look WORSE than the
// initial answer? We revert to the initial answer when:
//   - regenerated is empty/very short (< 3 chars) AND initial was longer
//   - regenerated is abstention-like BUT initial was NOT (don't let
//     regeneration turn a real answer into a hedge)
// We do NOT revert when both are abstention-like (no harm in trying) or when
// regenerated is abstention-like but initial was also abstention-like.
function looksWorseThan(regenAnswer: string, initialAnswer: string): boolean {
  const r = regenAnswer.trim();
  const i = initialAnswer.trim();
  // Empty or near-empty regeneration is always worse.
  if (r.length < 3 && i.length >= 3) return true;
  // Regeneration became abstention when initial was a real answer.
  const rAbstain = looksLikeAbstention(r);
  const iAbstain = looksLikeAbstention(i);
  if (rAbstain && !iAbstain) return true;
  return false;
}
