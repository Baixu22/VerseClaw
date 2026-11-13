import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVisibleRecallNavigation, VISIBLE_RECALL_NAVIGATION_RULE } from "./context-inline-spill-benefit-strategy.mjs";

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("usage: round8-verify <run-directory> <output.json> [--seal]");
const root = process.cwd(), dir = resolve(directory), out = resolve(output);
const meta = { driven_by: "agent", actor: "codex-g7-inline-spill-tf0749-01a1d34c", realHumanEvidence: false };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
mkdirSync(dirname(out), { recursive: true });
try {
  const result = json(join(dir, "result.json")), records = json(join(dir, "runs.json")).records;
  const pre = json(join(dir, "preflight.json")), freeze = json(resolve(root, pre.designFreeze.path));
  assert(["ContextInlineSpillRound8FrozenDesign/v1", "ContextInlineSpillRound9FrozenDesign/v1"].includes(freeze.schema));
  assert(["navigated", "bookmarked"].includes(result.design.strategy));
  assert.equal(hash(VISIBLE_RECALL_NAVIGATION_RULE), freeze.navigation.ruleSha256);
  const oldRoot = resolve(root, freeze.round7Preservation.path);
  assert.equal(hash(readFileSync(join(oldRoot, "SHA256SUMS"))), freeze.round7Preservation.sha256);
  const oldFiles = readFileSync(join(oldRoot, "SHA256SUMS"), "utf8").trim().split(/\r?\n/);
  for (const line of oldFiles) {
    const [, digest, name] = /^([a-f0-9]{64})  (.+)$/.exec(line) ?? [];
    assert(digest && name); const path = resolve(oldRoot, name); assert(path.startsWith(oldRoot + sep));
    assert.equal(hash(readFileSync(path)), digest, name);
  }
  const previous = json(join(oldRoot, "outcome.json"));
  assert.equal(previous.decision.verdict, "NO_GO");
  for (const key of freeze.round7Preservation.failedBenefitGates) assert.equal(previous.decision[key], false);
  let navigationFrames = 0, fieldLocations = 0;
  const oracles: Record<string, string> = { "deploy-token": "DEPLOY_TOKEN_7f31ab", "db-passport": "DB_PASSPORT_9c02de", "cache-seed": "CACHE_SEED_44aa10",
    "signing-key": "SIGNING_KEY_b71c55", "tenant-id": "TENANT_ID_3d9e77", "migration-hash": "MIGRATION_HASH_a1f4c8" };
  for (const row of records) for (const call of row.providerCalls) {
    navigationFrames++;
    const baseInput = call.request.input.slice(0, -1);
    const expected = buildVisibleRecallNavigation(baseInput);
    assert.deepEqual(call.request.input, expected.input, "navigation input cannot restore other content");
    assert.deepEqual(call.navigation, expected.navigation);
    if (expected.navigation.fieldSourceIndex !== null) fieldLocations++;
    const text = String(call.request.input.at(-1).content), value = oracles[row.fixtureId];
    if (value) assert(!text.includes(value), "navigation copied the private value");
    assert.equal(hash(JSON.stringify(call.request.tools[0])), freeze.toolDefinitionSha256);
  }
  execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "context-inline-spill-benefit-round7-verify.mjs"), dir, out,
    ...(process.argv.includes("--seal") ? ["--seal"] : [])], { stdio: "inherit", windowsHide: true });
  const verified = json(out);
  verified.schema = "ContextInlineSpillRound8Verification/v1";
  verified.navigationFromVisibleInput = { frames: navigationFrames, fieldLocations, sourceInputsRecomputed: true,
    oracleValuesCopied: false, baseInputBytesPreserved: true,
    toolCallsOrigin: verified.mode === "live" ? "actual model function_call responses" : "deterministic scripted policy" };
  verified.round7EvidencePreserved = { files: oldFiles.length, sha256: freeze.round7Preservation.sha256,
    verdict: "NO_GO", failedBenefitGates: freeze.round7Preservation.failedBenefitGates };
  writeFileSync(out, JSON.stringify(verified, null, 2) + "\n");
  console.log(JSON.stringify({ output: out, frames: navigationFrames, fieldLocations, cleanCandidate: verified.B7CleanCandidate,
    status: verified.decision.status, verdict: verified.decision.verdict }));
} catch (error) {
  writeFileSync(out, JSON.stringify({ schema: "ContextInlineSpillRound8Verification/v1", ...meta, passed: false,
    B7CleanCandidate: false, verifierAcceptedCleanCandidate: false, decision: { status: "inconclusive", verdict: "NO_GO", b7_evidence: false }, error: String(error) }, null, 2) + "\n");
  console.error(String(error)); process.exitCode = 1;
}
