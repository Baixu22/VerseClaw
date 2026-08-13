import { describe, expect, it } from 'vitest';
import { estimateStringChars } from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/cjk-tokens';

describe('agent-core CJK-aware token estimation', () => {
  it('leaves pure ASCII text unchanged', () => {
    expect(estimateStringChars('hello world')).toBe('hello world'.length);
  });

  it('inflates CJK characters to preserve the chars/4 estimate', () => {
    // 10 CJK chars: each is counted as 4 -> 40 effective chars (~10 tokens).
    const tenHan = '汉字汉字汉字汉字汉字';
    expect(estimateStringChars(tenHan)).toBe(tenHan.length * 4);
  });

  it('counts CJK Extension B surrogate pairs as a single character', () => {
    // U+20000 (CJK Extension B) is a surrogate pair; one char => 4 effective chars.
    const extensionB = '\u{20000}';
    expect(extensionB.length).toBe(2); // sanity: UTF-16 pair
    expect(estimateStringChars(extensionB)).toBe(4);
  });

  it('handles mixed Latin + CJK', () => {
    // "ab" (2 latin) + "字" (1 cjk -> 4) = 6 effective chars.
    expect(estimateStringChars('ab字')).toBe(2 + 4);
  });

  it('returns 0 for empty text', () => {
    expect(estimateStringChars('')).toBe(0);
  });
});
