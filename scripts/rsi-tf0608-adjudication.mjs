import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, lstatSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildCandidateGateReport,
  loadInputs as loadCandidateGateInputs,
  runNegativeControls as runCandidateGateControls,
} from "./rsi-tf0599-candidate-gate.mjs";
import {
  baseEnvelope,
  buildCandidate,
  buildSelfHarnessReport,
  loadInputs as loadSelfHarnessInputs,
  mineWeaknesses,
  runSelfHarnessNegativeControls,
  TF0606_ACTOR,
  validateSelfHarness,
} from "./rsi-tf0606-self-harness.mjs";
import {
  buildGateReport as buildContaminationGateReport,
} from "./rsi-tf0607-contamination-gate.mjs";
import { validateTf0604Pack } from "./rsi-tf0604-baseline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TF0608_PACK_DIR = "harness/specs/fixtures/rsi-evidence-loop/tf0608";
export const TF0608_SCHEMA = "RsiIndependentAdjudication/v1";
export const TF0608_ACTOR = "codex/tf0608-adjudicator";
const paths = {
  gate: "harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json",
  candidate: "harness/specs/fixtures/rsi-evidence-loop/tf0606/candidate.v1.json",
  research: "harness/specs/fixtures/rsi-evidence-loop/tf0606/report.v1.json",
  contamination: "harness/specs/fixtures/rsi-evidence-loop/tf0607/gate-report.v1.json",
};
const packFiles = {
  tf0599: ["gate-report.v1.json", "control-results.v1.json"],
  tf0606: ["candidate.v1.json", "report.v1.json", "control-results.v1.json"],
  tf0607: ["gate-report.v1.json", "control-results.v1.json"],
  tf0608: ["verdict.v1.json", "control-results.v1.json"],
};
const tf0604Files = [
  "task-corpus.v1.json",
  "negative-controls.v1.json",
  "raw-trials.v1.json",
  "aggregate.v1.json",
  "negative-control-results.v1.json",
  "validation-report.v1.json",
];
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const err = (code, message) => ({ code, message });
const claimsAreFalse = (value) => value && Object.values(value).every((claim) => claim === false);

function regularFile(root, relativePath) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(absoluteRoot + sep)) throw new Error(`evidence path escapes root: ${relativePath}`);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`evidence path is not a regular file: ${relativePath}`);
  return absolutePath;
}

function verifySums(root, packDir, expectedFiles) {
  const errors = [];
  try {
    const absoluteDir = resolve(root, packDir);
    const dirStat = lstatSync(absoluteDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error(`${packDir} is not a regular directory`);
    const actualFiles = readdirSync(absoluteDir).sort();
    const expectedOnDisk = [...expectedFiles, "SHA256SUMS"].sort();
    if (!same(actualFiles, expectedOnDisk)) errors.push(err("pack-file-coverage", `${packDir} must contain exactly its listed evidence and SHA256SUMS`));
    const manifestPath = regularFile(root, join(packDir, "SHA256SUMS"));
    const lines = readFileSync(manifestPath, "utf8").trimEnd().split(/\r?\n/u);
    const entries = lines.map((line) => {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
      return match ? { digest: match[1], name: match[2] } : null;
    });
    if (entries.some((entry) => entry === null)) errors.push(err("invalid-sha256sums", `${packDir}/SHA256SUMS has a malformed line`));
    const names = entries.filter(Boolean).map((entry) => entry.name);
    if (!same([...names].sort(), [...expectedFiles].sort()) || new Set(names).size !== expectedFiles.length) errors.push(err("incomplete-sha256sums", `${packDir}/SHA256SUMS must cover exactly ${expectedFiles.join(", ")}`));
    for (const entry of entries.filter(Boolean)) {
      try {
        const bytes = readFileSync(regularFile(root, join(packDir, entry.name)));
        if (sha256(bytes) !== entry.digest) errors.push(err("digest-mismatch", `${packDir}/${entry.name} does not match SHA256SUMS`));
      } catch (error) {
        errors.push(err("missing-pack-file", `${packDir}/${entry.name}: ${error.message}`));
      }
    }
  } catch (error) {
    errors.push(err("missing-sha256sums", `${packDir}/SHA256SUMS: ${error.message}`));
  }
  return errors;
}

export function loadAdjudicationInputs(root = ROOT) {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => {
    const absolute = regularFile(root, path);
    const bytes = readFileSync(absolute);
    return [key, { path, digest: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) }];
  }));
}

function buildContaminationExpectation(root, candidate) {
  const manifestPath = paths.candidate;
  const changed = [{ path: manifestPath, surface: candidate.surface, content: candidate.change.prompt }];
  const contaminationCandidate = {
    candidateId: candidate.candidateId,
    parentLineage: [candidate.candidateId],
    changed,
    diffDigest: `sha256:${sha256(JSON.stringify(changed))}`,
  };
  return buildContaminationGateReport({ candidate: contaminationCandidate, content: changed, trials: [], options: {} });
}

function buildExpectedEvidence(root, inputs) {
  const errors = [];
  const tf0604 = validateTf0604Pack(root);
  if (!tf0604.passed) errors.push(err("tf0604-pack", `TF-0604 validation failed: ${(tf0604.errors ?? []).map((item) => item.code).join(", ")}`));

  const gateInputs = loadCandidateGateInputs(root);
  const diskGate = readJson(regularFile(root, paths.gate));
  const expectedGate = buildCandidateGateReport(gateInputs, diskGate.envelope, root);
  const expectedGateControls = runCandidateGateControls(gateInputs, diskGate.envelope, root);
  if (!same(diskGate, expectedGate)) errors.push(err("gate-recomputation", "TF-0599 does not match its inputs and recomputed aggregate"));
  if (!same(readJson(regularFile(root, "harness/specs/fixtures/rsi-evidence-loop/tf0599/control-results.v1.json")), expectedGateControls) || expectedGateControls.length !== 10 || expectedGateControls.some((item) => !item.passed)) errors.push(err("gate-controls", "TF-0599 negative controls differ from replay or a control escaped"));

  const selfInputs = loadSelfHarnessInputs(root);
  const weaknesses = mineWeaknesses(selfInputs.corpus);
  const candidate = buildCandidate(selfInputs.corpus, weaknesses);
  const envelope = {
    ...baseEnvelope(selfInputs.corpus),
    candidateId: candidate.candidateId,
    candidateDigest: candidate.digest,
    heldOutSplitDigest: `sha256:${"1".repeat(64)}`,
    executorActor: "codex/tf0606-candidate",
    verifierActor: "codex/tf0606-verifier",
  };
  const candidateGate = buildCandidateGateReport(selfInputs, envelope, root);
  const research = buildSelfHarnessReport(selfInputs.corpus, weaknesses, candidate, candidateGate, root);
  const selfContext = { corpus: selfInputs.corpus, weaknesses, candidate, report: research, gateReport: candidateGate };
  const selfValidation = validateSelfHarness(selfContext);
  if (!selfValidation.passed) errors.push(err("research-validation", `TF-0606 validation failed: ${selfValidation.errors.map((item) => item.code).join(", ")}`));
  const researchControls = runSelfHarnessNegativeControls(selfContext);
  if (researchControls.length !== 7 || researchControls.some((item) => !item.passed)) errors.push(err("research-controls", "TF-0606 negative controls did not all reject"));
  if (!same(readJson(regularFile(root, "harness/specs/fixtures/rsi-evidence-loop/tf0606/control-results.v1.json")), researchControls)) errors.push(err("research-controls", "saved TF-0606 controls differ from independent replay"));
  if (!same(inputs.candidate.value, candidate)) errors.push(err("candidate-recomputation", "TF-0606 candidate does not match the frozen corpus and content digest"));
  if (!same(inputs.research.value, research)) errors.push(err("research-recomputation", "TF-0606 report does not match its candidate, gate and source digests"));
  if (!claimsAreFalse(research.claims) || research.promotionReady !== false || research.autoMerge !== false) errors.push(err("research-promotion", "TF-0606 contains a prohibited promotion or product claim"));

  const contamination = buildContaminationExpectation(root, candidate);
  if (!same(inputs.contamination.value, contamination)) errors.push(err("contamination-recomputation", "TF-0607 report or its negative-control replay differs from the bound candidate"));
  if (!same(readJson(regularFile(root, "harness/specs/fixtures/rsi-evidence-loop/tf0607/control-results.v1.json")), contamination.controls)) errors.push(err("contamination-controls", "saved TF-0607 controls differ from independent replay"));
  if (!claimsAreFalse(inputs.contamination.value.claims)) errors.push(err("contamination-claims", "TF-0607 contains a prohibited claim"));

  for (const [key, entry] of Object.entries(inputs)) {
    if (entry.path !== paths[key]) errors.push(err("evidence-path", `${key} path is not the registered source`));
    if (!/^[a-f0-9]{64}$/u.test(entry.digest ?? "")) errors.push(err("invalid-evidence-digest", `${key} digest is malformed`));
    try {
      const bytes = readFileSync(regularFile(root, paths[key]));
      if (sha256(bytes) !== entry.digest || !same(JSON.parse(bytes.toString("utf8")), entry.value)) errors.push(err("stale-evidence", `${key} evidence does not match its on-disk bytes`));
    } catch (error) {
      errors.push(err("missing-evidence", `${key}: ${error.message}`));
    }
  }

  for (const [dir, files] of Object.entries(packFiles)) errors.push(...verifySums(root, `harness/specs/fixtures/rsi-evidence-loop/${dir}`, files));
  errors.push(...verifySums(root, "harness/specs/fixtures/rsi-evidence-loop/tf0604", tf0604Files));
  return { errors, expectedGate, candidate, research, contamination, researchControls };
}

export function adjudicate(inputs, verifierActor = TF0608_ACTOR, root = ROOT) {
  const errors = [];
  const gate = inputs?.gate?.value;
  const candidate = inputs?.candidate?.value;
  const research = inputs?.research?.value;
  const contamination = inputs?.contamination?.value;
  const executorActor = gate?.envelope?.executorActor ?? "unknown";
  const sourceVerifierActor = gate?.envelope?.verifierActor ?? "unknown";
  const actors = [executorActor, sourceVerifierActor, gate?.actor, research?.actor, contamination?.actor, verifierActor];
  if (actors.some((actor) => typeof actor !== "string" || actor.length === 0) || new Set(actors).size !== actors.length) errors.push(err("same-actor", "executor, source verifier, candidate author, contamination reviewer and adjudicator must be distinct named actors"));
  if (gate?.status !== "not-run" || gate?.gate !== "insufficient-evidence") errors.push(err("not-run-boundary", "candidate gate must remain not-run/insufficient-evidence"));
  const aggregate = gate?.aggregate;
  if (aggregate?.caseCount !== 24 || aggregate?.completeCaseCount !== 0 || aggregate?.incompleteCaseCount !== 24 || aggregate?.trialCount !== 0 || aggregate?.passK !== null || aggregate?.passAtK !== null || aggregate?.confidenceInterval95 != null || aggregate?.gate !== "insufficient-sample") errors.push(err("thin-sample-claim", "24 reserved cases and zero complete trials must not carry a measured pass result"));
  if (gate?.envelope?.k !== 3 || gate?.envelope?.minimumCompleteCases !== 20 || gate?.suite?.caseCount !== 24 || gate?.suite?.heldOutCaseCount !== 12 || gate?.suite?.publicCaseCount !== 12) errors.push(err("gate-contract", "TF-0599 does not match the frozen 24-case, 12/12, k=3, floor=20 contract"));
  if (candidate?.promotionReady !== false || candidate?.autoMerge !== false || research?.promotionReady !== false || research?.autoMerge !== false) errors.push(err("candidate-self-promotion", "candidate and research report must remain non-promoting and non-merging"));
  if (research?.status !== "insufficient-evidence" || research?.evaluation?.completeCaseCount !== 0 || research?.evaluation?.passK !== null || research?.evaluation?.passAtK !== null) errors.push(err("research-not-run", "TF-0606 must preserve the no-trial boundary"));
  if (contamination?.status !== "pass-precommit" || contamination?.validation?.passed !== true) errors.push(err("contamination-rejected", "candidate did not pass the static pre-commit contamination gate"));
  if (!Array.isArray(contamination?.controls) || contamination.controls.length !== 10 || contamination.controls.some((control) => control.passed !== true)) errors.push(err("contamination-control-failed", "all ten registered contamination controls must reject"));
  if (gate?.validation?.passed !== true || !claimsAreFalse(gate?.claims) || !claimsAreFalse(research?.claims) || !claimsAreFalse(contamination?.claims)) errors.push(err("claim-boundary", "all source validations and product/human/promotion claims must remain within the frozen boundary"));

  let recomputed = { errors: [err("recomputation-unavailable", "upstream evidence could not be recomputed")] };
  try {
    recomputed = buildExpectedEvidence(root, inputs);
    errors.push(...recomputed.errors);
  } catch (error) {
    errors.push(err("recomputation-failed", error.message));
  }

  const verdict = errors.length === 0 ? "insufficient-evidence" : "invalid";
  return {
    schemaVersion: TF0608_SCHEMA,
    taskId: "TF-0608",
    generatedAt: "2026-10-31T00:00:00.000Z",
    driven_by: "agent",
    actor: verifierActor,
    executorActor,
    sourceVerifierActor,
    verdict,
    disposition: verdict === "insufficient-evidence" ? "not-promote" : "reject",
    promotionReady: false,
    reasons: errors.length ? errors : [err("insufficient-evidence", "zero complete held-out system trials; no quality benefit can be inferred")],
    recomputed: {
      corpusCaseCount: aggregate?.caseCount ?? null,
      publicCaseCount: gate?.suite?.publicCaseCount ?? null,
      heldOutCaseCount: gate?.suite?.heldOutCaseCount ?? null,
      completeCaseCount: aggregate?.completeCaseCount ?? null,
      incompleteCaseCount: aggregate?.incompleteCaseCount ?? null,
      trialCount: aggregate?.trialCount ?? null,
      k: aggregate?.k ?? null,
      minimumCompleteCases: gate?.envelope?.minimumCompleteCases ?? null,
      passK: aggregate?.passK ?? null,
      passAtK: aggregate?.passAtK ?? null,
      confidenceInterval95: null,
      costStatus: "not-run",
      heldOutDigest: gate?.suite?.heldOutDigest ?? null,
      heldOutBindingStatus: gate?.suite?.heldOutDigest === `sha256:${"1".repeat(64)}` ? "placeholder" : gate?.suite?.heldOutDigest ? "reported-unverified" : "unavailable",
      researchControlCount: recomputed.researchControls?.length ?? null,
      contaminationControlCount: contamination?.controls?.length ?? null,
      upstreamDigestsVerified: errors.every((item) => !["stale-evidence", "missing-evidence", "digest-mismatch", "incomplete-sha256sums"].includes(item.code)),
    },
    evidence: Object.fromEntries(Object.entries(inputs ?? {}).map(([key, entry]) => [key, { path: entry.path, digest: entry.digest }])),
    claims: { realHuman: false, liveProvider: false, promotionReady: false, autoMerge: false, productLocksChanged: false },
    limitations: [
      "The sealed corpus contains task definitions, not completed RSI system trials; completeCaseCount is zero.",
      "No confidence interval, cost comparison, quality gain or promotion decision is available.",
      "The held-out digest is not present in TF-0599; the TF-0606 all-ones value is a placeholder, not a sealed split digest.",
      "The contamination scan is finite and static; behavioral rollback and live effects remain untested.",
      "Adjudication does not merge, publish, enable defaults or change product locks.",
    ],
  };
}

export function runNegativeControls(inputs, root = ROOT) {
  const controls = [];
  const add = (id, expectedCode, mutate) => {
    const draft = structuredClone(inputs);
    mutate(draft);
    const result = adjudicate(draft, TF0608_ACTOR, root);
    const observedCodes = result.reasons.map((entry) => entry.code);
    controls.push({ id, expectedCode, observedCodes, passed: observedCodes.includes(expectedCode) });
  };
  add("same-actor", "same-actor", (draft) => { draft.gate.value.envelope.verifierActor = draft.gate.value.envelope.executorActor; });
  add("self-promotion", "candidate-self-promotion", (draft) => { draft.candidate.value.promotionReady = true; });
  add("fabricated-pass", "thin-sample-claim", (draft) => { draft.gate.value.aggregate.passK = 1; });
  add("not-run-gate", "not-run-boundary", (draft) => { draft.gate.value.status = "complete"; });
  add("contamination-failure", "contamination-rejected", (draft) => { draft.contamination.value.status = "reject"; });
  add("control-failure", "contamination-control-failed", (draft) => { draft.contamination.value.controls[0].passed = false; });
  add("research-regression", "research-not-run", (draft) => { draft.research.value.status = "pass"; });
  add("false-human-claim", "claim-boundary", (draft) => { draft.research.value.claims.realHuman = true; });
  add("stale-evidence", "stale-evidence", (draft) => { draft.candidate.digest = "0".repeat(64); });
  add("missing-held-out-binding", "gate-contract", (draft) => { draft.gate.value.suite.heldOutCaseCount = 0; });
  add("wrong-evidence-path", "evidence-path", (draft) => { draft.candidate.path = "../../outside.json"; });
  add("fabricated-confidence-interval", "thin-sample-claim", (draft) => { draft.gate.value.aggregate.confidenceInterval95 = [0, 1]; });
  return controls;
}

export function validateAdjudicationPack(root = ROOT) {
  const pack = join(root, TF0608_PACK_DIR);
  const errors = [];
  let verdict;
  let controls;
  try {
    verdict = readJson(regularFile(root, join(TF0608_PACK_DIR, "verdict.v1.json")));
    controls = readJson(regularFile(root, join(TF0608_PACK_DIR, "control-results.v1.json")));
  } catch (error) {
    return { passed: false, errors: [err("missing-adjudication-pack", error.message)] };
  }
  const inputs = loadAdjudicationInputs(root);
  const expectedVerdict = adjudicate(inputs, TF0608_ACTOR, root);
  const expectedControls = runNegativeControls(inputs, root);
  if (!same(verdict, expectedVerdict)) errors.push(err("verdict-readback", "saved verdict differs from independent disk recomputation"));
  if (!same(controls, expectedControls) || controls.length !== 12 || controls.some((control) => !control.passed)) errors.push(err("control-readback", "saved negative controls differ from replay or a control escaped"));
  errors.push(...verifySums(root, TF0608_PACK_DIR, packFiles.tf0608));
  return { passed: errors.length === 0, errors, verdict, controls };
}

export function writeAdjudicationPack(root = ROOT) {
  const inputs = loadAdjudicationInputs(root);
  const verdict = adjudicate(inputs, TF0608_ACTOR, root);
  const controls = runNegativeControls(inputs, root);
  const pack = join(root, TF0608_PACK_DIR);
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, "verdict.v1.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  writeFileSync(join(pack, "control-results.v1.json"), `${JSON.stringify(controls, null, 2)}\n`);
  const files = packFiles.tf0608;
  writeFileSync(join(pack, "SHA256SUMS"), `${files.map((file) => `${sha256(readFileSync(join(pack, file)))}  ${file}`).join("\n")}\n`);
  return { verdict, controls, validation: validateAdjudicationPack(root) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;
  if (!mode || (process.argv.includes("--write") && process.argv.includes("--check"))) {
    console.error("usage: node scripts/rsi-tf0608-adjudication.mjs --write|--check");
    process.exitCode = 2;
  } else if (mode === "write") {
    const result = writeAdjudicationPack();
    console.log(JSON.stringify(result, null, 2));
    if (!result.validation.passed) process.exitCode = 1;
  } else {
    const result = validateAdjudicationPack();
    console.log(JSON.stringify({ passed: result.passed, errors: result.errors, verdict: result.verdict?.verdict, controls: result.controls?.length }, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
}