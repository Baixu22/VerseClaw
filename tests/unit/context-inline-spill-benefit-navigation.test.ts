// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildVisibleRecallNavigation, navigatedDeterministicTurn } from "../../scripts/context-inline-spill-benefit-strategy.mjs";
const uri = "context-archive://session/original.json", checksum = "sha256:" + "a".repeat(64);
const call = (id: string, offset = 0, max_chars = 5500) => ({ type: "function_call", name: "context_archive_recall", call_id: id,
  arguments: JSON.stringify({ archive_uri: uri, checksum, offset, max_chars }) });
const output = (id: string, text: string) => ({ type: "function_call_output", call_id: id, output: text });
const prompt = (text: string) => ({ role: "user", content: text });
describe("recall navigation from current visible input", () => {
  it("keeps the first call target despite newer distractor references and uses visible page length", () => {
    const input = [prompt("context-archive://session/distractor.json sha256:" + "b".repeat(64)), call("first"),
      output("first", JSON.stringify({ ok: true, offset: 0, content: "log ".repeat(100) }))];
    const result = buildVisibleRecallNavigation(input);
    expect(result.navigation.recommendedArguments).toEqual({ archive_uri: uri, checksum, offset: 400, max_chars: 5500 });
    expect(result.navigation.targetSourceIndex).toBe(1);
    expect(result.navigation.offsetSourceIndex).toBe(2);
  });
  it("uses visible call metadata after eviction without restoring hidden content", () => {
    const input = [prompt("No target in this projection"), call("page", 5500),
      { ...output("page", '{"ok":false,"diagnostics":[{"code":"projection_omitted"}]}'), hidden: "private_evidence=HIDDEN_VALUE\n" }];
    const result = buildVisibleRecallNavigation(input);
    expect(result.navigation.recommendedArguments?.offset).toBe(11000);
    expect(result.navigation.fieldSourceIndex).toBeNull();
    expect(String(result.input.at(-1)?.content)).not.toContain("HIDDEN_VALUE");
    expect(navigatedDeterministicTurn(input).text).toBe("");
  });
  it("locates a complete visible field without copying or grading its value", () => {
    const input = [prompt("Find the field"), call("page", 5500),
      { ...output("page", JSON.stringify({ ok: true, offset: 5500, content: "health-checksprivate_evidence=DECOY_VISIBLE_VALUE\n" })), hiddenOracle: "HIDDEN_TRUE_ORACLE" }];
    const result = buildVisibleRecallNavigation(input);
    expect(result.navigation.fieldSourceIndex).toBe(2);
    expect(result.navigation.fieldCallId).toBe("page");
    expect(result.navigation.recommendedArguments).toBeNull();
    expect(String(result.input.at(-1)?.content)).not.toContain("DECOY_VISIBLE_VALUE");
    expect(String(result.input.at(-1)?.content)).not.toContain("HIDDEN_TRUE_ORACLE");
    expect(navigatedDeterministicTurn(input).text).toBe('{"value":"DECOY_VISIBLE_VALUE"}');
  });
  it("does not guess missing references or recommend a fourth recall", () => {
    expect(navigatedDeterministicTurn([prompt("No archive reference")]).text).toBe('{"value":null}');
    const input = [prompt(uri + " " + checksum), call("first"), call("second", 5500), call("third", 11000)];
    expect(buildVisibleRecallNavigation(input).navigation.recommendedArguments).toBeNull();
  });
  it("rejects invalid page cursors and preserves every base-input byte", () => {
    const input = [prompt(uri + " " + checksum), call("bad", -1), output("bad", "{malformed")];
    const bytes = JSON.stringify(input);
    const result = buildVisibleRecallNavigation(input);
    expect(result.navigation.recommendedArguments).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
    expect(result.input.slice(0, -1)).toEqual(input);
    expect(buildVisibleRecallNavigation([prompt("No reference"), { ...call("bad"), arguments: "null" }]).navigation.recommendedArguments).toBeNull();
    const failed = [prompt(uri + " " + checksum), call("failed"), output("failed", '{"ok":false,"diagnostics":[{"code":"invalid_arguments"}]}')];
    expect(buildVisibleRecallNavigation(failed).navigation.recommendedArguments?.offset).toBe(0);
  });
});
