/**
 * LoCoMo benchmark metric helpers.
 *
 * - computeRecallAt5: checks if key entities from the ground truth answer
 *   appear in the top-5 retrieved facts' text.
 * - computeF1: token-level F1 between generated answer and ground truth.
 * - computeBleu1: unigram BLEU between generated answer and ground truth.
 */

export type LocomoFact = { factId: string; objectSummary: string };

export type LocomoQuestion = {
  questionId: string;
  conversationId: string;
  question: string;
  answer: string;
  category: string;
};

/**
 * Recall@5: fraction of ground-truth key entities found in the top-5
 * retrieved facts' text. Uses simple word-level matching.
 */
export function computeRecallAt5(
  retrievedFacts: LocomoFact[],
  groundTruthAnswer: string,
): number {
  if (retrievedFacts.length === 0 || groundTruthAnswer.trim().length === 0) {
    return 0;
  }

  const top5 = retrievedFacts.slice(0, 5);
  const factText = top5.map((f) => f.objectSummary.toLowerCase()).join(" ");
  const factTokens = new Set(tokenize(factText));

  const answerTokens = tokenize(groundTruthAnswer.toLowerCase()).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );

  if (answerTokens.length === 0) return 0;

  let hits = 0;
  for (const token of answerTokens) {
    if (factTokens.has(token)) hits++;
  }

  return hits / answerTokens.length;
}

/**
 * Token-level F1 between generated answer and ground truth.
 */
export function computeF1(generatedAnswer: string, groundTruthAnswer: string): number {
  const genTokens = tokenize(generatedAnswer.toLowerCase());
  const gtTokens = tokenize(groundTruthAnswer.toLowerCase());

  if (genTokens.length === 0 || gtTokens.length === 0) return 0;

  const genCounts = new Map<string, number>();
  for (const t of genTokens) genCounts.set(t, (genCounts.get(t) ?? 0) + 1);

  const gtCounts = new Map<string, number>();
  for (const t of gtTokens) gtCounts.set(t, (gtCounts.get(t) ?? 0) + 1);

  let overlap = 0;
  for (const [token, count] of genCounts) {
    const gtCount = gtCounts.get(token) ?? 0;
    overlap += Math.min(count, gtCount);
  }

  const precision = overlap / genTokens.length;
  const recall = overlap / gtTokens.length;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Unigram BLEU (BLEU-1) between generated answer and ground truth.
 */
export function computeBleu1(generatedAnswer: string, groundTruthAnswer: string): number {
  const genTokens = tokenize(generatedAnswer.toLowerCase());
  const gtTokens = tokenize(groundTruthAnswer.toLowerCase());

  if (genTokens.length === 0 || gtTokens.length === 0) return 0;

  const gtCounts = new Map<string, number>();
  for (const t of gtTokens) gtCounts.set(t, (gtCounts.get(t) ?? 0) + 1);

  let clippedMatches = 0;
  const genCounts = new Map<string, number>();
  for (const t of genTokens) genCounts.set(t, (genCounts.get(t) ?? 0) + 1);

  for (const [token, count] of genCounts) {
    const gtCount = gtCounts.get(token) ?? 0;
    clippedMatches += Math.min(count, gtCount);
  }

  const precision = clippedMatches / genTokens.length;

  // Brevity penalty
  const bp = genTokens.length >= gtTokens.length
    ? 1
    : Math.exp(1 - gtTokens.length / genTokens.length);

  return bp * precision;
}

function tokenize(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "under", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "also", "and",
  "but", "or", "if", "because", "while", "about", "against", "between",
  "into", "through", "during", "this", "that", "these", "those", "it",
  "its", "he", "she", "they", "we", "you", "i", "me", "him", "her",
  "them", "us", "my", "your", "his", "their", "our",
]);
