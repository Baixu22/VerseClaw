/**
 * Characterization tests for byte-limit helpers.
 *
 * These snapshot the CURRENT behavior of normalizePositiveLimit and
 * appendBoundedTextTail so later refactors of the ported coding tools have a
 * regression net. Where a snapshotted behavior looks questionable it is called
 * out with a `characterization:` comment — recorded, not endorsed.
 */
import { describe, expect, it } from "vitest";
import {
  appendBoundedTextTail,
  normalizePositiveLimit,
  SESSION_TOOL_STDERR_TAIL_BYTES,
} from "./limits.js";

describe("normalizePositiveLimit", () => {
  it("returns the fallback for undefined", () => {
    expect(normalizePositiveLimit(undefined, 10)).toBe(10);
  });

  it("returns the fallback for non-finite values", () => {
    expect(normalizePositiveLimit(Number.NaN, 10)).toBe(10);
    expect(normalizePositiveLimit(Number.POSITIVE_INFINITY, 10)).toBe(10);
    expect(normalizePositiveLimit(Number.NEGATIVE_INFINITY, 10)).toBe(10);
  });

  it("floors fractional values", () => {
    expect(normalizePositiveLimit(5.9, 10)).toBe(5);
    expect(normalizePositiveLimit(1.1, 10)).toBe(1);
  });

  it("clamps zero and negatives up to 1", () => {
    expect(normalizePositiveLimit(0, 10)).toBe(1);
    expect(normalizePositiveLimit(-5, 10)).toBe(1);
  });

  it("passes through valid positive integers", () => {
    expect(normalizePositiveLimit(3, 10)).toBe(3);
    expect(normalizePositiveLimit(1, 10)).toBe(1);
  });
});

describe("SESSION_TOOL_STDERR_TAIL_BYTES", () => {
  it("is 64 KiB", () => {
    expect(SESSION_TOOL_STDERR_TAIL_BYTES).toBe(64 * 1024);
  });
});

describe("appendBoundedTextTail", () => {
  it("concatenates when the combined size fits within the limit", () => {
    expect(appendBoundedTextTail("", "hello", 100)).toBe("hello");
    expect(appendBoundedTextTail("abc", "def", 100)).toBe("abcdef");
  });

  it("keeps only the trailing bytes of current+chunk when combined exceeds the limit", () => {
    // current="abc"(3B) + chunk="def"(3B) = 6B > 4B limit.
    // Retains the last 4 bytes across the boundary: "cdef".
    expect(appendBoundedTextTail("abc", "def", 4)).toBe("cdef");
  });

  it("keeps only the tail of the chunk when the chunk alone meets/exceeds the limit", () => {
    // chunk="defgh"(5B) >= 4B limit: current is dropped entirely, last 4B of chunk kept.
    expect(appendBoundedTextTail("abc", "defgh", 4)).toBe("efgh");
  });

  it("does not split multi-byte UTF-8 characters at the tail boundary", () => {
    // "café" = c,a,f (1B each) + é (0xC3 0xA9, 2B) = 5B total, >= 3B limit.
    // Walking from the end: é(2B) fits, f(1B) makes 3B, a(1B) would overflow.
    expect(appendBoundedTextTail("", "café", 3)).toBe("fé");
  });

  it("accepts Buffer chunks as well as strings", () => {
    expect(appendBoundedTextTail("x", Buffer.from("yz"), 100)).toBe("xyz");
  });

  it("clamps a maxBytes of 0 to a 1-byte tail rather than the 64 KiB default", () => {
    // characterization: current behavior, not necessarily desired — maxBytes=0 is
    // finite, so normalizePositiveLimit clamps it to 1 (keep one byte) instead of
    // falling back to SESSION_TOOL_STDERR_TAIL_BYTES.
    expect(appendBoundedTextTail("abc", "def", 0)).toBe("f");
  });
});
