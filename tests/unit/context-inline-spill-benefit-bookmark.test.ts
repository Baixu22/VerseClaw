// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendVisibleExecBookmark, BOOKMARK_RECALL_TOOL_DEF, buildVisibleRecallNavigation, navigatedDeterministicTurn } from "../../scripts/context-inline-spill-benefit-strategy.mjs";
import { RECALL_TOOL_DEF } from "../../scripts/context-inline-spill-benefit-input.mjs";
const sha = "a".repeat(64), checksum = "sha256:" + sha;
const uri = "context-archive://session/original-" + sha.slice(0, 16) + ".context-archive.json";
const wrong = "context-archive://session/original-" + sha + ".context-archive.json";
const question = appendVisibleExecBookmark("Find the exact field", uri + " " + checksum);
const call = (id: string, archive_uri = uri, offset = 0) => ({ type: "function_call", name: "context_archive_recall", call_id: id,
  arguments: JSON.stringify({ archive_uri, checksum, offset, max_chars: 5500 }) });
const output = (id: string, content: string) => ({ type: "function_call_output", call_id: id, output: content });
describe("bounded visible exec bookmark", () => {
  it("recovers the original target after the model expands the checksum into the URI", () => {
    const input = [{ role: "user", content: question }, call("wrong", wrong), output("wrong", '{"ok":false,"diagnostics":[{"code":"missing"}]}')];
    const bytes = JSON.stringify(input), result = buildVisibleRecallNavigation(input);
    expect(result.navigation.source).toBe("visible-agent-question-bookmark");
    expect(result.navigation.recommendedArguments).toEqual({ archive_uri: uri, checksum, offset: 0, max_chars: 5500 });
    expect(JSON.stringify(input)).toBe(bytes);
    expect(result.input.slice(0, -1)).toEqual(input);
  });
  it("keeps evidence recovery after one failed call within the existing three-call strategy", () => {
    const input = [{ role: "user", content: question }, call("wrong", wrong), output("wrong", '{"ok":false}'),
      call("page0"), output("page0", JSON.stringify({ ok: true, offset: 0, content: "log ".repeat(1375) })),
      call("page1", uri, 5500), output("page1", JSON.stringify({ ok: true, offset: 5500, content: "checksprivate_evidence=VISIBLE_VALUE\n" }))];
    expect(buildVisibleRecallNavigation(input).navigation.recallsUsed).toBe(3);
    expect(navigatedDeterministicTurn(input).text).toBe('{"value":"VISIBLE_VALUE"}');
  });
  it("copies only visible references, excludes payload, and leaves the no-reference baseline unchanged", () => {
    const value = appendVisibleExecBookmark("Question", uri + " " + checksum + " private_evidence=DO_NOT_COPY\n");
    expect(value).not.toContain("DO_NOT_COPY");
    expect(appendVisibleExecBookmark("Question", "No archive reference")).toBe("Question");
    expect(appendVisibleExecBookmark("Question", "context-archive://" + "x".repeat(700) + " " + checksum)).toBe("Question");
    expect(BOOKMARK_RECALL_TOOL_DEF.parameters).toEqual(RECALL_TOOL_DEF.parameters);
  });
});
