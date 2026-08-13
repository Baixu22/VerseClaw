import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeTranscript } from "../lib/monitor.js";

function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), "chain-audit-monitor-"));
  const p = join(dir, "session.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return p;
}

test("links tool calls to results via toolCallId and reports success/error", () => {
  const p = writeTranscript([
    { type: "message", message: { role: "user", content: [{ type: "text", text: "probe" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { file: "a" } }], usage: { input: 10, output: 5, cacheRead: 0, cost: { total: 0.001 } } } },
    { type: "message", message: { role: "toolResult", toolCallId: "call_1", toolName: "read", isError: false, content: [{ type: "text", text: "ok" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call_2", name: "exec", arguments: { command: "ls" } }], usage: { input: 10, output: 5, cacheRead: 0, cost: { total: 0.001 } } } },
    { type: "message", message: { role: "toolResult", toolCallId: "call_2", toolName: "exec", isError: true, content: [{ type: "text", text: "exec denied" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 10, output: 5, cacheRead: 0, cost: { total: 0.001 } } } },
  ]);
  const s = analyzeTranscript(p);
  assert.equal(s.toolCalls.length, 2);
  assert.equal(s.toolCalls[0].name, "read");
  assert.equal(s.toolCalls[0].ok, true);
  assert.equal(s.toolCalls[1].name, "exec");
  assert.equal(s.toolCalls[1].ok, false);
  assert.equal(s.errorCount, 1);
  assert.equal(s.answerText, "done");
  assert.equal(s.complete, true);
  rmSync(p, { force: true });
});

test("excludes NO_REPLY sentinel from answer text", () => {
  const p = writeTranscript([
    { type: "message", message: { role: "user", content: [{ type: "text", text: "probe" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "real answer" }], usage: { input: 1, output: 1, cost: { total: 0 } } } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }], usage: { input: 1, output: 1, cost: { total: 0 } } } },
  ]);
  const s = analyzeTranscript(p);
  assert.equal(s.answerText, "real answer");
  assert.equal(s.complete, true);
  rmSync(p, { force: true });
});
