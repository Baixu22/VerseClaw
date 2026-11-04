// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildProjectedEvalInput, pairedSessionId } from "../../scripts/context-inline-spill-benefit-input.mjs";

const history = [
  { type: "function_call", call_id: "recall-1", name: "context_archive_recall", arguments: '{"offset":5500}', hidden: "SECRET" },
  { type: "function_call_output", call_id: "recall-1", output: "SECRET", hidden: "SECRET" },
];
const result = (text: string) => ({ role: "toolResult", toolCallId: "recall-1", content: [{ type: "text", text }] });

describe("benefit eval projected input", () => {
  it("does not restore an evicted oracle from raw protocol history", () => {
    const input = buildProjectedEvalInput([result("[Old tool result content cleared]")], history, "Find the exact value");
    expect(JSON.stringify(input)).not.toContain("SECRET");
    expect(input[2]).toEqual({ type: "function_call_output", call_id: "recall-1", output: "[Old tool result content cleared]" });
  });

  it("includes retained evidence once, in the matching protocol output", () => {
    const input = buildProjectedEvalInput([{ role: "user", content: "Pressure remains" }, result("private_evidence=SECRET")], history, "Find it");
    expect(String(input[0].content)).toContain("Pressure remains");
    expect(String(input[0].content)).not.toContain("SECRET");
    expect(JSON.stringify(input).split("SECRET")).toHaveLength(2);
    expect(input[1]).toEqual({ type: "function_call", call_id: "recall-1", name: "context_archive_recall", arguments: '{"offset":5500}' });
  });

  it("fails closed when projection omits a protocol result", () => {
    const input = buildProjectedEvalInput([], history, "Find it");
    expect(JSON.stringify(input)).not.toContain("SECRET");
    expect(JSON.parse(String(input[2].output))).toEqual({ ok: false, diagnostics: [{ code: "projection_omitted" }] });
  });

  it("preserves projected fail-closed diagnostics and rejects extra history messages", () => {
    const error = '{"ok":false,"diagnostics":[{"code":"parallel_recall_limit"}]}';
    expect(buildProjectedEvalInput([result(error)], history, "Find it")[2].output).toBe(error);
    expect(() => buildProjectedEvalInput([], [{ role: "user", content: "SECRET" }], "Find it")).toThrow("Unsupported eval protocol history item");
  });

  it("uses one session identity and identical initial input for the pressure pair", () => {
    const stable = pairedSessionId("fixture", "recall-stable", 2);
    const off = pairedSessionId("fixture", "retention-off", 2);
    expect(stable).toBe(off);
    expect(stable).not.toBe(pairedSessionId("fixture", "reference-visible", 2));
    const context = (session: string) => [{ role: "user", content: "context-archive://" + session + "/payload" }];
    expect(JSON.stringify(buildProjectedEvalInput(context(stable), [], "Find it"))).toBe(JSON.stringify(buildProjectedEvalInput(context(off), [], "Find it")));
  });
});
