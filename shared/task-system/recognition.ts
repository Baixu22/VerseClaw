/** Bounded lexical suggestions. Similarity never grants identity or execution. */
export function taskWords(text: string): Set<string> {
  const value = text.normalize("NFKC").toLowerCase();
  const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set<string>();
  for (const word of words) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) {
      for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
    } else if (word.length > 1) result.add(word);
  }
  return result;
}
export function taskSimilarity(query: string, objective: string): number {
  const a = taskWords(query),
    b = taskWords(objective);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((word) => b.has(word)).length;
  return common / (a.size + b.size - common);
}
