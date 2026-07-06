import { describe, expect, it } from "vitest";
import {
  parseSequentialDecomposition,
  runSequentialSelfAsk,
  substituteHopAnswer,
} from "./helpers/runtime-memory-sequential-self-ask";

describe("runtime memory sequential self-ask", () => {
  it("parses decomposition and substitutes hop answers", () => {
    const parsed = parseSequentialDecomposition(
      "Where does the friend work?",
      '["Who is the friend?", "Where does [ANSWER_TO_HOP_1] work?"]',
    );
    expect(parsed.subQuestions).toHaveLength(2);
    expect(substituteHopAnswer(parsed.subQuestions[1], "Alice")).toBe(
      "Where does Alice work?",
    );
  });

  it("carries hop-1 evidence into final context", async () => {
    const result = await runSequentialSelfAsk({
      question: "Where does the friend work?",
      decompose: async () => ({
        original: "Where does the friend work?",
        subQuestions: ["Who is the friend?", "Where does [ANSWER_TO_HOP_1] work?"],
      }),
      answerSubQuestion: async () => ({
        answer: "Alice",
        evidence: [{ fact: { factId: "f1" }, rrfScore: 1 }],
      }),
      retrieve: async (query) => {
        expect(query).toBe("Where does Alice work?");
        return [
          { fact: { factId: "f2" }, rrfScore: 0.9 },
          { fact: { factId: "f1" }, rrfScore: 0.8 },
        ];
      },
    });

    expect(result.used).toBe(true);
    expect(result.finalContext.map((hit) => hit.fact.factId)).toEqual(["f1", "f2"]);
  });
});
