// @vitest-environment node
// Unit tests for the query-time-extractor module (P2-2).
//
// Verifies that absolute dates, relative expressions, and present-tense
// keywords are correctly extracted from question text, and that unknown
// questions return mode="unknown" without a referenceTime.

import { describe, it, expect } from "vitest";
import {
  extractQueryTimeConstraint,
} from "./helpers/query-time-extractor";

// Anchor time: 2023-12-01T00:00:00Z (a typical conversation max valid_at)
const ANCHOR = Date.UTC(2023, 11, 1, 0, 0, 0);

describe("extractQueryTimeConstraint", () => {
  describe("absolute date extraction", () => {
    it("extracts 'on 15 March 2023'", () => {
      const result = extractQueryTimeConstraint(
        "What did Alice say on 15 March 2023?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2023, 2, 15, 0, 0, 0));
      expect(result.matchedPhrase).toContain("15 March 2023");
    });

    it("extracts 'in 2023' (year only)", () => {
      const result = extractQueryTimeConstraint(
        "What happened in 2023?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2023, 0, 1, 0, 0, 0));
    });

    it("extracts 'before 2023'", () => {
      const result = extractQueryTimeConstraint(
        "What did Alice do before 2023?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2023, 0, 1, 0, 0, 0));
    });

    it("extracts 'since 2018'", () => {
      const result = extractQueryTimeConstraint(
        "Has Alice worked there since 2018?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2018, 0, 1, 0, 0, 0));
    });

    it("extracts bare year 2023 without preposition", () => {
      const result = extractQueryTimeConstraint(
        "Did Alice get promoted in 2023?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2023, 0, 1, 0, 0, 0));
    });

    it("extracts 'at 8 May, 2023'", () => {
      const result = extractQueryTimeConstraint(
        "What did Alice say at 8 May, 2023?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2023, 4, 8, 0, 0, 0));
    });
  });

  describe("relative time extraction", () => {
    it("extracts '5 years ago' with anchor", () => {
      const result = extractQueryTimeConstraint(
        "Did Alice start surfing 5 years ago?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      // anchor = 2023-12-01, 5 years before ≈ 2018-12-01 (approximate, 365-day years)
      expect(result.referenceTime).toBeDefined();
      expect(result.referenceTime).toBeLessThan(ANCHOR);
      // Should be roughly 5 years before anchor (allow ±2 day tolerance for leap years)
      const expectedApprox = Date.UTC(2018, 11, 1, 0, 0, 0);
      expect(Math.abs(result.referenceTime! - expectedApprox)).toBeLessThan(2 * 24 * 60 * 60 * 1000);
      expect(result.matchedPhrase).toBe("5 years ago");
    });

    it("extracts 'five years ago' (word form) with anchor", () => {
      const result = extractQueryTimeConstraint(
        "Did Alice start surfing five years ago?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBeDefined();
      expect(result.referenceTime).toBeLessThan(ANCHOR);
      const expectedApprox = Date.UTC(2018, 11, 1, 0, 0, 0);
      expect(Math.abs(result.referenceTime! - expectedApprox)).toBeLessThan(2 * 24 * 60 * 60 * 1000);
      expect(result.matchedPhrase).toBe("five years ago");
    });

    it("extracts '3 months ago' with anchor", () => {
      const result = extractQueryTimeConstraint(
        "What happened 3 months ago?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      // anchor = 2023-12-01, 3 months before ≈ 2023-09-02 (using 30-day months)
      expect(result.referenceTime).toBeDefined();
      expect(result.referenceTime).toBeLessThan(ANCHOR);
    });

    it("extracts 'last month' with anchor", () => {
      const result = extractQueryTimeConstraint(
        "What did Alice do last month?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBeLessThan(ANCHOR);
    });

    it("extracts 'last year' with anchor", () => {
      const result = extractQueryTimeConstraint(
        "What did Alice do last year?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBeLessThan(ANCHOR);
    });

    it("returns relative mode without referenceTime when no anchor", () => {
      const result = extractQueryTimeConstraint(
        "Did Alice start surfing 5 years ago?",
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBeUndefined();
      expect(result.matchedPhrase).toBe("5 years ago");
    });
  });

  describe("present-tense keywords", () => {
    it("extracts 'recently' as anchorTime", () => {
      const result = extractQueryTimeConstraint(
        "What has Alice been doing recently?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBe(ANCHOR);
    });

    it("extracts 'currently' as anchorTime", () => {
      const result = extractQueryTimeConstraint(
        "Where is Alice currently working?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBe(ANCHOR);
    });

    it("extracts 'now' as anchorTime", () => {
      const result = extractQueryTimeConstraint(
        "What is Alice doing now?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBe(ANCHOR);
    });
  });

  describe("unknown / no temporal constraint", () => {
    it("returns unknown for non-temporal question", () => {
      const result = extractQueryTimeConstraint(
        "How is Alice doing?",
        ANCHOR,
      );
      expect(result.mode).toBe("unknown");
      expect(result.referenceTime).toBeUndefined();
    });

    it("returns unknown for 'what is Alice's job?'", () => {
      const result = extractQueryTimeConstraint(
        "What is Alice's job?",
        ANCHOR,
      );
      expect(result.mode).toBe("unknown");
    });

    it("returns unknown for empty input", () => {
      expect(extractQueryTimeConstraint("")).toEqual({ mode: "unknown" });
      expect(extractQueryTimeConstraint("")).toEqual({ mode: "unknown" });
    });

    it("returns unknown for 'who is Alice?'", () => {
      const result = extractQueryTimeConstraint("Who is Alice?", ANCHOR);
      expect(result.mode).toBe("unknown");
    });
  });

  describe("edge cases", () => {
    it("handles 'next Sunday' as unknown (not yet supported)", () => {
      // Per plan: 'next Sunday' requires context time anchor — return unknown.
      const result = extractQueryTimeConstraint(
        "Did Alice go to the beach next Sunday?",
        ANCHOR,
      );
      expect(result.mode).toBe("unknown");
    });

    it("prefers absolute date over relative when both present", () => {
      // "What did Alice do on 15 March 2023, 2 years ago?"
      // Should match the absolute date first.
      const result = extractQueryTimeConstraint(
        "What did Alice do on 15 March 2023, 2 years ago?",
        ANCHOR,
      );
      expect(result.mode).toBe("absolute");
      expect(result.referenceTime).toBe(Date.UTC(2023, 2, 15, 0, 0, 0));
    });

    it("handles 'twelve years ago' (max word number)", () => {
      const result = extractQueryTimeConstraint(
        "Did Alice start twelve years ago?",
        ANCHOR,
      );
      expect(result.mode).toBe("relative");
      expect(result.referenceTime).toBeDefined();
      expect(result.referenceTime).toBeLessThan(ANCHOR);
    });

    it("does not match bare month name without year", () => {
      // "What did Alice do in March?" — no year, should be unknown
      const result = extractQueryTimeConstraint(
        "What did Alice do in March?",
        ANCHOR,
      );
      // "March" without year is ambiguous; absDateMatch requires a year digit.
      // But bareYearMatch won't fire either. Should be unknown.
      expect(result.mode).toBe("unknown");
    });
  });
});
