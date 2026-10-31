import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, lstatSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateTf0604Pack } from "./rsi-tf0604-baseline.mjs";
import { validateAdjudicationPack } from "./rsi-tf0608-adjudication.mjs";
import { checkTf0609Evidence } from "./rsi-tf0609-code-self-modification.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TF0610_SCHEMA = "RsiCapabilityEvidenceReport/v1";
export const TF0610_ACTOR = "codex/tf0610-capability-reporter";
const PATH = "harness/specs/fixtures/rsi-evidence-loop/capability-evidence.v1.json";
const TS_PATH = "harness/specs/fixtures/rsi-evidence-loop/capability-evidence.d.ts";
const SOURCE_PATHS = [
  "harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0604/aggregate.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0605/delta-playbook-report.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0605/comparison-report.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0606/report.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0607/gate-report.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0608/verdict.v1.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0609/eligibility.v1.json",
  "harness/specs/fixtures/agent-first-system/trials/acceptance.json",
  "harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/aggregate.json",
];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const err = (code, message) => ({ code, message });
function regularFile(root, relative) {
  const base = resolve(root);
  const full = resolve(base, relative);
  if (full !== base && !full.startsWith(base + sep)) throw new Error(`path escapes root: ${relative}`);
  const st = lstatSync(full);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`not a regular file: ${relative}`);
  return full;
}
function verifyManifest(root, name, files) {
  const dir = `harness/specs/fixtures/rsi-evidence-loop/${name}`;
  const errors = [];
  try {
    if (!same(readdirSync(resolve(root, dir)).sort(), [...files, "SHA256SUMS"].sort())) errors.push(err("pack-file-coverage", `${name} has extra or missing files`));
    const seen = [];
    for (const line of readFileSync(regularFile(root, `${dir}/SHA256SUMS`), "utf8").trimEnd().split(/\r?\n/u)) {
      const m = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
      if (!m) { errors.push(err("sha256sums-format", `${name} manifest has malformed line`)); continue; }
      seen.push(m[2]);
      if (sha256(readFileSync(regularFile(root, `${dir}/${m[2]}`))) !== m[1]) errors.push(err("digest-mismatch", `${name}/${m[2]}`));
    }
    if (!same(seen.sort(), [...files].sort())) errors.push(err("sha256sums-coverage", `${name} manifest coverage differs`));
  } catch (e) {
    errors.push(err("missing-pack", `${name}: ${e.message}`));
  }
  return errors;
}
const FALSE_CLAIMS = { realHuman: false, liveProvider: false, promotionReady: false, productLocksChanged: false };

export function buildCapabilityEvidence(root = ROOT) {
  const tf0604 = validateTf0604Pack(root);
  const tf0608 = validateAdjudicationPack(root);
  const tf0609 = checkTf0609Evidence(root);
  const values = Object.fromEntries(SOURCE_PATHS.map((p) => [p, readJson(regularFile(root, p))]));
  const matrix = values["harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json"];
  const baseline = values["harness/specs/fixtures/rsi-evidence-loop/tf0604/aggregate.v1.json"];
  const gate = values["harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json"];
  const delta = values["harness/specs/fixtures/rsi-evidence-loop/tf0605/delta-playbook-report.v1.json"];
  const sb = values["harness/specs/fixtures/rsi-evidence-loop/tf0605/comparison-report.v1.json"];
  const research = values["harness/specs/fixtures/rsi-evidence-loop/tf0606/report.v1.json"];
  const contamination = values["harness/specs/fixtures/rsi-evidence-loop/tf0607/gate-report.v1.json"];
  const adjudication = values["harness/specs/fixtures/rsi-evidence-loop/tf0608/verdict.v1.json"];
  const eligibility = values["harness/specs/fixtures/rsi-evidence-loop/tf0609/eligibility.v1.json"];
  const trial = values["harness/specs/fixtures/agent-first-system/trials/acceptance.json"];
  const systemRun = values["harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/aggregate.json"];
  const residuals = [];
  if (baseline.completeCaseCount < 20) residuals.push({ code: "tf0604-baseline-incomplete", owner: "RSI evaluation owner (agent)", reviewTrigger: "run the frozen corpus with a fixed provider/tool/resource envelope until >=20 complete cases at k=3 are sealed" });
  if (!/^sha256:[a-f0-9]{64}$/u.test(gate.suite?.heldOutDigest ?? "")) residuals.push({ code: "held-out-digest-unsealed", owner: "RSI evaluation owner (agent)", reviewTrigger: "freeze a real 12-case held-out digest and bind it into TF-0599, TF-0606 and TF-0609 coherently" });
  if (adjudication.verdict !== "promote") residuals.push({ code: "independent-verdict-not-promote", owner: "independent RSI verifier (agent)", reviewTrigger: "re-adjudicate from complete, sealed system evidence before any bounded code trial" });
  if (contamination.limitations?.includes("Behavioral effects remain not-run.")) residuals.push({ code: "stage3-behavioral-rollback-unproven", owner: "stage-3 owner (agent)", reviewTrigger: "execute a real agent-driven rollback and parity drill against the frozen candidate and baseline" });
  if (eligibility.decision !== "go") residuals.push({ code: "tf0609-no-go", owner: "RSI evaluation owner (agent)", reviewTrigger: "rerun TF-0609 after 20 complete cases, paired statistics and behavioral rollback exist" });
  residuals.push({ code: "task-forest-export-large", owner: "task-forest maintainer (agent)", reviewTrigger: "implement bounded projected-history export while preserving full snapshot history; current local export is retained only as a diagnosed artifact" });
  const layers = matrix.layers.map((layer) => ({
    id: layer.id,
    title: layer.title,
    capabilityVerdict: layer.id === "experience-loop" ? "partial" : "not-run",
    implementation: layer.id === "experience-loop" ? "flag-gated SEKB plus offline evaluation utilities" : "no production self-modification capability",
    evidenceLevels: layer.id === "experience-loop" ? { source: "present", engineering: "present", runtime: "partial", effect: "not-run" } : { source: "absent", engineering: "gate-only", runtime: "absent", effect: "not-run" },
    evidence: layer.stages.map((stage) => ({ id: stage.id, verdict: stage.verdict, status: stage.status, effect: stage.evidence?.effect?.status ?? "not-run" })),
  }));
  const gates = [
    { id: "TF-0604", path: "harness/specs/fixtures/rsi-evidence-loop/tf0604/aggregate.v1.json", status: baseline.status, verdict: baseline.status === "pass" ? "pass" : "insufficient-evidence", evidence: { completeCaseCount: baseline.completeCaseCount, caseCount: baseline.corpusCaseCount, passK: baseline.passK, passAtK: baseline.passAtK }, controls: 8 },
    { id: "TF-0599", path: "harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json", status: gate.status, verdict: gate.gate, evidence: { caseCount: gate.aggregate?.caseCount, completeCaseCount: gate.aggregate?.completeCaseCount, k: gate.envelope?.k, heldOutDigest: gate.suite?.heldOutDigest }, controls: 10 },
    { id: "TF-0605", path: "harness/specs/fixtures/rsi-evidence-loop/tf0605/delta-playbook-report.v1.json", status: delta.status, verdict: "candidate-not-evaluated", evidence: { pairs: delta.pairs?.length, candidates: delta.candidates?.length, promotionReady: delta.promotionReady }, controls: 6 },
    { id: "TF-0606", path: "harness/specs/fixtures/rsi-evidence-loop/tf0606/report.v1.json", status: research.status, verdict: research.status, evidence: { weakenedTaskCount: research.weakenedTaskCount, completeCaseCount: research.evaluation?.completeCaseCount, passK: research.evaluation?.passK }, controls: 7 },
    { id: "TF-0607", path: "harness/specs/fixtures/rsi-evidence-loop/tf0607/gate-report.v1.json", status: contamination.status, verdict: "static-only", evidence: { staticValidation: contamination.validation?.passed, behavioralEffects: "not-run" }, controls: 10 },
    { id: "TF-0608", path: "harness/specs/fixtures/rsi-evidence-loop/tf0608/verdict.v1.json", status: adjudication.verdict, verdict: adjudication.disposition, evidence: { completeCaseCount: adjudication.recomputed?.completeCaseCount, passK: adjudication.recomputed?.passK, heldOutDigest: adjudication.recomputed?.heldOutDigest }, controls: 12 },
    { id: "TF-0609", path: "harness/specs/fixtures/rsi-evidence-loop/tf0609/eligibility.v1.json", status: eligibility.decision, verdict: eligibility.decision === "go" ? "go" : "no-go", evidence: { codeCandidateGenerated: eligibility.codeCandidateGenerated, codeCandidateExecuted: eligibility.codeCandidateExecuted, residualCount: eligibility.residuals?.length }, controls: 8 },
  ];
  const checks = {
    tf0604: tf0604.passed,
    tf0608: tf0608.passed,
    tf0609: tf0609.passed,
    agentFirstTrialSummary: trial.protocol?.completeCaseCount === 24 && trial.claims?.rsiImprovement === false,
    tf0604SystemRunReadback: systemRun.schemaVersion === "RsiHistoricalTrialAggregate/v1" && systemRun.claims?.realHuman === false && systemRun.claims?.rsiImprovement === false,
    noCompleteRsiClaim: matrix.currentState?.completeRsiImplementation === false,
    allClaimsBounded: [gate.claims, research.claims, contamination.claims, adjudication.claims, eligibility.claims].every((claims) => claims && claims.realHuman === false && claims.promotionReady === false),
  };
  return {
    schemaVersion: TF0610_SCHEMA,
    taskId: "TF-0610",
    generatedAt: "2026-10-31T00:00:00.000Z",
    driven_by: "agent",
    actor: TF0610_ACTOR,
    overall: { engineeringClosure: "complete", rsiCapability: "not-complete", evidenceDecision: "insufficient-evidence", codeSelfModification: eligibility.decision },
    executionSummary: { taskForestBaselineCompleteCases: baseline.completeCaseCount, candidateCompleteCases: gate.aggregate?.completeCaseCount ?? 0, systemTrialSummaryCompleteCases: trial.protocol?.completeCaseCount ?? 0, systemTrialKind: "script-provider-equivalent replay, not RSI-model benefit", systemRunRecordedTrials: systemRun.recordedTrials, systemRunCompleteCaseCount: systemRun.completeCaseCount, systemRunStatus: systemRun.statistics?.status ?? null,
systemRunPassK: systemRun.statistics?.aggregate?.passK ?? null, systemRunPassAtK: systemRun.statistics?.aggregate?.passAtK ?? null, systemRunConfidenceInterval95: systemRun.statistics?.aggregate?.confidenceInterval95 ?? null, systemRunPairedDiffStatus: systemRun.statistics?.pairedDiff?.status ?? null, systemRunPairedDiff: systemRun.statistics?.pairedDiff?.passKDelta ?? null, heldOutDigest: gate.suite?.heldOutDigest ?? null, codeCandidateGenerated: false, codeCandidateExecuted: false },
    layers,
    gates,
    checks,
    residuals,
    sourceFiles: SOURCE_PATHS.map((path) => ({ path, digest: sha256(readFileSync(regularFile(root, path))) })),
    claims: { completeRsiImplementation: false, rsiBenefit: false, realHuman: false, liveProvider: false, promotionReady: false, productLocksChanged: false },
    limitations: ["The 144 script-provider trials are execution/statistics evidence and replay the same candidate in both arms; they do not establish model-quality or RSI benefit.",
      "TF-0604 real system-run evidence is retained at harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run and holds fewer than the 20 complete cases required to expose pass^k or a paired interval.", "No production RSI capability, automatic experience write-back, code self-modification trial or product promotion is claimed.", "The TF-0609 No-Go is a start-eligibility decision, not a measured negative performance result.", "Task Forest validate/export must be checked separately; its local history currently creates a very large HTML/timeline artifact."],
  };
}

export function validateCapabilityEvidence(root = ROOT) {
  const errors = [];
  let report;
  try { report = readJson(regularFile(root, PATH)); } catch (e) { return { passed: false, errors: [err("missing-report", e.message)] }; }
  const expected = buildCapabilityEvidence(root);
  if (!same(report, expected)) errors.push(err("report-recomputation", "capability evidence differs from current upstream evidence"));
  if (!Object.values(expected.checks).every(Boolean)) errors.push(err("upstream-check-failed", "one or more capability report prerequisites failed"));
  if (expected.claims.completeRsiImplementation !== false || expected.claims.rsiBenefit !== false || expected.claims.realHuman !== false || expected.claims.liveProvider !== false || expected.claims.promotionReady !== false || expected.claims.productLocksChanged !== false) errors.push(err("claim-boundary", "capability report exceeded its evidence boundary"));
  if (expected.residuals.length < 6) errors.push(err("residual-incomplete", "residual set is incomplete"));
  return { passed: errors.length === 0, errors, report };
}

export function writeCapabilityEvidence(root = ROOT) {
  const report = buildCapabilityEvidence(root);
  const full = join(root, PATH);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(root, TS_PATH), `export type RsiCapabilityEvidence = { schemaVersion: string; taskId: string; generatedAt: string; driven_by: "agent"; actor: string; overall: Record<string, string>; executionSummary: Record<string, unknown>; layers: unknown[]; gates: unknown[]; checks: Record<string, boolean>; residuals: Array<{ code: string; owner: string; reviewTrigger: string }>; sourceFiles: Array<{ path: string; digest: string }>; claims: Record<string, boolean>; limitations: string[] };\n`);
  return validateCapabilityEvidence(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) { console.error("usage: node scripts/rsi-tf0610-capability-report.mjs --write|--check"); process.exitCode = 2; }
  else {
    const result = write ? writeCapabilityEvidence() : validateCapabilityEvidence();
    console.log(JSON.stringify({ passed: result.passed, errors: result.errors, overall: result.report?.overall, residuals: result.report?.residuals?.length }, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
}