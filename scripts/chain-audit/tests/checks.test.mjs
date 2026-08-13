import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildTaskChecks, validateCheckNames, declaredChecks } from "../lib/checks.js";

function statsWith({ calls = [], answer = "", modelRounds = 1 }) {
  return { toolCalls: calls, answerText: answer, modelRounds };
}

test("tools.<name> requires a successful result by default (fail closed)", () => {
  const stats = statsWith({
    calls: [
      { name: "exec", ok: false, isError: true, resultPreview: "exec denied" },
      { name: "read", ok: true, isError: false, resultPreview: "ok" },
    ],
  });
  const r = buildTaskChecks({
    task: { id: "t", checks: ["tools.exec", "tools.read"], expectTools: [] },
    stats, transcriptRaw: "", workspace: "",
  });
  assert.equal(r.checks["tools.exec"], false, "an errored tool must not count as success");
  assert.equal(r.checks["tools.read"], true);
  assert.deepEqual(r.criticalFailed, []);
});

test("toolModes.call downgrades a probe to call-only", () => {
  const stats = statsWith({ calls: [{ name: "exec", ok: false, isError: true, resultPreview: "denied" }] });
  const r = buildTaskChecks({
    task: { id: "t", checks: ["tools.exec"], toolModes: { exec: "call" } },
    stats, transcriptRaw: "", workspace: "",
  });
  assert.equal(r.checks["tools.exec"], true);
});

test("hasAnswer requires both model round and real answer text", () => {
  const noRounds = buildTaskChecks({
    task: { id: "t", checks: ["hasAnswer"] },
    stats: statsWith({ answer: "hi", modelRounds: 0 }), transcriptRaw: "", workspace: "",
  });
  assert.equal(noRounds.checks.hasAnswer, false);
  const noText = buildTaskChecks({
    task: { id: "t", checks: ["hasAnswer"] },
    stats: statsWith({ answer: "  ", modelRounds: 1 }), transcriptRaw: "", workspace: "",
  });
  assert.equal(noText.checks.hasAnswer, false);
});

test("answerContains / fileCheck / memory.available evaluate real evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "chain-audit-checks-"));
  const file = join(dir, "keep.txt");
  writeFileSync(file, "hello world\n", "utf8");

  const stats = statsWith({
    answer: "JForum discussion board",
    calls: [
      { name: "memory_search", ok: true, isError: false, resultPreview: "2 results" },
    ],
  });
  const r = buildTaskChecks({
    task: {
      id: "t",
      checks: ["hasAnswer", "answerContains.0", "fileCheck.present", "fileCheck.shape", "memory.available"],
      answerContains: ["JForum"],
      fileChecks: [
        { label: "present", path: "keep.txt", state: "exists" },
        { label: "shape", path: "keep.txt", positive: ["hello"], negative: ["bye"] },
      ],
    },
    stats, transcriptRaw: "", workspace: dir,
  });
  assert.equal(r.checks["answerContains.0"], true);
  assert.equal(r.checks["fileCheck.present"], true);
  assert.equal(r.checks["fileCheck.shape"], true);
  assert.equal(r.checks["memory.available"], true);
  rmSync(dir, { recursive: true, force: true });
});

test("unknown declared checks are rejected before any run", () => {
  assert.throws(
    () => validateCheckNames({ id: "t", checks: ["ghost.check"], expectTools: [] }),
    /ghost\.check/,
  );
  assert.deepEqual(declaredChecks({ checks: [] }), ["hasAnswer"]);
});
