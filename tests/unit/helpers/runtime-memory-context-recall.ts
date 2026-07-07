export type ContextRecallInput = {
  category: string;
  assembledContext: string;
  goldEvidence: readonly string[];
};

export type ContextRecallAggregate = {
  contextRecall: number;
  count: number;
};

export function computeContextRecall(
  assembledContext: string,
  goldEvidence: readonly string[],
): number {
  if (goldEvidence.length === 0) return 1;
  const contextLower = assembledContext.toLowerCase();
  let score = 0;

  for (const gold of goldEvidence) {
    const goldWords = gold
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^\w\u4e00-\u9fff]/g, ""))
      .filter((word) => word.length > 3);
    if (goldWords.length === 0) continue;

    const matched = goldWords.filter((word) => contextLower.includes(word)).length;
    const ratio = matched / goldWords.length;
    if (ratio >= 0.8) score += 1;
    else if (ratio >= 0.4) score += 0.5;
  }

  return score / goldEvidence.length;
}

export function aggregateContextRecall(
  inputs: readonly ContextRecallInput[],
): {
  overall: ContextRecallAggregate;
  byCategory: Record<string, ContextRecallAggregate>;
} {
  const byCategorySums = new Map<string, { sum: number; count: number }>();
  let total = 0;

  for (const input of inputs) {
    const value = computeContextRecall(input.assembledContext, input.goldEvidence);
    total += value;
    const current = byCategorySums.get(input.category) ?? { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    byCategorySums.set(input.category, current);
  }

  const byCategory: Record<string, ContextRecallAggregate> = {};
  for (const [category, value] of byCategorySums) {
    byCategory[category] = {
      contextRecall: value.count > 0 ? value.sum / value.count : 0,
      count: value.count,
    };
  }

  return {
    overall: {
      contextRecall: inputs.length > 0 ? total / inputs.length : 0,
      count: inputs.length,
    },
    byCategory,
  };
}
