export const ERROR_TAXONOMY_BUCKETS = [
  "not_retrieved",
  "retrieved_not_used",
  "used_but_misreasoned",
  "judge_error",
] as const;

export type ErrorTaxonomyBucket = (typeof ERROR_TAXONOMY_BUCKETS)[number];

export type ErrorTaxonomyClassification = {
  bucket: ErrorTaxonomyBucket;
  reason: string;
};

export type ErrorTaxonomyCounts = Record<ErrorTaxonomyBucket, number>;

export type ErrorTaxonomyInput = {
  question: string;
  assembledContext: string;
  predictedAnswer: string;
  groundTruth: string;
  judgeScore: number;
};

export type ErrorTaxonomyResult = ErrorTaxonomyInput &
  ErrorTaxonomyClassification & {
    category: string;
  };

export const ERROR_TAXONOMY_SYSTEM_PROMPT =
  "You are a failure-mode classifier for a memory-augmented QA system. Given a question, the assembled context, the generated answer, the gold answer, and the judge's verdict, classify the failure into exactly one bucket:\n\n" +
  "- not_retrieved: The gold evidence is NOT present in the assembled context. The generator could not have answered correctly because the information was never retrieved.\n" +
  "- retrieved_not_used: The gold evidence IS present in the assembled context, but the generator did not use it. The answer either ignores the relevant evidence or cites irrelevant parts.\n" +
  "- used_but_misreasoned: The generator used the correct evidence but reasoned incorrectly (e.g., wrong date arithmetic, wrong entity inference, wrong aggregation).\n" +
  "- judge_error: The generated answer is actually correct and matches the gold answer, but the judge marked it wrong.\n\n" +
  'Respond with ONLY a JSON object: {"bucket": "<one of the four>", "reason": "<one short sentence>"}';

export function buildErrorTaxonomyUserPrompt(input: ErrorTaxonomyInput): string {
  const verdict = input.judgeScore === 1 ? "correct" : "incorrect";
  return `Question: ${input.question}

Assembled Context:
${input.assembledContext}

Generated Answer: ${input.predictedAnswer}
Gold Answer: ${input.groundTruth}
Judge Verdict: ${verdict}

Classify the failure bucket:`;
}

export function parseErrorTaxonomyResponse(content: string): ErrorTaxonomyClassification {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return { bucket: "used_but_misreasoned", reason: "Classifier returned no JSON." };
  }

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const bucket = parsed.bucket;
    if (typeof bucket === "string" && isErrorTaxonomyBucket(bucket)) {
      return {
        bucket,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    }
  } catch {
    // Fall through to conservative default.
  }

  return { bucket: "used_but_misreasoned", reason: "Classifier returned invalid JSON." };
}

export async function classifyErrorTaxonomy(
  input: ErrorTaxonomyInput,
  callLLM: (
    system: string,
    user: string,
    options?: { temperature?: number; maxTokens?: number },
  ) => Promise<{ content: string }>,
): Promise<ErrorTaxonomyClassification | null> {
  if (input.judgeScore !== 0) return null;
  const response = await callLLM(
    ERROR_TAXONOMY_SYSTEM_PROMPT,
    buildErrorTaxonomyUserPrompt(input),
    { temperature: 0, maxTokens: 160 },
  );
  return parseErrorTaxonomyResponse(response.content);
}

export function createEmptyErrorTaxonomyCounts(): ErrorTaxonomyCounts {
  return {
    not_retrieved: 0,
    retrieved_not_used: 0,
    used_but_misreasoned: 0,
    judge_error: 0,
  };
}

export function aggregateErrorTaxonomy(
  results: readonly ErrorTaxonomyResult[],
): {
  overall: ErrorTaxonomyCounts;
  byCategory: Record<string, ErrorTaxonomyCounts>;
} {
  const overall = createEmptyErrorTaxonomyCounts();
  const byCategory: Record<string, ErrorTaxonomyCounts> = {};

  for (const result of results) {
    overall[result.bucket] += 1;
    byCategory[result.category] ??= createEmptyErrorTaxonomyCounts();
    byCategory[result.category][result.bucket] += 1;
  }

  return { overall, byCategory };
}

function isErrorTaxonomyBucket(value: string): value is ErrorTaxonomyBucket {
  return (ERROR_TAXONOMY_BUCKETS as readonly string[]).includes(value);
}
