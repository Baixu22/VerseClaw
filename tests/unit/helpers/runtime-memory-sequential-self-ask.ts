export type SequentialDecomposition = {
  original: string;
  subQuestions: string[];
};

export type SequentialHit<TFact extends { factId: string }> = {
  fact: TFact;
  rrfScore: number;
};

export type HopAnswer<TFact extends { factId: string }, THit extends SequentialHit<TFact>> = {
  answer: string;
  evidence: THit[];
};

// Multi-hop alignment (2026-07-07): Rewritten toward Hindsight's entity-
// oriented query strategy ("NEVER just echo the user's question — identify
// the ENTITIES and CONCEPTS it involves and search for each separately").
// Key changes: (1) explicit entity-resolution guidance for the LoCoMo
// surface form (embedded descriptions like "the friend she met at yoga"),
// (2) bias toward decomposing — the old prompt let the LLM declare
// questions single-hop too eagerly, which returned used:false and skipped
// the self-ask arm entirely.
export const SEQUENTIAL_SELF_ASK_SYSTEM_PROMPT =
  "You are decomposing a multi-hop question into 2 sequential sub-questions for memory retrieval. The second sub-question may depend on the answer to the first.\n\n" +
  "How to decompose:\n" +
  "- NEVER just echo the original question. Identify the distinct ENTITIES, EVENTS, or FACTS it involves.\n" +
  "- If the question embeds a description of an entity (\"the friend she met at the support group\", \"the game he bought after the tournament\"), sub-question 1 resolves that entity, sub-question 2 asks the main question about it.\n" +
  "- If the question connects two facts (cause/effect, comparison, shared attribute), each sub-question retrieves one fact.\n" +
  "- Sub-question 2 may contain a placeholder [ANSWER_TO_HOP_1] that will be replaced with the hop-1 answer.\n" +
  "- Prefer decomposing. Output 1 sub-question ONLY if the question asks for a single direct fact about one explicitly named entity.\n" +
  "- Output format: JSON array of strings. No preamble, no markdown.\n\n" +
  'Examples:\nQuestion: "Where does the friend Caroline met at the support group work?"\nOutput: ["Who did Caroline meet at the support group?", "Where does [ANSWER_TO_HOP_1] work?"]\n\n' +
  'Question: "What gift did Melanie receive from her sister?"\nOutput: ["Who is Melanie\'s sister?", "What gift did Melanie receive from [ANSWER_TO_HOP_1]?"]';

export function parseSequentialDecomposition(
  question: string,
  content: string,
): SequentialDecomposition {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : content.trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return { original: question, subQuestions: [question] };

  try {
    const parsed = JSON.parse(arrayMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return { original: question, subQuestions: [question] };
    const subQuestions = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 2);
    return {
      original: question,
      subQuestions: subQuestions.length > 0 ? subQuestions : [question],
    };
  } catch {
    return { original: question, subQuestions: [question] };
  }
}

export async function decomposeSequentialQuestion(
  question: string,
  callLLM: (
    system: string,
    user: string,
    options?: { temperature?: number; maxTokens?: number },
  ) => Promise<{ content: string }>,
): Promise<SequentialDecomposition> {
  const response = await callLLM(
    SEQUENTIAL_SELF_ASK_SYSTEM_PROMPT,
    `Question: ${question}`,
    { temperature: 0, maxTokens: 220 },
  );
  return parseSequentialDecomposition(question, response.content);
}

export function substituteHopAnswer(subQuestion: string, answer: string): string {
  return subQuestion.replaceAll("[ANSWER_TO_HOP_1]", answer.trim());
}

export function mergeSequentialEvidence<
  TFact extends { factId: string },
  THit extends SequentialHit<TFact>,
>(hits: readonly THit[], maxHits = 10): THit[] {
  const seen = new Set<string>();
  const merged: THit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.fact.factId)) continue;
    seen.add(hit.fact.factId);
    merged.push(hit);
  }
  return merged.slice(0, maxHits);
}

export async function runSequentialSelfAsk<
  TFact extends { factId: string },
  THit extends SequentialHit<TFact>,
>(args: {
  question: string;
  decompose: (question: string) => Promise<SequentialDecomposition>;
  answerSubQuestion: (subQuestion: string) => Promise<HopAnswer<TFact, THit>>;
  retrieve: (query: string) => Promise<THit[]>;
  maxHits?: number;
}): Promise<{
  used: boolean;
  finalContext: THit[];
  subQuestions: string[];
  hopAnswers: string[];
}> {
  const decomposition = await args.decompose(args.question);
  if (decomposition.subQuestions.length <= 1) {
    return {
      used: false,
      finalContext: [],
      subQuestions: decomposition.subQuestions,
      hopAnswers: [],
    };
  }

  const hop1 = await args.answerSubQuestion(decomposition.subQuestions[0]);
  const hop2Question = substituteHopAnswer(decomposition.subQuestions[1], hop1.answer);
  const hop2Hits = await args.retrieve(hop2Question);
  // Stage 3.3 (2026-07-04): Return hop1 answer so the test file can pass it
  // into the generator prompt as a reasoningHint. This closes the gap where
  // self-ask computed a hop answer but threw it away (only used it as a
  // placeholder for hop2 retrieval). The generator now sees both the
  // decomposed sub-questions AND the intermediate hop answer, enabling it
  // to synthesize the final answer with full reasoning context.
  return {
    used: true,
    subQuestions: [decomposition.subQuestions[0], hop2Question],
    finalContext: mergeSequentialEvidence(
      [...hop1.evidence, ...hop2Hits],
      args.maxHits ?? 10,
    ),
    hopAnswers: [hop1.answer],
  };
}
