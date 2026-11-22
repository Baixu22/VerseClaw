// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ANCHORED_RECALL_TOOL_DEF, anchoredDeterministicTurn, buildBenefitPressure, createAnchorPolicyState } from "../../scripts/context-inline-spill-benefit-strategy.mjs";
import { buildProjectedEvalInput, contentText, RECALL_TOOL_DEF } from "../../scripts/context-inline-spill-benefit-input.mjs";

const checksum = "sha256:" + "a".repeat(64);
const original = "context-archive://session/original.json";
const input = (text: string) => [{ role: "user", content: text }];
describe("anchored archive recall and pressure provenance", () => {
  it("keeps the original visible pair when new distractor references appear", () => {
    const state = createAnchorPolicyState();
    const first = anchoredDeterministicTurn(input(original + " " + checksum), state);
    expect(first.toolCalls[0]?.arguments).toEqual({ archive_uri: original, checksum, offset: 0, max_chars: 5500 });
    const second = anchoredDeterministicTurn(input("context-archive://session/distractor.json " + "sha256:" + "b".repeat(64)), state);
    expect(second.toolCalls[0]?.arguments).toEqual({ archive_uri: original, checksum, offset: 5500, max_chars: 5500 });
  });

  it("takes a complete value only from projected visible output", () => {
    const state = createAnchorPolicyState();
    const output = { type: "function_call_output", call_id: "recall-1", output: JSON.stringify({ ok: true, content: "private_evidence=EXACT_VALUE\n" }) };
    expect(anchoredDeterministicTurn([...input(original + " " + checksum), output], state).text).toBe('{"value":"EXACT_VALUE"}');
    const history = [{ type: "function_call", call_id: "recall-1", name: "context_archive_recall", arguments: "{}" },
      { ...output, hidden: "EXACT_VALUE" }];
    const projected = buildProjectedEvalInput([], history, "Find the value");
    expect(anchoredDeterministicTurn(projected, createAnchorPolicyState()).text).toBe('{"value":null}');
  });

  it("does not guess missing handles or exceed three pages", () => {
    expect(anchoredDeterministicTurn(input("No archive reference"), createAnchorPolicyState()).toolCalls).toEqual([]);
    const state = createAnchorPolicyState();
    for (let index = 0; index < 3; index++) expect(anchoredDeterministicTurn(input(original + " " + checksum), state).toolCalls[0]?.arguments.offset).toBe(index * 5500);
    expect(anchoredDeterministicTurn(input(original + " " + checksum), state).text).toBe('{"value":null}');
  });

  it("preserves every log byte and the user/assistant turn cadence while strengthening tool pressure", () => {
    const old = buildBenefitPressure(2, "LOG ", "user");
    const fixed = buildBenefitPressure(2, "LOG ", "tool");
    expect(old.filter(item => item.role === "user")).toHaveLength(1);
    expect(fixed.filter(item => item.role === "user")).toHaveLength(1);
    expect(old.filter(item => item.role === "assistant")).toHaveLength(1);
    expect(fixed.filter(item => item.role === "assistant")).toHaveLength(1);
    expect(contentText(fixed[2]!)).toBe(contentText(old[1]!));
    expect(fixed.filter(item => item.role === "toolResult").map(contentText)).toEqual([contentText(old[1]!), contentText(old[2]!), contentText(old[3]!)]);
    expect(fixed.filter(item => item.role === "toolResult")).toHaveLength(3);
    expect(ANCHORED_RECALL_TOOL_DEF.parameters).toEqual(RECALL_TOOL_DEF.parameters);
  });
});
