// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { assertEvalRecallPage, buildProjectedEvalInput, pairedSessionId, RECALL_TOOL_DEF } from "../../scripts/context-inline-spill-benefit-input.mjs";

const history = [
  { type: "function_call", call_id: "recall-1", name: "context_archive_recall", arguments: '{"offset":5500}', hidden: "SECRET" },
  { type: "function_call_output", call_id: "recall-1", output: "SECRET", hidden: "SECRET" },
];
const result = (text: string) => ({ role: "toolResult", toolCallId: "recall-1", content: [{ type: "text", text }] });

describe("benefit eval projected input", () => {
  it("requires a bounded page in the model-facing schema and rejects invalid sizes before execution", () => {
    expect(RECALL_TOOL_DEF.parameters.required).toContain("max_chars");
    expect(RECALL_TOOL_DEF.parameters.properties.max_chars).toEqual({ type: "integer", minimum: 1, maximum: 5500 });
    for (const size of [undefined, null, "5500", true, 0, -1, 5501, 12000, 1.5, NaN, Infinity]) {
      expect(() => assertEvalRecallPage({ max_chars: size })).toThrow("max_chars must be an explicit integer");
    }
    expect(() => assertEvalRecallPage({ max_chars: 1 })).not.toThrow();
    expect(() => assertEvalRecallPage({ max_chars: 5500 })).not.toThrow();
  });

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

  it("records missing and oversized pages as invalid_arguments before validating an archive", () => {
    const root = mkdtempSync(join(tmpdir(), "inline-spill-page-contract-"));
    expect(dirname(root)).toBe(resolve(tmpdir()));
    const preload = join(root, "provider.mjs");
    writeFileSync(preload, `
let calls = 0;
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(init.body);
  const afterRecall = request.input.some(item => item.type === "function_call_output");
  const args = { archive_uri: "invalid-archive", checksum: "invalid-checksum" };
  if (!afterRecall && ++calls % 2 === 0) args.max_chars = 5501;
  const body = afterRecall
    ? { output_text: '{"value":null}', output: [] }
    : { output: [{ type: "function_call", name: "context_archive_recall", call_id: "mock-page-" + calls, arguments: JSON.stringify(args) }] };
  return new Response(JSON.stringify({ ...body, status: "completed", model: "agent-mocked-provider", usage: { input_tokens: 13, output_tokens: 7, total_tokens: 20 } }), { status: 200 });
};
`);
    const output = join(root, "evals");
    const child = spawnSync(process.execPath, [
      resolve("openclaw_runtime/node_modules/tsx/dist/cli.mjs"), "--tsconfig", resolve("openclaw_runtime/tsconfig.json"), "--import", pathToFileURL(preload).href,
      "scripts/context-inline-spill-benefit-loop-eval.mts", "--mode", "live", "--out", output,
      "--repeats", "1", "--max-turns", "2",
    ], { cwd: process.cwd(), env: { ...process.env, CONTEXT_INLINE_SPILL_API_KEY: "agent-test-credential",
      CONTEXT_INLINE_SPILL_BASE_URL: "http://127.0.0.1:1/v1", CONTEXT_INLINE_SPILL_MODEL: "agent-mocked-provider" },
      windowsHide: true, timeout: 60_000, encoding: "utf8" });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(1);
    const run = join(output, readdirSync(output)[0]!);
    const records = JSON.parse(readFileSync(join(run, "runs.json"), "utf8")).records;
    expect(records).toHaveLength(32);
    const pageSizes = new Set<unknown>();
    for (const record of records) {
      expect(record.recallOk).toBe(false);
      expect(record.toolCalls).toHaveLength(1);
      const raw = JSON.parse(record.toolCalls[0].raw_result);
      expect(raw.diagnostics[0].code).toBe("invalid_arguments");
      expect(raw.diagnostics[0].message).toContain("max_chars must be an explicit integer");
      pageSizes.add(record.toolCalls[0].arguments.max_chars);
    }
    expect(pageSizes).toEqual(new Set([undefined, 5501]));
    rmSync(root, { recursive: true, force: true });
  }, 75_000);
});
