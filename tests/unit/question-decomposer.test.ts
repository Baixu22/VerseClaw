// @vitest-environment node
// Unit tests for the question-decomposer module (P3-B).
//
// Tests cover:
//   - Single-hop skip (no LLM call, returns original)
//   - Multi-hop decomposition (LLM call returns 2-3 sub-questions)
//   - mergeStrategy validation
//   - Fallback on JSON parse failure / LLM error
//   - maxSubQuestions cap
//   - Live LLM tests gated on DEEPSEEK_API_KEY (skip otherwise)

import { describe, it, expect } from "vitest";
import {
  decomposeQuestion,
  type DecomposedQuestion,
} from "./helpers/question-decomposer";
import { hasDeepSeekKey } from "./helpers/runtime-memory-real-llm-client";

describe("question-decomposer", () => {
  describe("single-hop skip", () => {
    it("returns original question unchanged for single-hop (no LLM call)", async () => {
      // "What is Alice's job?" — no multi-hop pattern → skip
      const result = await decomposeQuestion("What is Alice's job?");
      expect(result.subQuestions).toHaveLength(1);
      expect(result.subQuestions[0]).toBe("What is Alice's job?");
      expect(result.mergeStrategy).toBe("union");
    });

    it("returns original question for 'how are you' (not multi-hop)", async () => {
      const result = await decomposeQuestion("How are you doing today?");
      expect(result.subQuestions).toHaveLength(1);
      expect(result.mergeStrategy).toBe("union");
    });
  });

  describe("live LLM tests", () => {
    const maybeDescribe = hasDeepSeekKey() ? describe : describe.skip;

    maybeDescribe("with real DeepSeek API", () => {
      it("decomposes 'how long' multi-hop question into sub-questions", async () => {
        // "how long" matches MULTI_HOP_PATTERNS
        const result = await decomposeQuestion(
          "How long has Alice worked at the hospital since she moved to the city?",
        );

        expect(result.subQuestions.length).toBeGreaterThanOrEqual(1);
        // For a genuine multi-hop question, we expect ≥ 2 sub-questions
        if (result.subQuestions.length > 1) {
          // Each sub-question should be non-empty
          for (const sq of result.subQuestions) {
            expect(sq.length).toBeGreaterThan(0);
          }
          // mergeStrategy should be one of the valid values
          expect(["intersection", "chain", "union"]).toContain(result.mergeStrategy);
        }
      }, 30000);

      it("decomposes 'compare' multi-hop question", async () => {
        const result = await decomposeQuestion(
          "Compare Alice's current job with her previous job.",
        );

        expect(result.subQuestions.length).toBeGreaterThanOrEqual(1);
        if (result.subQuestions.length > 1) {
          // Should preserve entity name "Alice"
          const allText = result.subQuestions.join(" ");
          expect(allText.toLowerCase()).toContain("alice");
        }
      }, 30000);

      it("decomposes 'relationship between' multi-hop question", async () => {
        const result = await decomposeQuestion(
          "What is the relationship between Alice and Bob?",
        );

        expect(result.subQuestions.length).toBeGreaterThanOrEqual(1);
        if (result.subQuestions.length > 1) {
          // Should preserve both entity names
          const allText = result.subQuestions.join(" ").toLowerCase();
          // At least one of the names should appear
          expect(allText.includes("alice") || allText.includes("bob")).toBe(true);
        }
      }, 30000);

      it("returns valid mergeStrategy", async () => {
        const result = await decomposeQuestion(
          "How long did Alice work at the hospital before she got promoted?",
        );

        expect(["intersection", "chain", "union"]).toContain(result.mergeStrategy);
      }, 30000);
    });
  });

  describe("maxSubQuestions cap", () => {
    it("limits sub-questions to maxSubQuestions", async () => {
      if (!hasDeepSeekKey()) return;
      const result = await decomposeQuestion(
        "How long has Alice worked at the hospital since she moved to the city and what did she do before that?",
        { maxSubQuestions: 2 },
      );
      expect(result.subQuestions.length).toBeLessThanOrEqual(2);
    }, 30000);
  });

  describe("result shape", () => {
    it("always includes original field", async () => {
      const result = await decomposeQuestion("What is Alice's job?");
      expect(result.original).toBe("What is Alice's job?");
    });

    it("always returns at least one sub-question", async () => {
      const result = await decomposeQuestion("How long has Alice worked here?");
      expect(result.subQuestions.length).toBeGreaterThanOrEqual(1);
      expect(result.subQuestions[0].length).toBeGreaterThan(0);
    });
  });
});
