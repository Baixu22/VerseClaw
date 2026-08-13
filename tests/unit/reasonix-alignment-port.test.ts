import { describe, expect, it } from 'vitest';
import {
  calibratedPromptTokens,
  countTextShape,
  estimatedShapeTokens,
  fallbackTokPerChar,
  isCjkCodePoint,
  tokPerChar,
  utf8ByteLength,
  utf8RuneCount,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/token-calibration';
import {
  autoOutputBudget,
  DefaultHighReasoningOutputTokens,
  DefaultOrdinaryOutputTokens,
  DefaultReasoningOutputTokens,
  effectiveOutputBudget,
  outputBudgetReserve,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/output-budget';
import {
  checkpointCeiling,
  compactTrigger,
  defaultCompactRatio,
  estimateMessagesTokens,
  estimateTextTokens,
  exceptionalMinimumSavings,
  foldEconomics,
  hardInputCeiling,
  maxRecentTailTokens,
  recentTailBudget,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction-ratio';

describe('token-calibration (Reasonix port)', () => {
  it('counts UTF-8 bytes and runes like Go len/RuneCountInString', () => {
    expect(utf8ByteLength('hello')).toBe(5);
    expect(utf8ByteLength('汉字')).toBe(6); // 3 bytes per CJK char
    expect(utf8RuneCount('汉字')).toBe(2);
  });

  it('matches isCjkRune ranges', () => {
    expect(isCjkCodePoint(0x4e00)).toBe(true); // 一 CJK Unified
    expect(isCjkCodePoint(0x41)).toBe(false); // 'A'
    expect(isCjkCodePoint(0x30a2)).toBe(true); // ア Katakana
    expect(isCjkCodePoint(0xac00)).toBe(true); // 가 Hangul
  });

  it('counts the CJK subset of a string', () => {
    expect(countTextShape('汉字')).toEqual({ bytes: 6, cjkRunes: 2, cjkBytes: 6 });
    expect(countTextShape('ab字')).toEqual({ bytes: 5, cjkRunes: 1, cjkBytes: 3 });
    expect(countTextShape('hello')).toEqual({ bytes: 5, cjkRunes: 0, cjkBytes: 0 });
  });

  it('returns undefined for absurd calibration ratios', () => {
    const shape = { requestChars: 1000, compactChars: 800, cjkRunes: 0, cjkBytes: 0 };
    expect(
      calibratedPromptTokens(shape, {
        promptTokens: 10000,
        requestChars: 1000,
        compactChars: 800,
        cjkRunes: 0,
        cjkBytes: 0,
      }),
    ).toBeUndefined(); // ratio 10 > 2
  });

  it('calibrates a non-CJK shape from real usage ratio', () => {
    const shape = { requestChars: 10000, compactChars: 8000, cjkRunes: 0, cjkBytes: 0 };
    const cal = {
      promptTokens: 3000,
      requestChars: 10000,
      compactChars: 8000,
      cjkRunes: 0,
      cjkBytes: 0,
    };
    expect(calibratedPromptTokens(shape, cal)).toBe(3000);
    expect(tokPerChar(cal)).toBeCloseTo(0.375);
  });

  it('prices CJK excess at the cold rate when the CJK share grew', () => {
    const cal = {
      promptTokens: 3000,
      requestChars: 8000,
      compactChars: 8000,
      cjkRunes: 0,
      cjkBytes: 0,
    };
    const cjkHeavy = { requestChars: 8000, compactChars: 8000, cjkRunes: 1000, cjkBytes: 3000 };
    // trusted non-CJK chars = 5000; cold CJK = ceil(3000 * 0.25) = 750.
    expect(calibratedPromptTokens(cjkHeavy, cal)).toBe(Math.ceil(5000 * 0.375) + 750);
  });

  it('falls back to requestChars * 0.25 when uncalibrated', () => {
    const shape = { requestChars: 10000, compactChars: 8000, cjkRunes: 0, cjkBytes: 0 };
    expect(estimatedShapeTokens(shape, undefined)).toBe(2500);
    expect(fallbackTokPerChar).toBe(0.25);
  });
});

describe('output-budget (Reasonix port)', () => {
  it('maps max_output_tokens=0 by reasoning effort', () => {
    expect(autoOutputBudget(false, undefined)).toBe(DefaultOrdinaryOutputTokens); // 16K
    expect(autoOutputBudget(true, 'low')).toBe(DefaultReasoningOutputTokens); // 32K
    expect(autoOutputBudget(true, 'high')).toBe(DefaultHighReasoningOutputTokens); // 64K
    expect(autoOutputBudget(true, 'max')).toBe(DefaultHighReasoningOutputTokens); // 64K
    expect(autoOutputBudget(true, undefined)).toBe(DefaultReasoningOutputTokens); // 32K
  });

  it('clips the budget against the shared window with an 8K reserve', () => {
    expect(
      effectiveOutputBudget({
        contextWindow: 1_000_000,
        estimatedRequestTokens: 900_000,
        budget: 131_072,
        sharesContextWindow: true,
      }),
    ).toEqual({ budget: 1_000_000 - 900_000 - outputBudgetReserve, clipped: true });
  });

  it('does not clip a budget that already fits', () => {
    expect(
      effectiveOutputBudget({
        contextWindow: 1_000_000,
        estimatedRequestTokens: 900_000,
        budget: 16_384,
        sharesContextWindow: true,
      }),
    ).toEqual({ budget: 16_384, clipped: false });
  });

  it('reports compaction-required when no room remains after reserve', () => {
    expect(
      effectiveOutputBudget({
        contextWindow: 1_000_000,
        estimatedRequestTokens: 995_000,
        budget: 131_072,
        sharesContextWindow: true,
      }),
    ).toEqual({ error: 'compaction-required', estimatedPromptTokens: 995_000 });
  });

  it('does not clip for non-shared windows', () => {
    expect(
      effectiveOutputBudget({
        contextWindow: 1_000_000,
        estimatedRequestTokens: 900_000,
        budget: 131_072,
        sharesContextWindow: false,
      }),
    ).toEqual({ budget: 131_072, clipped: false });
  });
});

describe('compaction-ratio (Reasonix port)', () => {
  it('triggers at 0.85 of the window', () => {
    expect(defaultCompactRatio).toBe(0.85);
    expect(compactTrigger(1_000_000)).toBe(850_000);
    expect(compactTrigger(1_000_000, 0, true)).toBe(500_000); // ablation → 0.5
    expect(compactTrigger(0)).toBe(0);
  });

  it('computes hard input ceiling and checkpoint ceiling', () => {
    expect(hardInputCeiling(1_000_000)).toBe(1_000_000 - 256);
    expect(checkpointCeiling(1_000_000)).toBe(500_000);
    expect(exceptionalMinimumSavings(1_000_000)).toBe(250_000);
  });

  it('clamps the recent tail budget with a floor that drops for small windows', () => {
    expect(recentTailBudget(1_000_000)).toBe(maxRecentTailTokens); // 96K
    expect(recentTailBudget(100_000)).toBe(32 * 1024); // floor applies at ≥64K window
    expect(recentTailBudget(50_000)).toBe(5_000); // 10% of window, no floor
    expect(recentTailBudget(1_000)).toBe(100);
  });

  it('estimates text tokens as max(ceil(bytes/4), runes)', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('hello')).toBe(5); // runes win over ceil(5/4)=2
    expect(estimateTextTokens('汉字汉字')).toBe(4); // runes (4) vs ceil(12/4)=3
  });

  it('estimates message tokens with framing overhead', () => {
    expect(estimateMessagesTokens([{ content: 'hello' }])).toBe(4 + 5);
    expect(estimateMessagesTokens([{ localOnly: true, content: 'ignored' }])).toBe(0);
  });

  it('folds economics only when savings outweigh the summarizer round-trip', () => {
    expect(foldEconomics([{ content: 'x'.repeat(100) }])).toBe(false);
    expect(foldEconomics([{ content: 'x'.repeat(1600) }])).toBe(true);
  });
});
