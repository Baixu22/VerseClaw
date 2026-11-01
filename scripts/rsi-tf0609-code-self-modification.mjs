import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, lstatSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateTf0604Pack } from "./rsi-tf0604-baseline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TF0609_PACK_DIR = "harness/specs/fixtures/rsi-evidence-loop/tf0609";
export const TF0609_SCHEMA = "RsiCodeSelfModificationEligibility/v1";
export const TF0609_ACTOR = "codex/tf0609-eligibility-reviewer";
const MIN_CASES = 20;
const K = 3;
const SUMS = {
  tf0604: ["task-corpus.v1.json", "negative-controls.v1.json", "raw-trials.v1.json", "aggregate.v1.json", "negative-control-results.v1.json", "validation-report.v1.json"],
  tf0599: ["gate-report.v1.json", "control-results.v1.json"],
  tf0606: ["candidate.v1.json", "report.v1.json", "control-results.v1.json"],
  tf0607: ["gate-report.v1.json", "control-results.v1.json"],
  tf0608: ["verdict.v1.json", "control-results.v1.json"],
  tf0609: ["eligibility.v1.json", "control-results.v1.json", "behavioral-rollback-receipt.v1.json"],
};
const PATHS = {
  baseline: "harness/specs/fixtures/rsi-evidence-loop/tf0604/aggregate.v1.json",
  gate: "harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json",
  candidate: "harness/specs/fixtures/rsi-evidence-loop/tf0606/candidate.v1.json",
  research: "harness/specs/fixtures/rsi-evidence-loop/tf0606/report.v1.json",
  contamination: "harness/specs/fixtures/rsi-evidence-loop/tf0607/gate-report.v1.json",
  adjudication: "harness/specs/fixtures/rsi-evidence-loop/tf0608/verdict.v1.json",
  policy: "harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json",
  comparison: "harness/specs/fixtures/rsi-evidence-loop/tf0609/paired-comparison.v1.json",
  rollback: "harness/specs/fixtures/rsi-evidence-loop/tf0609/behavioral-rollback-receipt.v1.json",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const issue = (code, message) => ({ code, message });
const falseClaims = (claims) => claims && Object.values(claims).every((value) => value === false);

function regularFile(root, relativePath) {
  const base = resolve(root);
  const full = resolve(base, relativePath);
  if (full !== base && !full.startsWith(base + sep)) throw new Error(`path escapes root: ${relativePath}`);
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`input is not a regular file: ${relativePath}`);
  return full;
}

function optionalFile(root, relativePath) {
  try {
    const full = regularFile(root, relativePath);
    const bytes = readFileSync(full);
    return { path: relativePath, digest: sha256(bytes), value: JSON.parse(bytes.toString("utf8")), present: true };
  } catch {
    return { path: relativePath, digest: null, value: null, present: false };
  }
}

function verifyPack(root, name, files) {
  const errors = [];
  const directory = `harness/specs/fixtures/rsi-evidence-loop/${name}`;
  try {
    const absolute = resolve(root, directory);
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("pack is not a regular directory");
    const expectedFiles = [...files, "SHA256SUMS"].sort();
    if (!same(readdirSync(absolute).sort(), expectedFiles)) errors.push(issue("pack-file-coverage", `${name} contains unexpected or missing files`));
    const lines = readFileSync(regularFile(root, `${directory}/SHA256SUMS`), "utf8").trimEnd().split(/\r?\n/u);
    const entries = lines.map((line) => {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
      return match ? { digest: match[1], name: match[2] } : null;
    });
    const names = entries.filter(Boolean).map((entry) => entry.name);
    if (entries.some((entry) => entry === null) || new Set(names).size !== files.length || !same([...names].sort(), [...files].sort())) errors.push(issue("sha256sums-coverage", `${name} manifest does not cover exactly its retained files`));
    for (const entry of entries.filter(Boolean)) {
      const bytes = readFileSync(regularFile(root, `${directory}/${entry.name}`));
      if (sha256(bytes) !== entry.digest) errors.push(issue("digest-mismatch", `${name}/${entry.name} hash differs from its manifest`));
    }
  } catch (error) {
    errors.push(issue("missing-or-invalid-pack", `${name}: ${error.message}`));
  }
  return errors;
}

export function loadTf0609Inputs(root = ROOT) {
  const inputs = {};
  for (const [key, path] of Object.entries(PATHS)) {
    if (key === "rollback" || key === "comparison") {
      inputs[key] = optionalFile(root, path);
      continue;
    }
    const bytes = readFileSync(regularFile(root, path));
    inputs[key] = { path, digest: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
  }
  return inputs;
}

export function evaluateTf0609(inputs, actor = TF0609_ACTOR) {
  const reasons = [];
  const baseline = inputs.baseline.value;
  const gate = inputs.gate.value;
  const candidate = inputs.candidate.value;
  const research = inputs.research.value;
  const contamination = inputs.contamination.value;
  const adjudication = inputs.adjudication.value;
  const policy = inputs.policy.value;
  const actors = [actor, gate.envelope?.executorActor, gate.envelope?.verifierActor, gate.actor, research.actor, contamination.actor, adjudication.actor, inputs.comparison.value?.actor, inputs.rollback.value?.actor];
  if (actors.some((value) => value !== undefined && (!value || typeof value !== "string")) || new Set(actors.filter(Boolean)).size !== actors.filter(Boolean).length) reasons.push(issue("actor-collision", "eligibility reviewer and upstream evidence actors must be distinct named agents."));
  if (baseline.status !== "pass" || baseline.completeCaseCount < MIN_CASES) reasons.push(issue("baseline-floor", `baseline has ${baseline.completeCaseCount} complete cases; requires ${MIN_CASES}.`));
  if (gate.status !== "complete" || gate.aggregate?.caseCount < MIN_CASES || gate.aggregate?.completeCaseCount < MIN_CASES || gate.aggregate?.k !== K) reasons.push(issue("candidate-trials-incomplete", `candidate gate must contain at least ${MIN_CASES} complete cases at k=${K}.`));
  const heldOutDigest = gate.suite?.heldOutDigest;
  if (!/^sha256:[a-f0-9]{64}$/u.test(heldOutDigest ?? "") || heldOutDigest !== gate.envelope?.heldOutSplitDigest || heldOutDigest !== inputs.comparison.value?.heldOutDigest) reasons.push(issue("held-out-unsealed", "held-out split digest must be sealed and match the gate, candidate envelope and paired comparison."));
  const comparison = inputs.comparison.value;
  const thresholds = policy.promotion.thresholds;
  if (!inputs.comparison.present || comparison?.status !== "pass" || !Number.isFinite(comparison?.baselinePassK) || !Number.isFinite(comparison?.candidatePassK) || comparison.candidatePassK - comparison.baselinePassK < thresholds.passKAbsoluteImprovement.minimum || !Array.isArray(comparison?.confidenceInterval95) || comparison.confidenceInterval95.length !== 2 || !Number.isFinite(comparison.confidenceInterval95[0]) || comparison.confidenceInterval95[0] <= 0) reasons.push(issue("paired-benefit-unproven", "a sealed paired comparison must clear the pre-registered pass^k and confidence-interval thresholds."));
  if (!Number.isFinite(comparison?.costIncreaseRelative) || comparison.costIncreaseRelative > thresholds.costIncrease.maximum) reasons.push(issue("cost-ceiling", "paired token/tool-call cost comparison must be present and within the frozen ceiling."));
  if (comparison?.negativeControlRegression !== false || comparison?.safetyRegression !== false) reasons.push(issue("cost-safety-evidence-missing", "paired comparison must attest zero negative-control and safety regressions."));
  if (candidate.promotionReady !== false || candidate.autoMerge !== false || research.promotionReady !== false || research.autoMerge !== false) reasons.push(issue("candidate-self-promotion", "candidate and research artifacts must not self-promote or auto-merge."));
  if (adjudication.verdict !== "pass" || adjudication.disposition !== "allow-bounded-research" || adjudication.promotionReady !== false) reasons.push(issue("independent-verdict-not-ready", "independent TF-0608 reviewer has not authorized this bounded research; product promotion remains false."));
  const rollback = inputs.rollback.value;
  if (!inputs.rollback.present || !validateBehavioralRollbackReceipt(rollback, { candidateDigest: candidate.digest, baselineDigest: inputs.baseline.digest }).valid) reasons.push(issue("behavioral-rollback-missing", "a sealed, agent-attributed behavioral rollback/parity receipt bound to this candidate and baseline is required."));
  if (contamination.status !== "pass-precommit" || contamination.validation?.passed !== true || contamination.controls?.length !== 10) reasons.push(issue("contamination-gate-failed", "static contamination gate and all ten controls must pass."));
  if (contamination.limitations?.includes("Behavioral effects remain not-run.")) reasons.push(issue("stage3-behavioral-evidence-missing", "static precommit evidence does not prove behavioral rollback or parity."));
  if ([candidate.claims?.realHuman, research.claims?.realHuman, contamination.claims?.realHuman, adjudication.claims?.realHuman].some((value) => value !== false)) reasons.push(issue("real-human-claim", "all upstream claims must explicitly keep realHuman false."));
  if ([candidate.claims?.promotionReady, research.claims?.promotionReady, contamination.claims?.promotionReady, adjudication.claims?.promotionReady].some((value) => value !== false)) reasons.push(issue("upstream-promotion-claim", "no upstream artifact may claim product promotion readiness."));
  return {
    schemaVersion: TF0609_SCHEMA,
    taskId: "TF-0609",
    generatedAt: "2026-10-31T00:00:00.000Z",
    driven_by: "agent",
    actor,
    decision: reasons.length ? "no-go" : "go",
    go: reasons.length === 0,
    codeCandidateGenerated: false,
    codeCandidateExecuted: false,
    promotionReady: false,
    reasons,
    upstream: Object.fromEntries(Object.entries(inputs).map(([key, entry]) => [key, { path: entry.path, present: entry.present ?? true, digest: entry.digest, valueSummary: summarizeInput(key, entry.value) }])),
    residuals: reasons.map((reason) => ({ code: reason.code, owner: "RSI evaluation owner (agent)", reviewTrigger: "rerun this gate after the required evidence has been independently sealed; no fixed expiry is claimed for unavailable system trials" })),
    claims: { realHuman: false, liveProvider: false, promotionReady: false, productLocksChanged: false, codeCandidateGenerated: false, codeCandidateExecuted: false },
    limitations: ["This is a start-eligibility decision; it does not generate or execute a code candidate.", "No-Go means the current evidence does not authorize starting code self-modification; it is not a measured performance failure.", "The static TF-0607 scan is distinct from the TF-0609 behavioral rollback receipt; both remain necessary.", "The rollback receipt proves flag/hook off-on-off parity for this candidate, but does not establish quality benefit.", "No product default, lock, approval semantic, liveReady, release state, or human claim changed."],
  };
}

function summarizeInput(key, value) {
  if (!value) return null;
  if (key === "baseline") return { status: value.status, caseCount: value.corpusCaseCount, completeCaseCount: value.completeCaseCount, passK: value.passK };
  if (key === "gate") return { status: value.status, gate: value.gate, caseCount: value.aggregate?.caseCount, completeCaseCount: value.aggregate?.completeCaseCount, k: value.envelope?.k, heldOutDigest: value.suite?.heldOutDigest };
  if (key === "candidate") return { candidateId: value.candidateId, digest: value.digest, promotionReady: value.promotionReady, autoMerge: value.autoMerge };
  if (key === "research") return { status: value.status, promotionReady: value.promotionReady, completeCaseCount: value.evaluation?.completeCaseCount };
  if (key === "contamination") return { status: value.status, validationPassed: value.validation?.passed, controlCount: value.controls?.length, limitations: value.limitations };
  if (key === "adjudication") return { verdict: value.verdict, disposition: value.disposition, promotionReady: value.promotionReady };
  return key === "policy" ? { taskSet: value.taskSet, thresholds: value.promotion?.thresholds } : value;
}

function syntheticEligibleControlInputs(inputs) {
  const draft = structuredClone(inputs);
  draft.baseline.value.status = "pass";
  draft.baseline.value.completeCaseCount = MIN_CASES;
  draft.baseline.value.passK = 0.8;
  const digest = `sha256:${"b".repeat(64)}`;
  draft.gate.value.status = "complete";
  draft.gate.value.suite.heldOutDigest = digest;
  draft.gate.value.envelope.heldOutSplitDigest = digest;
  draft.gate.value.aggregate.caseCount = 24;
  draft.gate.value.aggregate.completeCaseCount = MIN_CASES;
  draft.gate.value.aggregate.k = K;
  draft.comparison.present = true;
  draft.comparison.value = { actor: "codex/tf0609-control-comparison", status: "pass", heldOutDigest: digest, baselinePassK: 0.8, candidatePassK: 0.9, confidenceInterval95: [0.01, 0.2], costIncreaseRelative: 0.05, negativeControlRegression: false, safetyRegression: false, driven_by: "agent" };
  draft.contamination.value.limitations = draft.contamination.value.limitations.filter((text) => text !== "Behavioral effects remain not-run.");
  draft.adjudication.value.verdict = "pass";
  draft.adjudication.value.disposition = "allow-bounded-research";
  draft.adjudication.value.promotionReady = false;
  draft.adjudication.value.actor = "codex/tf0608-control-reviewer";
  draft.adjudication.value.claims = { realHuman: false, liveProvider: false, promotionReady: false, autoMerge: false, productLocksChanged: false };
  draft.rollback.present = true;
  draft.rollback.digest = `sha256:${"c".repeat(64)}`;
  draft.rollback.value = { schemaVersion: "RsiBehavioralRollbackReceipt/v1", status: "pass", behavioralParity: true, driven_by: "agent", actor: "codex/tf0609-control-rollback", adjudicatorActor: "codex/tf0609-control-verifier", candidateDigest: draft.candidate.value.digest, baselineDigest: draft.baseline.digest, phases: { baselineOff: true, candidateOn: true, rollbackOff: true }, checks: { flagResolutionObserved: true, hookSubscribedWhenEnabled: true, hookAbsentWhenDisabled: true, rollbackRemovedSubscriptions: true, productStateChanged: false, reverseMigrationApplied: false }, commands: ["probe"], artifacts: [{ path: "probe.ts", digest: sha256(Buffer.from("probe")) }], claims: { realHuman: false, liveProvider: false, productLocksChanged: false } };
  return draft;
}

export function runTf0609Controls(inputs) {
  const controls = [];
  const base = syntheticEligibleControlInputs(inputs);
  for (const [id, expectedCode, mutate] of [
    ["invented-baseline-count", "baseline-floor", (draft) => { draft.baseline.value.completeCaseCount = 0; draft.baseline.value.status = "insufficient-evidence"; }],
    ["heldout-mismatch", "held-out-unsealed", (draft) => { draft.gate.value.envelope.heldOutSplitDigest = `sha256:${"d".repeat(64)}`; }],
    ["unapproved-adjudication", "independent-verdict-not-ready", (draft) => { draft.adjudication.value.verdict = "insufficient-evidence"; }],
    ["missing-rollback", "behavioral-rollback-missing", (draft) => { draft.rollback.present = false; draft.rollback.value = null; }],
    ["unsafe-contamination", "contamination-gate-failed", (draft) => { draft.contamination.value.status = "reject"; }],
    ["real-human-claim", "real-human-claim", (draft) => { draft.research.value.claims.realHuman = true; }],
    ["actor-collision", "actor-collision", (draft) => { draft.adjudication.value.actor = draft.gate.value.envelope.executorActor; }],
    ["cost-overrun", "cost-ceiling", (draft) => { draft.comparison.value.costIncreaseRelative = 0.11; }],
  ]) {
    const draft = structuredClone(base);
    mutate(draft);
    const report = evaluateTf0609(draft);
    const codes = report.reasons.map((reason) => reason.code);
    controls.push({ id, expectedCode, observedCodes: codes, passed: codes.includes(expectedCode) && report.go === false && !report.codeCandidateGenerated && !report.codeCandidateExecuted });
  }
  return controls;
}

export function normalizeEvidenceDigest(value) {
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('sha256:') ? value.slice(7) : value;
  return /^[a-f0-9]{64}$/u.test(hex) ? 'sha256:' + hex : null;
}

export function validateBehavioralRollbackReceipt(receipt, expected = {}) {
  const errors = [];
  const checks = receipt?.checks;
  const phases = receipt?.phases;
  if (receipt?.schemaVersion !== "RsiBehavioralRollbackReceipt/v1") errors.push("schemaVersion");
  if (receipt?.status !== "pass" || receipt?.behavioralParity !== true) errors.push("status-or-parity");
  if (receipt?.driven_by !== "agent" || typeof receipt?.actor !== "string" || !receipt.actor.trim()) errors.push("agent-attribution");
  if (typeof receipt?.adjudicatorActor !== "string" || !receipt.adjudicatorActor.trim() || receipt.adjudicatorActor === receipt.actor) errors.push("independent-adjudicator");
  if (expected.candidateDigest && normalizeEvidenceDigest(receipt?.candidateDigest) !== normalizeEvidenceDigest(expected.candidateDigest)) errors.push("candidate-binding");
  if (expected.baselineDigest && normalizeEvidenceDigest(receipt?.baselineDigest) !== normalizeEvidenceDigest(expected.baselineDigest)) errors.push("baseline-binding");
  if (!phases || phases.baselineOff !== true || phases.candidateOn !== true || phases.rollbackOff !== true) errors.push("phase-order");
  if (!checks || checks.flagResolutionObserved !== true || checks.hookSubscribedWhenEnabled !== true || checks.hookAbsentWhenDisabled !== true || checks.rollbackRemovedSubscriptions !== true || checks.productStateChanged !== false || checks.reverseMigrationApplied !== false) errors.push("behavioral-checks");
  if (!Array.isArray(receipt?.commands) || receipt.commands.length < 1 || receipt.commands.some((entry) => typeof entry !== "string" || !entry.trim())) errors.push("commands");
  if (!Array.isArray(receipt?.artifacts) || receipt.artifacts.length < 1 || receipt.artifacts.some((entry) => !/^sha256:[a-f0-9]{64}$/u.test(entry?.digest ?? "") || typeof entry?.path !== "string")) errors.push("artifacts");
  if (receipt?.claims?.realHuman !== false || receipt?.claims?.liveProvider !== false || receipt?.claims?.productLocksChanged !== false) errors.push("claims");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function checkTf0609Evidence(root = ROOT) {
  const pack = join(root, TF0609_PACK_DIR);
  const errors = [];
  let report;
  let controls;
  try {
    report = readJson(regularFile(root, `${TF0609_PACK_DIR}/eligibility.v1.json`));
    controls = readJson(regularFile(root, `${TF0609_PACK_DIR}/control-results.v1.json`));
  } catch (error) {
    return { passed: false, errors: [issue("missing-decision-pack", error.message)] };
  }
  const inputs = loadTf0609Inputs(root);
  const expectedReport = evaluateTf0609(inputs);
  const expectedControls = runTf0609Controls(inputs);
  if (!same(report, expectedReport)) errors.push(issue("decision-recomputation", "saved TF-0609 eligibility differs from fixed upstream evidence."));
  if (!same(controls, expectedControls) || controls.length !== 8 || controls.some((control) => !control.passed)) errors.push(issue("control-replay", "TF-0609 controls differ from replay or a control escaped."));
  for (const [name, files] of Object.entries(SUMS)) errors.push(...verifyPack(root, name, files));
  if (!same(readdirSync(pack).sort(), [...SUMS.tf0609, "SHA256SUMS"].sort())) errors.push(issue("local-pack-coverage", "TF-0609 pack has unexpected or missing files."));
  const tf0604 = validateTf0604Pack(root);
  if (!tf0604.passed) errors.push(issue("tf0604-invalid", "TF-0604 frozen evidence failed source validation."));
  return { passed: errors.length === 0, errors, report, controls };
}

export function writeTf0609Evidence(root = ROOT) {
  const inputs = loadTf0609Inputs(root);
  const report = evaluateTf0609(inputs);
  const controls = runTf0609Controls(inputs);
  const pack = join(root, TF0609_PACK_DIR);
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, "eligibility.v1.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(pack, "control-results.v1.json"), `${JSON.stringify(controls, null, 2)}\n`);
  writeFileSync(join(pack, "SHA256SUMS"), `${SUMS.tf0609.map((name) => `${sha256(readFileSync(join(pack, name)))}  ${name}`).join("\n")}\n`);
  return checkTf0609Evidence(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
  if (!mode || (process.argv.includes("--write") && process.argv.includes("--check"))) {
    console.error("usage: node scripts/rsi-tf0609-code-self-modification.mjs --write|--check");
    process.exitCode = 2;
  } else {
    const result = mode === "write" ? writeTf0609Evidence() : checkTf0609Evidence();
    console.log(JSON.stringify({ passed: result.passed, decision: result.report?.decision, reasonCount: result.report?.reasons?.length, controlCount: result.controls?.length, errors: result.errors }, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
}