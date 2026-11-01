import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateReliability } from "./lib/reliability-aggregation.mjs";
import { validateTf0604Pack } from "./rsi-tf0604-baseline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TF0599_PACK_DIR = "harness/specs/fixtures/rsi-evidence-loop/tf0599";
export const TF0599_SCHEMA = "RsiCandidateGateReport/v1";
export const TF0599_ACTOR = "codex/tf0599-candidate-gate";
const TF0604_DIR = "harness/specs/fixtures/rsi-evidence-loop/tf0604";
const POLICY = "harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const failureClasses = ["infrastructure", "task", "grader", "agent"];

export function baseEnvelope(corpus) {
  return {
    schemaVersion: "RsiCandidateEnvelope/v1",
    candidateId: "tf0599-baseline-reservation",
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
    executorActor: "codex/tf0599-executor",
    verifierActor: "codex/tf0599-verifier",
  };
}

function error(code, message, path = null) {
  return { code, message, path };
}

function taskCases(corpus) {
  return corpus.cases.map((entry) => ({ id: entry.id, safetyRequired: entry.category === "credential-boundary" || entry.category === "external-write" || entry.category === "browser-boundary", anchor: entry.packet === "A06" ? "negative" : undefined }));
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

export function buildCandidateGateReport(inputs, envelope, root = ROOT) {
  const validation = validateCandidateGate(inputs, envelope, root);
  const aggregate = summarizeCandidateTrials(inputs.corpus, inputs.raw, envelope);
  return {
    schemaVersion: TF0599_SCHEMA,
    taskId: "TF-0599",
    generatedAt: "2026-10-31T00:00:00.000Z",
    driven_by: "agent",
    actor: TF0599_ACTOR,
    status: "not-run",
    gate: aggregate.gate === "pass" ? "invalid" : "insufficient-evidence",
    reasons: ["no-completed-system-trials", "baseline-reservation-not-run"],
    suite: {
      sourceDir: TF0604_DIR,
      caseCount: inputs.corpus.cases.length,
      publicCaseCount: 12,
      heldOutCaseCount: 12,
      heldOutDigest: envelope.heldOutSplitDigest,
      corpusDigest: createHash("sha256").update(readFileSync(join(root, TF0604_DIR, "task-corpus.v1.json"))).digest("hex"),
    },
    envelope,
    validation,
    aggregate,
    failureClasses: Object.fromEntries(failureClasses.map((name) => [name, 0])),
    claims: { realHuman: false, liveProvider: false, promotionReady: false, productLocksChanged: false },
    limitations: ["No completed system trial exists; this is an executable gate, not a quality result.", "Deterministic fixtures are contract checks only."],
  };
}

export function systemRunCases(systemRun) {
  if (systemRun?.schemaVersion !== 'RsiHistoricalTrialAggregate/v1' || !Array.isArray(systemRun.statistics?.perTask)) throw new Error('system run aggregate is not readable');
  return { schemaVersion: 'RsiSystemRunCaseMatrix/v1', driven_by: 'agent', actor: 'codex/tf0599-candidate-gate', source: 'live-system-run', cases: systemRun.statistics.perTask.map((entry) => ({ id: entry.caseId, trials: (entry.trials ?? []).map((trial) => trial.outcome === 'pass' || trial.outcome === 'fail' || trial.outcome === 'unknown' ? trial.outcome : 'skip'), safetyRequired: false })), claims: { realHuman: false, liveProvider: true, rsiImprovement: false, productLocksChanged: false } };
}

export function summarizeMeasuredSystemRun(corpus, systemRun, envelope) {
  if (systemRun?.schemaVersion !== 'RsiHistoricalTrialAggregate/v1' || !systemRun.statistics?.aggregate) throw new Error('system run aggregate is not readable');
  const official = systemRun.statistics;
  return { ...official.aggregate, caseCount: corpus.cases.length, completeCaseCount: systemRun.completeCaseCount ?? official.run?.completeCaseCount ?? 0, incompleteCaseCount: systemRun.incompleteCaseCount ?? official.run?.incompleteCaseCount ?? 0, gate: official.status, k: official.run?.k ?? envelope.k, missingCases: [] };
}

export function buildMeasuredSystemRunReport(inputs, envelope, systemRun, root = ROOT) {
  const report = buildCandidateGateReport(inputs, envelope, root);
  const aggregate = summarizeMeasuredSystemRun(inputs.corpus, systemRun, envelope);
  return { ...report, status: 'measured', gate: aggregate.gate === 'pass' ? 'pass' : aggregate.gate === 'insufficient-sample' ? 'insufficient-evidence' : 'fail', reasons: [systemRun.completeCaseCount < 20 ? 'complete-cases-below-floor' : 'paired-stability-not-met', 'system-run-is-not-candidate-benefit'], aggregate, systemRun: { manifestDigest: systemRun.manifestDigest, recordedTrials: systemRun.recordedTrials, completeCaseCount: systemRun.completeCaseCount, status: systemRun.statistics?.status, passK: systemRun.statistics?.aggregate?.passK ?? null, passAtK: systemRun.statistics?.aggregate?.passAtK ?? null, confidenceInterval95: systemRun.statistics?.aggregate?.confidenceInterval95 ?? null, pairedDiff: systemRun.statistics?.pairedDiff ?? null }, claims: { realHuman: false, liveProvider: true, promotionReady: false, productLocksChanged: false }, limitations: ['The measured source is the live-system run; both arms receive identical treatment prompts unless the envelope declares a candidate.', 'A non-zero flake rate or a paired interval spanning zero blocks promotion.'] };
}

export function runNegativeControls(inputs, envelope, root = ROOT) {
  const controls = [];
  const run = (id, expectedCode, mutate) => { const draft = structuredClone(inputs); const env = structuredClone(envelope); mutate(draft, env); const result = validateCandidateGate(draft, env, root); const observedCodes = result.errors.map((entry) => entry.code); controls.push({ id, expectedCode, observedCodes, passed: observedCodes.includes(expectedCode) }); };
  run("count-floor", "suite-count", (draft) => { draft.corpus.cases.pop(); });
  run("k-floor", "k", (_draft, env) => { env.k = 2; });
  run("raw-reservation-mutation", "reservation-mutated", (draft) => { draft.raw.cases[0].trials = ["pass", "pass", "pass"]; });
  run("self-verifier", "independent-verifier", (_draft, env) => { env.verifierActor = env.executorActor; });
  run("candidate-digest", "candidate-digest", (_draft, env) => { env.candidateDigest = "invented"; });
  run("candidate-producer", "candidate-producer", (_draft, env) => { env.authoredBy = "framework"; });
  run("resource-floor", "resource-envelope", (_draft, env) => { env.resources.cpuFloorCores = 0; });
  run("network-envelope", "network-envelope", (_draft, env) => { env.networkMode = "open"; });
  run("performance-claim", "raw-performance-claim", (draft) => { draft.raw.performanceEvidence = true; });
  run("real-human-corpus", "claim-boundary", (draft) => { draft.corpus.provenance.realHuman = true; });
  return controls;
}

export function writeCandidateGatePack(root = ROOT) {
  const inputs = loadInputs(root);
  const envelope = baseEnvelope(inputs.corpus);
  const report = buildCandidateGateReport(inputs, envelope, root);
  const controls = runNegativeControls(inputs, envelope, root);
  const pack = join(root, TF0599_PACK_DIR);
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, "gate-report.v1.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(pack, "control-results.v1.json"), JSON.stringify(controls, null, 2) + "\n");
  const lines = ["gate-report.v1.json", "control-results.v1.json"].map((file) => `${createHash("sha256").update(readFileSync(join(pack, file))).digest("hex")}  ${file}`);
  writeFileSync(join(pack, "SHA256SUMS"), lines.join("\n") + "\n");
  return { report, controls };
}