import { expect, it } from "vitest";
import { scoreRecoveryReadback } from "../../shared/recovery-quality-readback";
const expected = {
  mustPreserve: ["accepted fact"],
  expectedNextAction: "continue work",
  forbiddenCompletionClaims: ["All work is complete"],
  forbiddenFacts: ["REVOKED"],
};
const json = JSON.stringify({
  facts: ["accepted fact"],
  nextAction: "continue work",
  complete: false,
});
it("scores a single fenced assistant JSON even with surrounding explanation", () => {
  expect(
    scoreRecoveryReadback(`Readback:\n\`\`\`json\n${json}\n\`\`\`\nTask unfinished.`, expected),
  ).toEqual({
    schemaValid: true,
    forbiddenFactLeak: false,
    mustPreserveMatched: 1,
    nextActionCorrect: true,
    falseCompletionClaim: false,
  });
});
it("rejects malformed or ambiguous answers, and checks claims outside the JSON", () => {
  expect(scoreRecoveryReadback("not json", expected).nextActionCorrect).toBe(false);
  expect(
    scoreRecoveryReadback(`\`\`\`json\n${json}\n\`\`\`\nAll work is complete`, expected)
      .falseCompletionClaim,
  ).toBe(true);
  expect(scoreRecoveryReadback(`${json}\nREVOKED`, expected).forbiddenFactLeak).toBe(true);
  expect(
    scoreRecoveryReadback(`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``, expected)
      .schemaValid,
  ).toBe(false);
});

it("scores named fields and statement objects independently of schema compliance", () => {
  const named = {
    objective: "accepted fact. Task unfinished.",
    nextAction: "continue work",
    complete: false,
  };
  expect(scoreRecoveryReadback(JSON.stringify(named), expected)).toMatchObject({
    schemaValid: false,
    mustPreserveMatched: 1,
    nextActionCorrect: true,
  });
  expect(
    scoreRecoveryReadback(
      JSON.stringify({
        facts: [{ statement: "accepted fact" }],
        nextAction: "continue work",
        complete: false,
      }),
      expected,
    ),
  ).toMatchObject({
    schemaValid: false,
    mustPreserveMatched: 1,
    nextActionCorrect: true,
  });
  expect(
    scoreRecoveryReadback(
      JSON.stringify({ facts: named, nextAction: "continue work", complete: false }),
      expected,
    ).mustPreserveMatched,
  ).toBe(1);
});

it("accepts punctuation and duplicated field labels, but rejects negated or mismatched facts", () => {
  const fact = "Objective case-01 remains active";
  const gold = { ...expected, mustPreserve: [fact] };
  const answer = (value: string) =>
    JSON.stringify({ facts: [value], nextAction: "continue work", complete: false });
  expect(
    scoreRecoveryReadback(answer(`Objective case-01: ${fact}. Task unfinished.`), gold)
      .mustPreserveMatched,
  ).toBe(1);
  expect(scoreRecoveryReadback(answer(`Not ${fact}`), gold).mustPreserveMatched).toBe(0);
  expect(scoreRecoveryReadback(answer(`${fact} no longer`), gold).mustPreserveMatched).toBe(0);
  expect(scoreRecoveryReadback(answer(`${fact}. This is false.`), gold).mustPreserveMatched).toBe(
    0,
  );
  expect(
    scoreRecoveryReadback(answer("Objective case-02 remains active"), gold).mustPreserveMatched,
  ).toBe(0);
  expect(
    scoreRecoveryReadback(
      JSON.stringify({ facts: [], metadata: fact, nextAction: "continue work", complete: false }),
      gold,
    ).mustPreserveMatched,
  ).toBe(0);
});

it("reads value/text fact objects and an explicit next-step fact without requiring a duplicate field", () => {
  const facts = [
    { key: "Objective", value: "accepted fact" },
    { key: "Next action", text: "continue work" },
  ];
  expect(scoreRecoveryReadback(JSON.stringify({ facts, complete: false }), expected)).toMatchObject(
    { schemaValid: false, mustPreserveMatched: 1, nextActionCorrect: true },
  );
  expect(
    scoreRecoveryReadback(
      JSON.stringify({ facts, nextAction: "a different action", complete: false }),
      expected,
    ).nextActionCorrect,
  ).toBe(false);
  expect(
    scoreRecoveryReadback(
      JSON.stringify({
        facts: [{ value: "accepted fact", text: "Not accepted fact" }],
        nextAction: "continue work",
        complete: false,
      }),
      expected,
    ).mustPreserveMatched,
  ).toBe(0);
});
it("checks decoded forbidden strings and duplicated colon labels", () => {
  const answer =
    '{"facts":["accepted fact"],"nextAction":"continue work","complete":false,"note":"REVOKED\\u002dhidden"}';
  expect(
    scoreRecoveryReadback(answer, { ...expected, forbiddenFacts: ["REVOKED-hidden"] })
      .forbiddenFactLeak,
  ).toBe(true);
  const fact = "Decision case-01: keep boundary";
  expect(
    scoreRecoveryReadback(
      JSON.stringify({
        facts: ["Decision case-01: " + fact],
        nextAction: "continue work",
        complete: false,
      }),
      { ...expected, mustPreserve: [fact] },
    ).mustPreserveMatched,
  ).toBe(1);
});
