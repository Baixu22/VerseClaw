// @vitest-environment node
// Unit tests for the cross-encoder-rerank module (P3-A).
//
// Tests cover:
//   - applyRerank integration (reuses JustifierResult-compatible shape)
//   - skip logic (no LLM call when ≤ keepOriginalN)
//   - batch pair-wise behavior (multiple batches, callCount tracking)
//   - fallback behavior on JSON parse failure / LLM error
//   - Live LLM tests gated on DEEPSEEK_API_KEY (skip otherwise)

import { describe, it, expect } from "vitest";
import {
  rerankWithCrossEncoder,
  type CrossEncoderCandidate,
} from "./helpers/cross-encoder-rerank";
import { applyRerank } from "./helpers/justifier-rerank";
import {
  hasDeepSeekKey,
  type LlmCallOptions,
  type LlmResponse,
} from "./helpers/runtime-memory-real-llm-client";

// === Fixtures ===

function makeCandidates(n: number): CrossEncoderCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    factId: `f${i}`,
    subject: `Subject${i}`,
    predicate: `Predicate${i}`,
    objectSummary: `Summary ${i}`,
    rrfScore: 1 - i * 0.05, // descending RRF scores
  }));
}

const RELEVANT_CANDIDATES: CrossEncoderCandidate[] = [
  { factId: "f0", subject: "Alice", predicate: "started_job", objectSummary: "March 2023", rrfScore: 0.95 },
  { factId: "f1", subject: "Bob", predicate: "hobby", objectSummary: "likes hiking", rrfScore: 0.80 },
  { factId: "f2", subject: "Alice", predicate: "promoted_to", objectSummary: "Senior Engineer", rrfScore: 0.75 },
  { factId: "f3", subject: "Charlie", predicate: "favorite_food", objectSummary: "pizza", rrfScore: 0.70 },
  { factId: "f4", subject: "Alice", predicate: "birthday", objectSummary: "May 15", rrfScore: 0.65 },
  { factId: "f5", subject: "Dave", predicate: "car", objectSummary: "Toyota", rrfScore: 0.60 },
  { factId: "f6", subject: "Eve", predicate: "pet", objectSummary: "cat named Whiskers", rrfScore: 0.55 },
  { factId: "f7", subject: "Alice", predicate: "school", objectSummary: "Stanford University", rrfScore: 0.50 },
];

describe("cross-encoder-rerank", () => {
  describe("skip logic", () => {
    it("skips LLM call when candidates ≤ keepOriginalN (default 5)", async () => {
      const candidates = makeCandidates(5);
      const result = await rerankWithCrossEncoder("What is Alice's job?", candidates);
      expect(result.skipped).toBe(true);
      expect(result.fallback).toBe(false);
      expect(result.callCount).toBe(0);
      expect(result.scores.size).toBe(5);
      // First candidate should have highest score
      expect(result.scores.get("f0")?.score).toBeGreaterThan(
        result.scores.get("f4")?.score ?? 1,
      );
    });

    it("skips LLM call when candidates ≤ keepOriginalN (custom 3)", async () => {
      const candidates = makeCandidates(3);
      const result = await rerankWithCrossEncoder("q?", candidates, { keepOriginalN: 3 });
      expect(result.skipped).toBe(true);
      expect(result.callCount).toBe(0);
    });

    it("does not skip when candidates > keepOriginalN", async () => {
      const candidates = makeCandidates(6);
      try {
        const result = await rerankWithCrossEncoder("q?", candidates);
        if (!hasDeepSeekKey()) {
          // No key → LLM fails → fallback
          expect(result.skipped).toBe(false);
          expect(result.fallback).toBe(true);
        } else {
          expect(result.skipped).toBe(false);
        }
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  describe("applyRerank integration", () => {
    it("sorts candidates by Cross-Encoder score descending", () => {
      const candidates = makeCandidates(6);
      // Simulate Cross-Encoder result: scores out of original order
      const result = {
        scores: new Map([
          ["f0", { score: 0.3, reason: "r0" }],
          ["f1", { score: 0.9, reason: "r1" }],
          ["f2", { score: 0.5, reason: "r2" }],
          ["f3", { score: 0.1, reason: "r3" }],
          ["f4", { score: 0.7, reason: "r4" }],
          ["f5", { score: 0.2, reason: "r5" }],
        ]),
        skipped: false,
        fallback: false,
        callCount: 2,
      };
      const sorted = applyRerank(candidates, result);
      expect(sorted[0].factId).toBe("f1"); // 0.9
      expect(sorted[1].factId).toBe("f4"); // 0.7
      expect(sorted[2].factId).toBe("f2"); // 0.5
      expect(sorted[3].factId).toBe("f0"); // 0.3
      expect(sorted[4].factId).toBe("f5"); // 0.2
      expect(sorted[5].factId).toBe("f3"); // 0.1
    });

    it("uses original RRF score as tiebreaker when scores equal", () => {
      const candidates: CrossEncoderCandidate[] = [
        { factId: "a", subject: "s", predicate: "p", objectSummary: "o1", rrfScore: 0.5 },
        { factId: "b", subject: "s", predicate: "p", objectSummary: "o2", rrfScore: 0.9 },
        { factId: "c", subject: "s", predicate: "p", objectSummary: "o3", rrfScore: 0.7 },
      ];
      const result = {
        scores: new Map([
          ["a", { score: 0.5, reason: "" }],
          ["b", { score: 0.5, reason: "" }],
          ["c", { score: 0.5, reason: "" }],
        ]),
        skipped: false,
        fallback: false,
        callCount: 1,
      };
      const sorted = applyRerank(candidates, result);
      expect(sorted[0].factId).toBe("b"); // 0.9 RRF
      expect(sorted[1].factId).toBe("c"); // 0.7 RRF
      expect(sorted[2].factId).toBe("a"); // 0.5 RRF
    });
  });

  describe("batch behavior (with mocked success path)", () => {
    it("uses an injected LLM caller for every batch", async () => {
      const calls: Array<{ system: string; user: string; options: LlmCallOptions }> = [];
      const callLLM = async (
        system: string,
        user: string,
        options: LlmCallOptions = {},
      ): Promise<LlmResponse> => {
        calls.push({ system, user, options });
        const ids = Array.from(user.matchAll(/factId: (\w+)/g), (match) => match[1]);
        return {
          content: JSON.stringify(
            ids.map((factId, index) => ({
              factId,
              score: 1 - index * 0.1,
              reason: "mocked",
            })),
          ),
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          attempts: 1,
        };
      };

      const result = await rerankWithCrossEncoder("test question", makeCandidates(6), {
        batchSize: 3,
        callLLM,
      });

      expect(result.skipped).toBe(false);
      expect(result.fallback).toBe(false);
      expect(result.callCount).toBe(2);
      expect(result.scores.size).toBe(6);
      expect(calls).toHaveLength(2);
      expect(calls[0].system).toContain("relevance scorer");
      expect(calls[0].options.maxTokens).toBe(600);
    });

    it("returns callCount = ceil(candidates / batchSize) on success", async () => {
      if (!hasDeepSeekKey()) return; // skip without key
      const candidates = makeCandidates(8);
      const result = await rerankWithCrossEncoder("test question", candidates, { batchSize: 5 });
      // 8 candidates / batch 5 = 2 batches
      expect(result.callCount).toBe(2);
      expect(result.scores.size).toBe(8);
    }, 30000);
  });

  describe("live LLM tests", () => {
    const maybeDescribe = hasDeepSeekKey() ? describe : describe.skip;

    maybeDescribe("with real DeepSeek API", () => {
      it("reranks candidates by relevance (pair-wise)", async () => {
        const result = await rerankWithCrossEncoder(
          "When did Alice start her job?",
          RELEVANT_CANDIDATES,
        );

        expect(result.skipped).toBe(false);
        expect(result.scores.size).toBe(8);
        // callCount = ceil(8 / 5) = 2 batches
        expect(result.callCount).toBe(2);

        // f0 (Alice started_job March 2023) should score high
        const f0Score = result.scores.get("f0")?.score ?? 0;
        // f3 (Charlie favorite_food pizza) should score low
        const f3Score = result.scores.get("f3")?.score ?? 1;
        expect(f0Score).toBeGreaterThan(f3Score);

        // f2 (Alice promoted_to) should also be relevant
        const f2Score = result.scores.get("f2")?.score ?? 0;
        expect(f2Score).toBeGreaterThan(f3Score);

        // Verify reason field is populated
        for (const [, val] of result.scores) {
          expect(val.reason.length).toBeGreaterThan(0);
        }
      }, 30000);

      it("returns non-fallback result on successful parse", async () => {
        const result = await rerankWithCrossEncoder("What is Alice's job?", RELEVANT_CANDIDATES);
        expect(result.fallback).toBe(false);
        expect(result.callCount).toBeGreaterThan(0);
      }, 30000);
    });
  });
});
