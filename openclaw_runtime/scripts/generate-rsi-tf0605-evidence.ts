import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSekbDeltaComparison, extractSekbDeltaPlaybook } from "../src/knowledge/sekb/delta-playbook.js";
import type { Trajectory } from "../src/knowledge/sekb/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pack = join(root, "harness/specs/fixtures/rsi-evidence-loop/tf0605");
const actor = "codex/tf0605-delta-playbook";
const generatedAt = "2026-10-31T10:30:00.000Z";
const base = (id: string, outcome: "success" | "failure", taskType = "coding/repair", intent = "repair failed build"): Trajectory => ({
  trajectory_id: id,
  created_at: "2026-10-31T00:00:00.000Z",
  task_intent: intent,
  task_type: taskType,
  context_fingerprint: ["typescript", "build"],
  steps: [
    { action: "tool.call", input: { command: "pnpm test" }, output: {}, timestamp: "2026-10-31T00:00:01.000Z" },
    { action: "tool.result", input: {}, output: { ok: outcome === "success" }, timestamp: "2026-10-31T00:00:02.000Z" },
  ],
  outcome,
  error_signature: outcome === "failure" ? "TypeError::build_failed::typescript" : null,
  cost: { tokens: 20, duration_seconds: 2, retries: 0 },
  distilled: false,
  distilled_into: [],
  expires_at: null,
  metadata: {},
});
const inputs = [base("failure-1", "failure"), base("success-1", "success")];
const report = extractSekbDeltaPlaybook({ trajectories: inputs, existingPrinciples: [], actor, now: () => new Date(generatedAt) });
const comparison = buildSekbDeltaComparison({ baseline: inputs, delta: inputs, actor });
const controlResults = [
  { id: "unpaired-success", passed: extractSekbDeltaPlaybook({ trajectories: [inputs[1]], existingPrinciples: [], actor }).candidates.length === 0 },
  { id: "unsafe-payload", passed: extractSekbDeltaPlaybook({ trajectories: [base("unsafe", "success", "coding/repair", "sk-secretvalue"), inputs[0]], existingPrinciples: [], actor }).candidates.length === 0 },
  { id: "duplicate-source", passed: extractSekbDeltaPlaybook({ trajectories: [inputs[0], { ...inputs[0], outcome: "success" }], existingPrinciples: [], actor }).candidates.length === 0 },
  { id: "cross-task", passed: extractSekbDeltaPlaybook({ trajectories: [inputs[0], base("other", "success", "other/task")], existingPrinciples: [], actor }).candidates.length === 0 },
  { id: "candidate-not-promoted", passed: report.promotionReady === false && report.candidates.every((entry) => entry.promotionReady === false) },
  { id: "benefit-not-claimed", passed: comparison.status === "measured-structure-only" && comparison.adoptionSuccess.status === "unavailable" },
];
const evidence = {
  schemaVersion: "RsiTf0605DeltaEvidence/v1",
  taskId: "TF-0605",
  generatedAt,
  driven_by: "agent",
  actor,
  source: {
    module: "openclaw_runtime/src/knowledge/sekb/delta-playbook.ts",
    tests: "openclaw_runtime/src/knowledge/sekb/delta-playbook.test.ts",
    storage: "existing SEKB SQLite KnowledgeStore only",
    runtimeWrites: false,
    providerCalls: 0,
  },
  report,
  comparison,
  controlResults,
  claims: { realHuman: false, benefitVerified: false, promotionReady: false, productLocksChanged: false },
};
mkdirSync(pack, { recursive: true });
const write = (name: string, value: unknown) => writeFileSync(join(pack, name), JSON.stringify(value, null, 2) + "\n", "utf8");
write("delta-playbook-report.v1.json", report);
write("comparison-report.v1.json", comparison);
write("control-results.v1.json", controlResults);
write("evidence.v1.json", evidence);
const files = ["delta-playbook-report.v1.json", "comparison-report.v1.json", "control-results.v1.json", "evidence.v1.json"];
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(join(pack, "SHA256SUMS"), files.map((file) => `${hash(join(pack, file))}  ${file}`).join("\n") + "\n", "utf8");
const expected = new Map(readFileSync(join(pack, "SHA256SUMS"), "utf8").trim().split("\n").map((line) => [line.slice(66), line.slice(0, 64)]));
const errors = files.filter((file) => expected.get(file) !== hash(join(pack, file))).map((file) => `hash:${file}`);
if (errors.length || !controlResults.every((entry) => entry.passed) || report.status !== "candidate") {
  console.error(JSON.stringify({ errors, controls: controlResults }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ passed: true, candidates: report.candidates.length, pairs: report.pairs.length, controls: controlResults.length, comparisonStatus: comparison.status }, null, 2));
}
