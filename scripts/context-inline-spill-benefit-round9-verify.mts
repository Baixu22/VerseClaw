import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { appendVisibleExecBookmark, VISIBLE_EXEC_BOOKMARK_MAX_CHARS } from "./context-inline-spill-benefit-strategy.mjs";

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("usage: round9-verify <run-directory> <output.json> [--seal]");
const root = process.cwd(), dir = resolve(directory), out = resolve(output);
const meta = { driven_by: "agent", actor: "codex-g7-inline-spill-tf0749-01a1d34c", realHumanEvidence: false };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
mkdirSync(dirname(out), { recursive: true });
try {
  const result = json(join(dir, "result.json")), rows = json(join(dir, "runs.json")).records;
  const pre = json(join(dir, "preflight.json")), freeze = json(join(root, pre.designFreeze.path));
  assert.equal(freeze.schema, "ContextInlineSpillRound9FrozenDesign/v1");
  assert.equal(result.design.strategy, "bookmarked");
  assert.equal(result.design.deterministicFault, "none");
  assert.equal(freeze.bookmark.maxChars, VISIBLE_EXEC_BOOKMARK_MAX_CHARS);
  const oldRoot = resolve(root, freeze.round8Preservation.path);
  assert.equal(hash(readFileSync(join(oldRoot, "SHA256SUMS"))), freeze.round8Preservation.sha256);
  const oldFiles = readFileSync(join(oldRoot, "SHA256SUMS"), "utf8").trim().split(/\r?\n/);
  for (const line of oldFiles) {
    const [, digest, name] = /^([a-f0-9]{64})  (.+)$/.exec(line) ?? [];
    assert(digest && name); const path = resolve(oldRoot, name); assert(path.startsWith(oldRoot + sep));
    assert.equal(hash(readFileSync(path)), digest, name);
  }
  const oldOutcome = json(join(oldRoot, "outcome.json"));
  assert.equal(oldOutcome.decision.verdict, "NO_GO");
  for (const gate of freeze.round8Preservation.failedBenefitGates) assert.equal(oldOutcome.decision[gate], false);
  let bookmarks = 0, maxAddedChars = 0;
  for (const row of rows) {
    const expected = appendVisibleExecBookmark(row.fixtureQuestion, row.initialVisibleExecText);
    assert.equal(row.initialQuestion, expected);
    const added = expected.slice(row.fixtureQuestion.length);
    maxAddedChars = Math.max(maxAddedChars, added.length);
    assert(added.length <= VISIBLE_EXEC_BOOKMARK_MAX_CHARS);
    const first = String(row.providerCalls[0].request.input[0].content);
    assert(first.includes(row.initialVisibleExecText), "bookmark source was not actually visible at first request");
    if (row.arm === "baseline-no-reference") {
      assert.equal(expected, row.fixtureQuestion); assert(!added.includes("context-archive://"));
    } else {
      bookmarks++; assert(added.includes(row.archive.uri)); assert(added.includes(row.archive.checksum));
    }
    for (const call of row.providerCalls) assert(String(call.request.input[0].content).includes(expected), "bookmark must remain in actual current production projection");
  }
  execFileSync(process.execPath, [join(root, "openclaw_runtime/node_modules/tsx/dist/cli.mjs"),
    join(dirname(fileURLToPath(import.meta.url)), "context-inline-spill-benefit-round8-verify.mts"), dir, out,
    ...(process.argv.includes("--seal") ? ["--seal"] : [])], { stdio: "inherit", windowsHide: true });
  const facts = json(out);
  facts.schema = "ContextInlineSpillRound9Verification/v1";
  facts.visibleBookmark = { runs: bookmarks, maxAddedChars, source: "initially visible exec reference in existing agent question",
    allCurrentQuestionsRecomputed: true, payloadCopied: false, modelArgumentsRewritten: false };
  facts.round8EvidencePreserved = { files: oldFiles.length, sha256: freeze.round8Preservation.sha256, verdict: "NO_GO", failedBenefitGates: freeze.round8Preservation.failedBenefitGates };
  writeFileSync(out, JSON.stringify(facts, null, 2) + "\n");
  console.log(JSON.stringify({ output: out, bookmarks, maxAddedChars, clean: facts.B7CleanCandidate, status: facts.decision.status, verdict: facts.decision.verdict }));
} catch (error) {
  writeFileSync(out, JSON.stringify({ schema: "ContextInlineSpillRound9Verification/v1", ...meta, passed: false,
    B7CleanCandidate: false, verifierAcceptedCleanCandidate: false, decision: { status: "inconclusive", verdict: "NO_GO", b7_evidence: false }, error: String(error) }, null, 2) + "\n");
  console.error(String(error)); process.exitCode = 1;
}
