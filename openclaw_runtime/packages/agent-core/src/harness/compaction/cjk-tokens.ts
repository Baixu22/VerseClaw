// Agent Core module implements CJK-aware token estimation for compaction.
//
// agent-core cannot import the runtime's `src/utils/cjk-chars.ts` across the
// package boundary, so this file keeps a minimal, self-contained equivalent of
// that helper's non-Latin inflation rule. Latin text averages ~4 chars/token;
// CJK (Han/Hiragana/Katakana/Hangul) averages ~1 char/token. Inflating each
// non-Latin character by 4 keeps the downstream `chars / 4` estimate accurate
// for any script.

/** Default characters-per-token ratio used throughout the codebase. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Matches CJK Unified Ideographs, CJK Extension A/B, CJK Compatibility
 * Ideographs, Hangul Syllables, Hiragana, Katakana, and other non-Latin
 * scripts that typically use ~1 token per character.
 */
const NON_LATIN_RE = /[\u2E80-\u9FFF\uA000-\uA4FF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu;

/** Matches surrogate pairs whose code point falls in the CJK Extension B+ range. */
const CJK_SURROGATE_HIGH_RE = /[\uD840-\uD87E][\uDC00-\uDFFF]/g;

/**
 * Return an adjusted character length that accounts for non-Latin characters.
 * Each non-Latin character is counted as {@link CHARS_PER_TOKEN_ESTIMATE} chars
 * so that a downstream `chars / CHARS_PER_TOKEN_ESTIMATE` token estimate stays
 * accurate. Pure ASCII/Latin text returns `text.length` unchanged.
 */
export function estimateStringChars(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const nonLatinCount = (text.match(NON_LATIN_RE) ?? []).length;
  const codePointLength =
    nonLatinCount === 0 ? text.length : text.length - (text.match(CJK_SURROGATE_HIGH_RE) ?? []).length;
  return codePointLength + nonLatinCount * (CHARS_PER_TOKEN_ESTIMATE - 1);
}
