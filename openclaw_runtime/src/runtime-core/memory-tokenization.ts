/** Shared no-segmenter CJK fallback. Kept free of memory-store/runtime imports. */
export const CJK_RUN_RE = /[\u4e00-\u9fff]{2,}/g;

export function cjkBigrams(text: string): string[] {
  const grams: string[] = [];
  for (const run of text.match(CJK_RUN_RE) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      grams.push(run.slice(i, i + 2));
    }
  }
  return grams;
}
