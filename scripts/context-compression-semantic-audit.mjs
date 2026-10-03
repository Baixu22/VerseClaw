#!/usr/bin/env node
/**
 * Deep semantic audit for the deterministic recovery summaries (TF-0074).
 *
 * Independent offline harness that re-derives the ground truth per manifest
 * sample and audits the generated summaries on the three semantic dimensions
 * the live judges flagged in the 2026-08-23 run:
 *
 *   1. expected-vs-failure: expected status reports must not be promoted as
 *      open failures / "inspect the failure" follow-ups.
 *   2. terminal state: Current State must be Done/Validated exactly when a
 *      verified completion exists after every unresolved failure.
 *   3. continuation consistency: the summary's continuation directive must
 *      agree with the evaluator's expected primary action (the exact class of
 *      divergence that invalidated 14/30 continuation results on 08-23).
 *
 * Model-free, fail-closed: exits non-zero when any audited sample fails.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildContinuationDirective,
  buildRecoveryLedger,
} from "./context-compression-recovery-ledger.mjs";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function actionSignature(action) {
  return `${action.kind}:${action.id}`;
}

// Mirrors the (now aligned) buildRealSample primary-action derivation in
// scripts/context-compression-eval-runner.mjs. Kept as an independent copy on
// purpose: this audit must notice when the two sides drift apart again.
function evalPrimaryAction(expected) {
  const fileFact = expected.find((item) => item.category === "file_context" || item.category === "file_mutation");
  const testFact = expected.find((item) => item.category === "test_result");
  const nextFact = expected.find((item) => item.id.includes("next-action"));
  const latestOutcomeFact = expected.filter((item) => item.id.includes("latest-outcome")).at(-1);
  const currentNextFact = nextFact && (
    !latestOutcomeFact
    || nextFact.evidence.line > latestOutcomeFact.evidence.line
  )
    ? nextFact
    : undefined;
  const actionableFailure = [...expected].reverse().find((item) => (
    Boolean(item.failureSummary?.followUp)
    && item.failureSummary.classification !== "expected_behavior"
    && !item.failureSummary.resolved
    && (!latestOutcomeFact || item.evidence.line > latestOutcomeFact.evidence.line)
  ));
  const pendingObjectiveFact = expected.filter((item) => item.id.includes('pending-objective')).at(-1);
  const primaryActionFact = actionableFailure
    ? { text: actionableFailure.failureSummary.followUp }
    : currentNextFact
      ?? (latestOutcomeFact
        ? { text: `Do not repeat completed work; preserve the validated outcome: ${latestOutcomeFact.text}` }
        : pendingObjectiveFact
          ? { text: pendingObjectiveFact.text }
          : undefined);
  const prefix = "EVAL";
  const primary = primaryActionFact
    ? { id: `${prefix}-continue`, kind: "decision", decision: primaryActionFact.text, critical: true }
    : fileFact
      ? { id: `${prefix}-read`, kind: "read_file", target: fileFact.text, critical: true }
      : { id: `${prefix}-inspect`, kind: "decision", decision: expected[0]?.text ?? "continue", critical: true };
  return { primary, testFact };
}

const manifestPath = resolve(argValue("--manifest", "reports/context-compression/production-manifest-30.json"));
const metaPath = resolve(argValue("--meta", "reports/context-compression/production-summaries-30-generated.meta.json"));
const summariesPath = resolve(argValue("--summaries", "artifacts/p6-tf0074-deterministic-recovery-30-v2/would-retry-summaries.jsonl"));

const manifest = readJson(manifestPath);
const meta = readJson(metaPath);
const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
const summaries = new Map(
  readFileSync(summariesPath, "utf8").trim().split("\n").map((line) => {
    const row = JSON.parse(line);
    return [row.sampleId, row.compressedSummary];
  }),
);

const results = [];
for (const sample of manifest.samples ?? []) {
  const sid = sample.id;
  const file = metaById.get(sid)?.file;
  const summary = summaries.get(sid) ?? "";
  const checks = [];
  const addCheck = (id, pass, detail) => checks.push({ id, pass, detail });

  if (!file || !summary) {
    addCheck("inputs.resolved", false, `file=${Boolean(file)} summary=${Boolean(summary)}`);
    results.push({ sampleId: sid, checks, pass: false });
    continue;
  }
  addCheck("inputs.resolved", true, "");

  const ordinalIndex = Number(/^R(\d+)$/u.exec(String(sid))?.[1] ?? 1) - 1;
  const ledger = buildRecoveryLedger(file, sid, {
    windowSize: Number(sample.cohort?.turn ?? 200),
    ordinalIndex,
  });
  const directive = buildContinuationDirective(ledger);
  const expected = ledger.expected ?? [];

  // --- Dimension 3: continuation consistency -------------------------------
  const evalSide = evalPrimaryAction(expected);
  const directivePrimary = directive.primary;
  const sameShape = directivePrimary.kind === evalSide.primary.kind
    && Boolean(directivePrimary.critical) === Boolean(evalSide.primary.critical);
  const sameDecision = directivePrimary.kind !== "decision"
    || String(directivePrimary.decision ?? "") === String(evalSide.primary.decision ?? "");
  addCheck(
    "continuation.evalDirectiveAgreement",
    sameShape && sameDecision,
    sameShape && sameDecision
      ? ""
      : `directive=${actionSignature(directivePrimary)} (${String(directivePrimary.decision ?? directivePrimary.target ?? "").slice(0, 80)}) vs eval=${actionSignature(evalSide.primary)} (${String(evalSide.primary.decision ?? evalSide.primary.target ?? "").slice(0, 80)})`,
  );
  const directiveInSummary = summary.includes("## Continuation Directive (authoritative)");
  addCheck("continuation.directivePresent", directiveInSummary, directiveInSummary ? "" : "summary lacks the authoritative continuation directive section");
  const directiveNamesAction = summary.includes(String(directivePrimary.id));
  addCheck("continuation.directiveNamesAction", directiveNamesAction, directiveNamesAction ? "" : `summary directive does not name action id ${directivePrimary.id}`);

  // --- Dimension 2: terminal state ------------------------------------------
  // Mirrors the v7 summary semantics (verified-completion fallback scoped to
  // the objective's task segment + plain-blocker resolution by later
  // completion) with an independent re-implementation; drift here should
  // force a sync review. Completion evidence from a later unrelated task must
  // not mark the objective done (R17/R12).
  const latestOutcome = expected.filter((item) => item.id.includes("latest-outcome")).at(-1);
  const objectiveFact = expected.find((item) => item.category === "objective");
  const segmentStartLine = objectiveFact?.evidence?.line ?? 0;
  const segmentEndLine = ledger.objectiveSegmentEndLine;
  const inObjectiveSegment = (entry) => (
    entry.line >= segmentStartLine
    && (segmentEndLine === undefined || entry.line < segmentEndLine)
  );
  const naturalAssistant = (ledger.entries ?? []).filter((entry) => (
    entry.role === "assistant"
    && typeof entry.text === "string"
    && entry.text.trim().length > 0
    && inObjectiveSegment(entry)
  ));
  const lastUserText = String(([...(ledger.entries ?? [])].filter((entry) => entry.role === "user").at(-1) ?? {}).text ?? "");
  const reportRequested = /\b(?:report|results?|summary)\b|报告|汇报|结果/iu.test(lastUserText);
  const auditCompletionEntry = naturalAssistant.filter((entry) => (
    /Exit code:\s*0\b|\b(?:Tests?|Test Files?)\s+\d+\s+passed\b|fixed and confirmed|successfully (?:completed|applied|verified)|已确认|确认完毕|已成功(?:执行|完成)|完成并(?:已|确认)|报告如下|尝试报告|最终报告|fix is in place|now logs? the error|已修复|(?:grep|rg|scan)[^\n]{0,200}\b(?:shows? the fixed|confirmed|confirms|verifies|no stray|is in place|验证通过|修复生效)\b/iu.test(String(entry.text ?? ""))
    || (reportRequested && /(?:\bresults?\b[:：]?|summary|结果[:：])/iu.test(String(entry.text ?? "")))
  )).at(-1);
  const verifiedCompletionLine = latestOutcome
    ? latestOutcome.evidence.line
    : (auditCompletionEntry ? auditCompletionEntry.line : undefined);
  const completionAfter = (line) => (auditCompletionEntry ? auditCompletionEntry.line >= line : false)
    || (latestOutcome ? latestOutcome.evidence.line >= line : false);
  const unresolvedBlockers = expected.filter((item) => (
    item.category === "blocker"
    && !(item.failureSummary && (item.failureSummary.resolved || item.failureSummary.classification === "expected_behavior"))
    && !completionAfter(item.evidence.line)
  ));
  const groundTruthDone = verifiedCompletionLine !== undefined
    && unresolvedBlockers.every((item) => verifiedCompletionLine >= item.evidence.line);
  const summaryDone = /## Current State\n- Done\/Validated/u.test(summary);
  addCheck(
    "terminalState.current stateMatchesGroundTruth",
    groundTruthDone === summaryDone,
    `groundTruthDone=${groundTruthDone} summaryDone=${summaryDone}`,
  );
  const hasOutcomeStatus = /## Outcome Status\n-/u.test(summary);
  addCheck("terminalState.outcomeStatusPresent", hasOutcomeStatus, hasOutcomeStatus ? "" : "summary lacks the Outcome Status section");
  if (groundTruthDone) {
    const preservesOutcome = summary.includes("Do not redo completed work");
    addCheck("terminalState.preserveDirective", preservesOutcome, preservesOutcome ? "" : "Done state must instruct not to redo completed work");
  }

  // --- Dimension 1: expected-vs-failure --------------------------------------
  const expectedStatusPromoted = expected.some((item) => item.failureSummary?.classification === "expected_behavior");
  if (expectedStatusPromoted) {
    const qualified = summary.includes("Expected status (not a failure):")
      || summary.includes("classification=expected_behavior");
    addCheck("expectedVsFailure.qualified", qualified, qualified ? "" : "window promotes expected_behavior facts but the summary does not qualify them");
    const notOpenFailure = !/## Active Failure Focus\n(?:- classification=(?!expected_behavior))/u.test(summary);
    addCheck("expectedVsFailure.notInActiveFocus", notOpenFailure, notOpenFailure ? "" : "expected_behavior entries leaked into Active Failure Focus");
  }
  const inProgressBlocker = /## Current State\n- In Progress: the latest unresolved blocker/u.exec(summary);
  if (inProgressBlocker) {
    const blockerText = summary.slice(inProgressBlocker.index, inProgressBlocker.index + 400);
    const looksExpected = /disabled[:=] ?true|unavailable[:=] ?true|禁用|不可用/u.test(blockerText);
    addCheck("expectedVsFailure.blockerNotExpectedStatus", !looksExpected, looksExpected ? "Current State blocker is an expected-status narration" : "");
  }
  const falseFollowUp = /followUp=Inspect the (?:product|code) failure around: [^;\n]*disabled[:=] ?true/u.test(summary);
  addCheck("expectedVsFailure.noInspectExpectedStatus", !falseFollowUp, falseFollowUp ? "expected status got an inspect-the-failure follow-up" : "");

  results.push({
    sampleId: sid,
    checks,
    pass: checks.every((check) => check.pass),
  });
}

const failed = results.filter((result) => !result.pass);
const byCheck = new Map();
for (const result of results) {
  for (const check of result.checks) {
    if (!check.pass) {
      const list = byCheck.get(check.id) ?? [];
      list.push(`${result.sampleId}: ${check.detail}`.trim());
      byCheck.set(check.id, list);
    }
  }
}

const report = {
  schema: "p6-semantic-audit/v1",
  generatedAt: new Date().toISOString(),
  manifestPath,
  manifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
  summariesPath,
  sampleCount: results.length,
  passedSamples: results.length - failed.length,
  failedSamples: failed.map((result) => result.sampleId),
  failuresByCheck: Object.fromEntries([...byCheck.entries()].map(([id, list]) => [id, list.slice(0, 8)])),
};
console.log(JSON.stringify(report, null, 2));

for (const result of failed) {
  console.error(`\n[${result.sampleId}] failed checks:`);
  for (const check of result.checks.filter((check) => !check.pass)) {
    console.error(`  - ${check.id}: ${check.detail}`);
  }
}
process.exitCode = failed.length ? 1 : 0;
