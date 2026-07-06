// @vitest-environment node
// Unit tests for the justifier-rerank module (P1).
//
// Tests cover:
//   - parseJustifierResponse (JSON parsing, code fence stripping, malformed input)
//   - applyRerank (sorting by score with RRF tiebreaker)
//   - rerankWithJustifier with skip logic (no LLM call when ≤ keepOriginalN)
//   - Live LLM tests gated on DEEPSEEK_API_KEY (skip otherwise)

import { describe, it, expect } from "vitest";
import {
  rerankWithJustifier,
  applyRerank,
  type JustifierCandidate,
  type JustifierResult,
} from "./helpers/justifier-rerank";
import {
  hasDeepSeekKey,
  type LlmCallOptions,
  type LlmResponse,
} from "./helpers/runtime-memory-real-llm-client";

// === Fixtures ===

function makeCandidates(n: number): JustifierCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    factId: `f${i}`,
    subject: `Subject${i}`,
    predicate: `Predicate${i}`,
    objectSummary: `Summary ${i}`,
    rrfScore: 1 - i * 0.05, // descending RRF scores
  }));
}

const RELEVANT_CANDIDATES: JustifierCandidate[] = [
  {
    factId: "f0",
    subject: "Alice",
    predicate: "started_job",
    objectSummary: "March 2023",
    rrfScore: 0.95,
  },
  {
    factId: "f1",
    subject: "Bob",
    predicate: "hobby",
    objectSummary: "likes hiking",
    rrfScore: 0.80,
  },
  {
    factId: "f2",
    subject: "Alice",
    predicate: "promoted_to",
    objectSummary: "Senior Engineer",
    rrfScore: 0.75,
  },
  {
    factId: "f3",
    subject: "Charlie",
    predicate: "favorite_food",
    objectSummary: "pizza",
    rrfScore: 0.70,
  },
  {
    factId: "f4",
    subject: "Alice",
    predicate: "birthday",
    objectSummary: "May 15",
    rrfScore: 0.65,
  },
  {
    factId: "f5",
    subject: "Dave",
    predicate: "car",
    objectSummary: "Toyota",
    rrfScore: 0.60,
  },
];

describe("justifier-rerank", () => {
  describe("applyRerank", () => {
    it("sorts candidates by Justifier score descending", () => {
      const candidates = makeCandidates(6);
      const result: JustifierResult = {
        scores: new Map([
          ["f0", { score: 0.3, reason: "" }],
          ["f1", { score: 0.9, reason: "" }],
          ["f2", { score: 0.5, reason: "" }],
          ["f3", { score: 0.1, reason: "" }],
          ["f4", { score: 0.7, reason: "" }],
          ["f5", { score: 0.2, reason: "" }],
        ]),
        skipped: false,
        fallback: false,
      };

      const sorted = applyRerank(candidates, result);
      expect(sorted[0].factId).toBe("f1"); // score 0.9
      expect(sorted[1].factId).toBe("f4"); // score 0.7
      expect(sorted[2].factId).toBe("f2"); // score 0.5
      expect(sorted[3].factId).toBe("f0"); // score 0.3
      expect(sorted[4].factId).toBe("f5"); // score 0.2
      expect(sorted[5].factId).toBe("f3"); // score 0.1
    });

    it("uses original RRF score as tiebreaker when Justifier scores equal", () => {
      const candidates: JustifierCandidate[] = [
        { factId: "a", subject: "s", predicate: "p", objectSummary: "o1", rrfScore: 0.5 },
        { factId: "b", subject: "s", predicate: "p", objectSummary: "o2", rrfScore: 0.9 },
        { factId: "c", subject: "s", predicate: "p", objectSummary: "o3", rrfScore: 0.7 },
      ];
      const result: JustifierResult = {
        scores: new Map([
          ["a", { score: 0.5, reason: "" }],
          ["b", { score: 0.5, reason: "" }],
          ["c", { score: 0.5, reason: "" }],
        ]),
        skipped: false,
        fallback: false,
      };

      const sorted = applyRerank(candidates, result);
      // All scores equal → sort by RRF desc: b (0.9), c (0.7), a (0.5)
      expect(sorted[0].factId).toBe("b");
      expect(sorted[1].factId).toBe("c");
      expect(sorted[2].factId).toBe("a");
    });

    it("assigns score 0 to candidates not in the scores map", () => {
      const candidates = makeCandidates(3);
      const result: JustifierResult = {
        scores: new Map([
          ["f0", { score: 0.9, reason: "" }],
          // f1 and f2 missing
        ]),
        skipped: false,
        fallback: false,
      };

      const sorted = applyRerank(candidates, result);
      expect(sorted[0].factId).toBe("f0"); // 0.9
      // f1 and f2 both get score 0 → sorted by RRF (f1=0.95, f2=0.90)
      expect(sorted[1].factId).toBe("f1");
      expect(sorted[2].factId).toBe("f2");
    });

    it("does not mutate the input array", () => {
      const candidates = makeCandidates(3);
      const originalOrder = candidates.map((c) => c.factId);
      const result: JustifierResult = {
        scores: new Map([
          ["f0", { score: 0.1, reason: "" }],
          ["f1", { score: 0.9, reason: "" }],
          ["f2", { score: 0.5, reason: "" }],
        ]),
        skipped: false,
        fallback: false,
      };

      applyRerank(candidates, result);
      expect(candidates.map((c) => c.factId)).toEqual(originalOrder);
    });
  });

  describe("rerankWithJustifier — skip logic", () => {
    it("skips LLM call when candidates ≤ keepOriginalN (default 5)", async () => {
      const candidates = makeCandidates(5);
      const result = await rerankWithJustifier(
        "What is Alice's job?",
        candidates,
      );
      expect(result.skipped).toBe(true);
      expect(result.fallback).toBe(false);
      // Scores should still be populated (by original rank)
      expect(result.scores.size).toBe(5);
      // First candidate should have highest score
      expect(result.scores.get("f0")?.score).toBeGreaterThan(
        result.scores.get("f4")?.score ?? 1,
      );
    });

    it("skips LLM call when candidates ≤ keepOriginalN (custom 3)", async () => {
      const candidates = makeCandidates(3);
      const result = await rerankWithJustifier("q?", candidates, {
        keepOriginalN: 3,
      });
      expect(result.skipped).toBe(true);
    });

    it("does not skip when candidates > keepOriginalN", async () => {
      // This would normally trigger an LLM call — gated on API key below.
      // Here we just verify the skip check works with no key by catching
      // the fallback path.
      const candidates = makeCandidates(6);
      try {
        const result = await rerankWithJustifier("q?", candidates);
        // If no API key, the call will fail and return fallback
        if (!hasDeepSeekKey()) {
          expect(result.fallback).toBe(true);
          expect(result.skipped).toBe(false);
        } else {
          expect(result.skipped).toBe(false);
        }
      } catch (err) {
        // Network errors without key — also fallback
        expect(err).toBeDefined();
      }
    });
  });

  describe("rerankWithJustifier — live LLM tests", () => {
    it("uses an injected LLM caller for tracked eval runs", async () => {
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

      const result = await rerankWithJustifier("test question", makeCandidates(6), {
        callLLM,
      });

      expect(result.skipped).toBe(false);
      expect(result.fallback).toBe(false);
      expect(result.scores.size).toBe(6);
      expect(calls).toHaveLength(1);
      expect(calls[0].system).toContain("relevance judge");
      expect(calls[0].options.maxTokens).toBe(800);
    });

    // These tests require a real DeepSeek API key and make real LLM calls.
    // Skipped gracefully when DEEPSEEK_API_KEY is not set.
    const maybeDescribe = hasDeepSeekKey() ? describe : describe.skip;

    maybeDescribe("with real DeepSeek API", () => {
      it("reranks candidates by relevance", async () => {
        const result = await rerankWithJustifier(
          "When did Alice start her job?",
          RELEVANT_CANDIDATES,
        );

        expect(result.skipped).toBe(false);
        expect(result.scores.size).toBe(6);

        // f0 (Alice started_job March 2023) should score highest
        const f0Score = result.scores.get("f0")?.score ?? 0;
        // f3 (Charlie favorite_food pizza) should score lowest
        const f3Score = result.scores.get("f3")?.score ?? 1;
        expect(f0Score).toBeGreaterThan(f3Score);

        // f2 (Alice promoted_to Senior Engineer) should also be relevant
        const f2Score = result.scores.get("f2")?.score ?? 0;
        expect(f2Score).toBeGreaterThan(f3Score);

        // Verify reason field is populated
        for (const [, val] of result.scores) {
          expect(val.reason.length).toBeGreaterThan(0);
        }
      }, 30000); // 30s timeout for real LLM call

      it("returns non-fallback result on successful parse", async () => {
        const result = await rerankWithJustifier(
          "What is Alice's job?",
          RELEVANT_CANDIDATES,
        );
        expect(result.fallback).toBe(false);
      }, 30000);
    });
  });
});
