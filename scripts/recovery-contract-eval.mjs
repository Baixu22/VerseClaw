#!/usr/bin/env node
/**
 * TF-0711 / TF-0721 / TF-0723 evidence driver.
 *
 * Merges real window-trial receipts produced by tests/e2e/recovery-contract-eval.spec.ts
 * into the frozen TF-0709 evaluation and writes the curated report. It never
 * fabricates a measurement: a window with fewer than the frozen repeat count is
 * reported as incomplete and the evaluation stays EVIDENCE_INSUFFICIENT.
 *
 * Usage:
 *   node --experimental-strip-types scripts/recovery-contract-eval.mjs --dir D:/tmp/recovery-eval
 *   node --experimental-strip-types scripts/recovery-contract-eval.mjs --check
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  buildRecoveryContractManifest,
  evaluateRecoveryContractEval,
} from "../shared/recovery-contract-eval.ts";
import {
  RECOVERY_READBACK_JUDGE_VERSION,
  scoreRecoveryReadback,
} from "../shared/recovery-quality-readback.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "harness/specs/fixtures/recovery-contract-eval");
const ACTOR = "recovery-contract-eval-driver";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const bundlePath = argValue("--bundle", "");
const bundle = bundlePath
  ? JSON.parse(gunzipSync(readFileSync(resolve(bundlePath))).toString("utf8"))
  : null;
const arm = argValue("--arm", "candidate");
function artifactBytes(artifactPath) {
  if (!bundle) return readFileSync(artifactPath);
  const artifact = bundle.artifacts.find((item) => item.path === artifactPath);
  if (!artifact) throw new Error("artifact missing from sealed bundle");
  return Buffer.from(artifact.base64, "base64");
}

function readReceipts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) return readReceipts(join(dir, entry.name));
      if (!entry.name.startsWith("trial-") || !entry.name.endsWith(".json")) return [];
      try {
        return [JSON.parse(readFileSync(join(dir, entry.name), "utf8"))];
      } catch {
        return [];
      }
    })
    .filter((value) => value && typeof value === "object");
}

const check = process.argv.includes("--check");
const verifyPath = argValue("--verify", "");
const recorded = verifyPath ? JSON.parse(readFileSync(resolve(verifyPath), "utf8")) : null;
const dir = resolve(argValue("--dir", "D:/tmp/recovery-eval"));
const manifest = buildRecoveryContractManifest();
if (bundle && bundle.manifestHash !== manifest.manifestHash)
  throw new Error("sealed evidence does not match the frozen workload");
const receipts = bundle
  ? bundle.windows.filter((receipt) => receipt.arm === arm)
  : readReceipts(dir);
const rejectedEvidence = [];
const readbackJudgements = [];
function verifyArtifacts(receipt) {
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length < 3) return false;
  return receipt.artifacts.every((artifact) => {
    try {
      return (
        createHash("sha256").update(artifactBytes(artifact.path)).digest("hex") === artifact.sha256
      );
    } catch {
      return false;
    }
  });
}

function verifyWindowBoundary(receipt) {
  const points = receipt.observed?.crashes?.map((crash) => crash.point) ?? [];
  switch (receipt.windowId) {
    case "intent-after-persist-kill":
      return points.length === 1 && points[0] === "user-intent-durable";
    case "effect-before-receipt-kill":
    case "child-created-before-parent-advance-kill":
      return points.length === 1 && points[0] === "tool-return-before-receipt";
    case "repeated-restart":
      return (
        points.length === 3 &&
        points[0] === "user-intent-durable" &&
        points.slice(1).every((point) => point === "recovery-before-dispatch")
      );
    case "store-write-failure":
      return (
        receipt.observed?.hit?.some((hit) => hit.point === "session-store-before-ack") === true
      );
    default:
      return false;
  }
}

const windowTrials = receipts.map((receipt) => ({
  windowId: receipt.windowId,
  trialIndex: receipt.trialIndex,
  // Preserve the observation. Substituting the frozen annotation here would
  // silently turn a different experiment into passing contract evidence.
  injectionPoint: receipt.injectionPoint,
  duplicateEffects: receipt.duplicateEffects,
  lostTasks: receipt.lostTasks,
  terminalCorrect: receipt.terminalCorrect,
  unknownClassifiable: receipt.unknownClassifiable,
  recoveryLatencyMs: receipt.recoveryLatencyMs,
  diskEvidenceComplete:
    receipt.diskEvidenceComplete === true &&
    verifyArtifacts(receipt) &&
    verifyWindowBoundary(receipt),
  rerunOutsideAllowedRegion: receipt.rerunOutsideAllowedRegion,
  evidenceRef: receipt.evidenceRef,
}));

// Long-session recovery pairs are measured by tests/e2e/recovery-longsession-eval.spec.ts.
// A missing directory means that measurement has not run: the evaluation must
// then stay EVIDENCE_INSUFFICIENT rather than inventing benign rows.
function readPairReceipts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) return readPairReceipts(join(dir, entry.name));
      if (!entry.name.startsWith("pair-") || !entry.name.endsWith(".json")) return [];
      try {
        return [JSON.parse(readFileSync(join(dir, entry.name), "utf8"))];
      } catch {
        return [];
      }
    })
    .filter((value) => value && typeof value === "object");
}

function verifyFreshAnswer(receipt, pair, answer) {
  const text = (message) =>
    typeof message.content === "string"
      ? message.content
      : (message.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  const read = (name) => {
    const artifact = receipt.artifacts.find((item) =>
      item.path.replaceAll("\\", "/").endsWith("/" + name),
    );
    if (!artifact) throw new Error("missing " + name);
    return JSON.parse(artifactBytes(artifact.path).toString("utf8"));
  };
  try {
    const boundary = read("boundary.json");
    const branch = answer.disk.branch;
    const entry = branch.findLast((item) => item.message?.role === "assistant");
    if (
      entry?.id !== answer.assistantEntryId ||
      entry.message.stopReason !== "stop" ||
      text(entry.message) !== answer.assistantText
    )
      return null;
    if (boundary.disk.entries.some((item) => item.id === answer.assistantEntryId)) return null;
    const question = branch
      .slice(
        0,
        branch.findIndex((item) => item.id === entry.id),
      )
      .findLast((item) => item.message?.role === "user");
    if (
      !question ||
      !text(question.message).includes("Recovery readback for " + pair.id) ||
      pair.mustPreserve.some((fact) => text(question.message).includes(fact))
    )
      return null;
    const integrity = { freshAssistant: true, questionDoesNotContainGold: true };
    if (pair.family === "compression") {
      const before = read("before.json");
      const seed = before.branch.findLast((item) => item.message?.role === "assistant");
      const compaction = boundary.disk.branch.findLast((item) => item.type === "compaction");
      const seedIndex = boundary.disk.branch.findIndex((item) => item.id === seed?.id);
      const keepIndex = boundary.disk.branch.findIndex(
        (item) => item.id === compaction?.firstKeptEntryId,
      );
      if (!compaction || seedIndex < 0 || keepIndex <= seedIndex) return null;
      const retained = boundary.disk.branch
        .slice(
          keepIndex,
          boundary.disk.branch.findIndex((item) => item.id === compaction.id),
        )
        .filter((item) => item.type === "message");
      if (
        pair.mustPreserve.some((fact) => retained.some((item) => text(item.message).includes(fact)))
      )
        return null;
      integrity.compaction = {
        seedNotInRetainedTail: true,
        summaryLiteralMatches: pair.mustPreserve.filter((fact) =>
          compaction.summary.toLowerCase().includes(fact.toLowerCase()),
        ).length,
      };
    }
    return integrity;
  } catch {
    return null;
  }
}

const pairDir = resolve(argValue("--pairs", "D:/tmp/recovery-longsession-eval"));
const longSessionMeasurements = (
  bundle ? bundle.quality.filter((receipt) => receipt.arm === arm) : readPairReceipts(pairDir)
).flatMap((receipt) => {
  const valid =
    receipt.schema === "RecoveryLongSessionPairReceipt/v2" &&
    receipt.observed?.postBoundaryAnswer === true &&
    verifyArtifacts(receipt);
  const pair = manifest.longSessionPairs.find(
    (item) => item.id === receipt.pairId && item.family === receipt.family,
  );
  const answerArtifact = receipt.artifacts?.find((artifact) =>
    artifact.path.replaceAll("\\", "/").endsWith("/answer.json"),
  );
  if (!valid || !pair || !answerArtifact) {
    rejectedEvidence.push({
      pairId: receipt.pairId,
      reason: "missing post-boundary assistant oracle or artifact integrity",
    });
    return [];
  }
  let answer;
  try {
    answer = JSON.parse(artifactBytes(answerArtifact.path).toString("utf8"));
  } catch {
    rejectedEvidence.push({ pairId: receipt.pairId, reason: "unreadable assistant artifact" });
    return [];
  }
  if (
    typeof answer.assistantText !== "string" ||
    answer.assistantEntryId !== receipt.observed.assistantEntryId
  ) {
    rejectedEvidence.push({ pairId: receipt.pairId, reason: "assistant identity mismatch" });
    return [];
  }
  const integrity = verifyFreshAnswer(receipt, pair, answer);
  if (!integrity) {
    rejectedEvidence.push({
      pairId: receipt.pairId,
      reason: "fresh assistant, question or boundary proof failed",
    });
    return [];
  }
  const judged = scoreRecoveryReadback(answer.assistantText, {
    ...pair,
    forbiddenFacts: [`REVOKED-${pair.id}`, `SIBLING_ONLY-${pair.id}`],
  });
  readbackJudgements.push({
    pairId: pair.id,
    judgeVersion: RECOVERY_READBACK_JUDGE_VERSION,
    answerSha256: answerArtifact.sha256,
    integrity,
    preliminary: {
      mustPreserveMatched: receipt.mustPreserveMatched,
      nextActionCorrect: receipt.nextActionCorrect,
      falseCompletionClaim: receipt.falseCompletionClaim,
      schemaValid: receipt.observed.schemaValid,
    },
    judged,
  });
  return [
    {
      pairId: receipt.pairId,
      family: receipt.family,
      provider: receipt.provider,
      model: receipt.model,
      measurementBasis: receipt.measurementBasis,
      mustPreserveMatched: judged.mustPreserveMatched,
      falseCompletionClaim: judged.falseCompletionClaim,
      nextActionCorrect: judged.nextActionCorrect,
      recoveryLatencyMs: receipt.recoveryLatencyMs,
      evidenceRef: receipt.evidenceRef,
    },
  ];
});

const result = evaluateRecoveryContractEval({
  manifest,
  windowTrials,
  longSessionMeasurements,
  actor: ACTOR,
  ...(recorded ? { generatedAt: recorded.evaluation.generatedAt } : {}),
});

const byWindow = {};
for (const trial of windowTrials) {
  byWindow[trial.windowId] = (byWindow[trial.windowId] ?? 0) + 1;
}

const report = {
  schema: "RecoveryContractEvalReport/v1",
  drivenBy: "agent",
  actor: ACTOR,
  realHumanEvidence: false,
  generatedAt: new Date().toISOString(),
  manifest: {
    schema: manifest.schema,
    frozenAt: manifest.frozenAt,
    manifestHash: manifest.manifestHash,
    windows: manifest.windows.length,
    longSessionPairs: manifest.longSessionPairs.length,
  },
  trialReceiptsDir: dir.replaceAll("\\", "/"),
  pairReceiptsDir: pairDir.replaceAll("\\", "/"),
  trialCountsByWindow: byWindow,
  rejectedEvidence,
  readbackJudgements,
  evaluation: result,
};

if (!check && !verifyPath) {
  mkdirSync(OUT_DIR, { recursive: true });
  const output = resolve(argValue("--output", join(OUT_DIR, "report.json")));
  mkdirSync(dirname(output), { recursive: true });
  writeJson(output, report);
  writeJson(join(dirname(output), "recovery-contract-eval-manifest.json"), manifest);
  console.log(`wrote ${output}`);
}

const reproduced = recorded
  ? JSON.stringify(recorded.evaluation) === JSON.stringify(result) &&
    JSON.stringify(recorded.readbackJudgements) === JSON.stringify(readbackJudgements)
  : undefined;

console.log(
  JSON.stringify(
    {
      status: result.status,
      ...(recorded ? { reproduced } : {}),
      decision: result.decision.disposition,
      qualityClaimAllowed: result.qualityClaimAllowed,
      trialCountsByWindow: byWindow,
      metrics: result.metrics,
      blockers: result.blockers,
      unmeasured: result.unmeasured,
    },
    null,
    1,
  ),
);

process.exit(recorded ? (reproduced ? 0 : 1) : result.status === "PASS" ? 0 : 1);
