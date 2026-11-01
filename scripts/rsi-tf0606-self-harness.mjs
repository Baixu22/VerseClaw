import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateReliability } from "./lib/reliability-aggregation.mjs";
import { validateTf0604Pack } from "./rsi-tf0604-baseline.mjs";
import { buildCandidateGateReport, buildMeasuredSystemRunReport, loadInputs as loadGateInputs } from "./rsi-tf0599-candidate-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TF0606_PACK_DIR = "harness/specs/fixtures/rsi-evidence-loop/tf0606";
export const TF0606_SCHEMA = "RsiSelfHarnessReport/v1";
export const TF0606_ACTOR = "codex/tf0606-self-harness";
const TF0604_DIR = "harness/specs/fixtures/rsi-evidence-loop/tf0604";
const POLICY = "harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const failureClasses = ["infrastructure", "task", "grader", "agent"];

export function baseEnvelope(corpus) {
  return {
    schemaVersion: "RsiCandidateEnvelope/v1",
    candidateId: "tf0606-baseline-reservation",
    authoredBy: "self-improvement",
    candidateDigest: "sha256:".concat("0".repeat(64)),
    suiteId: corpus.taskId,
    suiteContentDigest: null,
    heldOutSplitDigest: null,
    k: corpus.protocol.k,
    minimumCompleteCases: corpus.protocol.minimumCompleteCases,
    model: { status: "not-run", id: null, version: null },
    tools: { status: "not-run", manifestDigest: null },
    seed: { status: "not-run", value: null },
    networkMode: "not-run",
    resources: { cpuFloorCores: 1, cpuCeilingCores: 1, memoryFloorBytes: 268435456, memoryCeilingBytes: 4294967296, concurrency: 1, retries: 0 },
    executorActor: "codex/tf0606-executor",
    verifierActor: "codex/tf0606-verifier",
  };
}

function error(code, message, path = null) {
  return { code, message, path };
}

export function loadInputs(root = ROOT) {
  const corpus = readJson(join(root, TF0604_DIR, "task-corpus.v1.json"));
  const raw = readJson(join(root, TF0604_DIR, "raw-trials.v1.json"));
  const policy = readJson(join(root, POLICY));
  return { corpus, raw, policy };
}

export function validateCandidateGate(inputs, envelope, root = ROOT) {
  const errors = [];
  const { corpus, raw, policy } = inputs;
  const pack = validateTf0604Pack(root);
  if (!pack.passed) errors.push(error("tf0604-pack", "sealed TF-0604 pack failed readback"));
  if (corpus?.schemaVersion !== "RsiTf0604TaskCorpus/v1" || corpus.cases.length < 20 || corpus.cases.length !== 24) errors.push(error("suite-count", "candidate must bind the frozen 24-case corpus"));
  if (corpus?.provenance?.realHuman !== false || corpus?.provenance?.realProvider !== false) errors.push(error("claim-boundary", "corpus must remain agent-only"));
  if (envelope?.k !== 3 || corpus?.protocol?.k !== 3) errors.push(error("k", "k must be exactly 3"));
  if (envelope?.minimumCompleteCases !== 20 || corpus?.protocol?.minimumCompleteCases !== 20) errors.push(error("minimum-complete-cases", "minimum complete cases must be 20"));
  if (envelope?.suiteId !== corpus?.taskId) errors.push(error("suite-id", "suite identity does not match"));
  if (!/^sha256:[a-f0-9]{64}$/u.test(envelope?.candidateDigest ?? "")) errors.push(error("candidate-digest", "candidate digest is required"));
  if (!["self-improvement", "rsi-self-improvement"].includes(envelope?.authoredBy)) errors.push(error("candidate-producer", "candidate must be self-improvement authored"));
  if (!envelope?.executorActor || !envelope?.verifierActor || envelope.executorActor === envelope.verifierActor) errors.push(error("independent-verifier", "executor and verifier must be distinct named actors"));
  if (envelope?.model?.status !== "not-run" && !(envelope.model.id && envelope.model.version)) errors.push(error("model-envelope", "model identity must be pinned or explicitly not-run"));
  if (envelope?.tools?.status !== "not-run" && !envelope.tools.manifestDigest) errors.push(error("tool-envelope", "tool manifest must be pinned or explicitly not-run"));
  if (envelope?.seed?.status !== "not-run" && !Number.isInteger(envelope.seed.value)) errors.push(error("seed-envelope", "seed must be fixed or explicitly not-run"));
  if (!["not-run", "offline", "bounded"].includes(envelope?.networkMode)) errors.push(error("network-envelope", "network envelope is invalid"));
  if (!envelope?.resources || envelope.resources.cpuFloorCores < 1 || envelope.resources.cpuCeilingCores < envelope.resources.cpuFloorCores || envelope.resources.memoryFloorBytes < 268435456 || envelope.resources.concurrency < 1 || envelope.resources.retries !== 0) errors.push(error("resource-envelope", "fixed resource envelope is required"));
  const expectedRaw = raw.cases.map((entry) => entry.caseId).sort();
  const actualRaw = raw.cases.map((entry) => entry.caseId).sort();
  if (!same(expectedRaw, actualRaw) || new Set(actualRaw).size !== 24) errors.push(error("raw-case-coverage", "raw reservation must cover each case once"));
  const measured = raw.cases.flatMap((entry) => entry.trials ?? []);
  if (measured.length !== 0) errors.push(error("reservation-mutated", "the sealed TF-0604 raw reservation must remain not-run"));
  if (raw?.performanceEvidence !== false) errors.push(error("raw-performance-claim", "reservation cannot claim performance evidence"));
  if (policy?.taskSet?.minimumCompleteCases !== 20 || policy?.taskSet?.k !== 3) errors.push(error("promotion-policy", "promotion policy floors changed"));
  return { passed: errors.length === 0, errors };
}

export function summarizeCandidateTrials(corpus, raw, envelope) {
  const byCase = new Map(raw.cases.map((entry) => [entry.caseId, entry.trials ?? []]));
  const cases = taskCases(corpus).map((entry) => ({
    ...entry,
    trials: (byCase.get(entry.id) ?? []).map((trial) => typeof trial === "string" ? trial : trial.outcome ?? trial.status),
  }));
  const reliability = aggregateReliability(cases, { k: envelope.k, minCases: envelope.minimumCompleteCases });
  return {
    ...reliability,
    completeCaseCount: reliability.completeCaseCount ?? 0,
    caseCount: cases.length,
    missingCases: cases.filter((entry) => (byCase.get(entry.id) ?? []).length === 0).map((entry) => entry.id),
  };
}

export function mineWeaknesses(corpus) {
  return corpus.cases.slice(0, 24).map((entry) => ({
    id: "weakness:".concat(entry.id),
    taskId: entry.taskId,
    caseId: entry.id,
    taskType: entry.category,
    sourceRefs: entry.sourceRefs,
    evidenceLinks: ["corpus:".concat(entry.id), "source:".concat(entry.sourceRefs[0])],
    failureSignal: "historical-agent-failure-boundary",
    metadata: { title: entry.title },
  }));
}

export function buildCandidate(corpus, weaknesses) {
  const sourceIds = weaknesses.map((entry) => entry.caseId);
  const payload = {
    schemaVersion: "RsiSelfHarnessCandidate/v1",
    candidateId: "candidate-".concat(createHash("sha256").update(JSON.stringify(sourceIds)).digest("hex").slice(0, 20)),
    authoredBy: "rsi-self-improvement",
    surface: "sekb-playbook",
    isolation: "isolated-worktree",
    sourceCaseIds: sourceIds,
    targetTaskTypes: [...new Set(corpus.cases.map((entry) => entry.category))],
    weaknessIds: weaknesses.map((entry) => entry.id),
    change: {
      title: "Compare success and failure before acting",
      prompt: "When a matching prior pair exists, compare the successful and failed path before selecting the next action.",
      sourceTrajectoryIds: ["failure-1", "success-1"],
      rollback: "Remove the unconfirmed playbook candidate; no persisted state is changed.",
      budget: { maxTokens: 200000, maxTurns: 60, maxToolCalls: 200 },
    },
    contentType: "advisory-data",
    autoMerge: false,
    promotionReady: false,
  };
  return { ...payload, digest: "sha256:".concat(createHash("sha256").update(JSON.stringify(payload)).digest("hex")) };
}

export function validateSelfHarness(context) {
  const errors = [];
  const { corpus, weaknesses, candidate, report, gateReport } = context;
  if (corpus.cases.length !== 24) errors.push(error("weakness-count", "must use 24 frozen task cases"));
  if (weaknesses.length !== 24 || new Set(weaknesses.map((entry) => entry.caseId)).size !== 24) errors.push(error("weakness-coverage", "weakness set must cover each task once"));
  if (!["prompt", "agents", "skill", "tool-policy", "sekb-playbook"].includes(candidate.surface)) errors.push(error("candidate-surface", "candidate surface is outside allowed scope"));
  if (candidate.autoMerge !== false) errors.push(error("automatic-merge", "candidate must not auto merge"));
  if (candidate.promotionReady !== false) errors.push(error("promotion-claim", "candidate cannot self-promote"));
  if (!/^sha256:[a-f0-9]{64}$/u.test(candidate.digest)) errors.push(error("candidate-digest", "candidate digest is required"));
  if (candidate.change.sourceTrajectoryIds.length < 2) errors.push(error("contrastive-lineage", "candidate requires success and failure lineage"));
  if (!candidate.change.rollback || candidate.change.budget.maxTokens <= 0) errors.push(error("candidate-envelope", "rollback and positive budgets are required"));
  if (!["not-run", "measured"].includes(gateReport.status) || !["insufficient-evidence", "fail"].includes(gateReport.gate)) errors.push(error("gate-boundary", "delegated gate must be unmeasured or fail its own stability gate"));
  if (report.promotionReady !== false || report.autoMerge !== false) errors.push(error("report-promotion", "report cannot promote or merge"));
  return { passed: errors.length === 0, errors };
}

export function buildSelfHarnessReport(corpus, weaknesses, candidate, gateReport, root = ROOT) {
  return {
    schemaVersion: TF0606_SCHEMA,
    generatedAt: "2026-10-31T00:00:00.000Z",
    driven_by: "agent",
    actor: TF0606_ACTOR,
    status: "insufficient-evidence",
    promotionReady: false,
    autoMerge: false,
    weakenedTaskCount: weaknesses.length,
    candidate,
    evaluation: { delegatedGate: "TF-0599", suite: corpus.taskId, caseCount: corpus.cases.length, completeCaseCount: gateReport.aggregate.completeCaseCount, k: gateReport.envelope.k, passK: gateReport.aggregate.passK, passAtK: gateReport.aggregate.passAtK, costCeilingRelativeIncrease: 0.1, heldOutSplitDigest: gateReport.envelope.heldOutSplitDigest, failureClassCounts: gateReport.failureClasses },
    reasons: gateReport.aggregate?.completeCaseCount >= 20 ? ["measured-system-run-not-a-candidate-benefit", "candidate-not-run-on-held-out"] : ["no-completed-system-trials", "candidate-not-run-on-held-out"],
    claims: { realHuman: false, liveProvider: false, promotionReady: false, autoMerge: false, productLocksChanged: false },
    sourceDigests: { corpus: createHash("sha256").update(readFileSync(join(root, TF0604_DIR, "task-corpus.v1.json"))).digest("hex"), gate: createHash("sha256").update(readFileSync(join(root, "harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json"))).digest("hex") },
  };
}

export function runSelfHarnessNegativeControls(context) {
  const controls = [];
  const add = (id, expectedCode, mutate) => { const draft = structuredClone(context); mutate(draft); const result = validateSelfHarness(draft); const observedCodes = result.errors.map((entry) => entry.code); controls.push({ id, expectedCode, observedCodes, passed: observedCodes.includes(expectedCode) }); };
  add("missing-task-weakeness", "weakness-coverage", (draft) => { draft.weaknesses.pop(); });
  add("unsafe-surface", "candidate-surface", (draft) => { draft.candidate.surface = "runtime-code"; });
  add("auto-merge", "automatic-merge", (draft) => { draft.candidate.autoMerge = true; });
  add("self-promote", "promotion-claim", (draft) => { draft.candidate.promotionReady = true; });
  add("missing-contrast", "contrastive-lineage", (draft) => { draft.candidate.change.sourceTrajectoryIds = ["failure-1"]; });
  add("non-not-run-gate", "gate-boundary", (draft) => { draft.gateReport.gate = "pass"; });
  add("report-promotes", "report-promotion", (draft) => { draft.report.promotionReady = true; });
  return controls;
}

export function writeSelfHarnessPack(root = ROOT) {
  const inputs = loadGateInputs(root);
  const weaknesses = mineWeaknesses(inputs.corpus);
  const candidate = buildCandidate(inputs.corpus, weaknesses);
  const systemRun = existsSync(join(root, "harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/aggregate.json")) ? JSON.parse(readFileSync(join(root, "harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/aggregate.json"), "utf8")) : null;
  const envelope = { ...baseEnvelope(inputs.corpus), candidateId: candidate.candidateId, candidateDigest: candidate.digest, heldOutSplitDigest: systemRun?.suite?.heldOutDigest ?? "sha256:".concat("1".repeat(64)), executorActor: "codex/tf0606-candidate", verifierActor: "codex/tf0606-verifier" };
  const gateReport = systemRun ? buildMeasuredSystemRunReport(inputs, envelope, systemRun, root) : buildCandidateGateReport(inputs, envelope, root);
  const report = buildSelfHarnessReport(inputs.corpus, weaknesses, candidate, gateReport, root);
  const context = { corpus: inputs.corpus, weaknesses, candidate, report, gateReport };
  const controls = runSelfHarnessNegativeControls(context);
  const validation = validateSelfHarness(context);
  const pack = join(root, TF0606_PACK_DIR);
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, "candidate.v1.json"), JSON.stringify(candidate, null, 2) + "\n");
  writeFileSync(join(pack, "report.v1.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(pack, "control-results.v1.json"), JSON.stringify(controls, null, 2) + "\n");
  const files = ["candidate.v1.json", "report.v1.json", "control-results.v1.json"];
  const lines = files.map((file) => createHash("sha256").update(readFileSync(join(pack, file))).digest("hex").concat("  ", file));
  writeFileSync(join(pack, "SHA256SUMS"), lines.join("\n") + "\n");
  return { report, candidate, weaknesses, controls, validation };
}
