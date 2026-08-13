// Agent Core module: Reasonix-aligned prompt-token calibration.
//
// Faithful port of DeepSeek-Reasonix `internal/agent/output_budget.go`
// (`isCjkRune`, `calibratedPromptTokens`, `estimatedShapeTokens`) and
// `internal/agent/compact.go` (`tokPerChar`, `fallbackTokPerChar`). The key
// idea: token estimates start at the cold `chars * fallbackTokPerChar` rate and
// are then calibrated from the same session's real provider usage
// (promptTokens / requestChars). A higher CJK share than the calibrated session
// cannot safely reuse the aggregate ratio, so its excess CJK bytes are priced
// back at the cold rate — preserving exact calibration for stable CJK sessions
// while not silently underestimating CJK-heavy turns.

/** ~4 chars per token, used before any real usage is available to calibrate. */
export const fallbackTokPerChar = 0.25;

/** Byte length of a string (UTF-8), matching Go `len(s)` used by the reference. */
export function utf8ByteLength(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  // TextEncoder encodes to UTF-8; length equals Go's len([]byte(s)).
  return new TextEncoder().encode(text).length;
}

/** Code-point count, matching Go `utf8.RuneCountInString`. */
export function utf8RuneCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return [...text].length;
}

/**
 * Faithful port of `isCjkRune`. The reference uses a narrower range than the
 * CJK-inflation helper: CJK Unified (4E00-9FFF), Extension A (3400-4DBF),
 * Hiragana/Katakana (3040-30FF), and Hangul (AC00-D7AF).
 */
export function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}

/** Per-text shape: UTF-8 bytes plus the CJK byte/runes subset. */
export type TextShape = {
  bytes: number;
  cjkRunes: number;
  cjkBytes: number;
};

/**
 * Count UTF-8 bytes and the CJK subset of a string. Matches the reference's
 * `add(s)` accumulation in `requestCalibrationTextShape`: raw `len(s)` bytes,
 * plus per-rune CJK detection with `utf8.RuneLen` byte accumulation.
 */
export function countTextShape(text: string): TextShape {
  if (text.length === 0) {
    return { bytes: 0, cjkRunes: 0, cjkBytes: 0 };
  }
  const bytes = utf8ByteLength(text);
  let cjkRunes = 0;
  let cjkBytes = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && isCjkCodePoint(codePoint)) {
      cjkRunes += 1;
      cjkBytes += utf8ByteLength(ch);
    }
  }
  return { bytes, cjkRunes, cjkBytes };
}

/** Request calibration shape: provider-visible bytes plus the CJK subset. */
export type RequestCalibrationShape = {
  requestChars: number;
  compactChars: number;
  cjkRunes: number;
  cjkBytes: number;
};

/** Same-session usage calibration captured from the last provider response. */
export type PromptTokenCalibration = {
  promptTokens: number;
  requestChars: number;
  compactChars: number;
  cjkRunes: number;
  cjkBytes: number;
};

/**
 * Faithful port of `calibratedPromptTokens`. Returns the calibrated prompt
 * token estimate, or undefined when no trusted calibration exists. The ratio is
 * gated to (0.05, 2) to reject absurd provider telemetry.
 */
export function calibratedPromptTokens(
  shape: RequestCalibrationShape,
  calibration: PromptTokenCalibration | undefined,
): number | undefined {
  if (shape.requestChars <= 0) {
    return undefined;
  }
  if (calibration && calibration.requestChars > 0) {
    const ratio = calibration.promptTokens / calibration.requestChars;
    if (ratio > 0.05 && ratio < 2) {
      let trustedChars = shape.requestChars;
      let excessCjkBytes = 0;
      // A higher CJK share than the calibrated session cannot safely reuse the
      // aggregate ratio. Scale the represented share and price only the excess
      // at the cold rate.
      if (shape.cjkRunes * calibration.requestChars > calibration.cjkRunes * shape.requestChars) {
        const trustedCjkBytes = Math.min(
          Math.floor((calibration.cjkBytes * shape.requestChars) / calibration.requestChars),
          shape.cjkBytes,
        );
        excessCjkBytes = shape.cjkBytes - trustedCjkBytes;
        trustedChars -= excessCjkBytes;
      }
      const cold = Math.ceil(excessCjkBytes * fallbackTokPerChar);
      return Math.ceil(trustedChars * ratio) + cold;
    }
  }
  return undefined;
}

/**
 * Faithful port of `tokPerChar`. Returns the tokens-per-character ratio derived
 * from the last turn's real usage, gated to (0.05, 2), else the cold fallback.
 */
export function tokPerChar(calibration: PromptTokenCalibration | undefined): number {
  if (calibration && calibration.compactChars > 0) {
    const ratio = calibration.promptTokens / calibration.compactChars;
    if (ratio > 0.05 && ratio < 2) {
      return ratio;
    }
  }
  return fallbackTokPerChar;
}

/**
 * Faithful port of `estimatedShapeTokens`: calibrated estimate when available,
 * else the cold `requestChars * fallbackTokPerChar` (truncated).
 */
export function estimatedShapeTokens(
  shape: RequestCalibrationShape,
  calibration: PromptTokenCalibration | undefined,
): number {
  if (shape.requestChars <= 0) {
    return 0;
  }
  const calibrated = calibratedPromptTokens(shape, calibration);
  if (calibrated !== undefined) {
    return calibrated;
  }
  return Math.floor(shape.requestChars * fallbackTokPerChar);
}
