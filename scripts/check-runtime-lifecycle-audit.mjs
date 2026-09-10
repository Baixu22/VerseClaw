#!/usr/bin/env node
// Validates Runtime Lifecycle Governance audit JSON produced by
// harness/specs/tasks/runtime-lifecycle-governance.md.
//
// Usage:
//   node scripts/check-runtime-lifecycle-audit.mjs --phase 0
//   node scripts/check-runtime-lifecycle-audit.mjs --file artifacts/runtime-lifecycle-governance/audit-0.json
//   node scripts/check-runtime-lifecycle-audit.mjs --phase all
//
// The validator does not run the measurement commands. It enforces the
// recorded evidence contract: required fields, phase applicability, hard-gate
// thresholds, score recomputation, and reproducibility of the recorded
// `commands` list.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditDir = path.join(repoRoot, "artifacts", "runtime-lifecycle-governance");

function fail(message) {
  process.stderr.write(`[runtime-lifecycle-audit] ${message}\n`);
}

function parseArgs(argv) {
  const args = { phase: null, file: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--phase") {
      args.phase = argv[index + 1];
      index += 1;
    } else if (token === "--file") {
      args.file = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function requireObject(data, key) {
  const value = data[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}

function requireArray(data, key) {
  const value = data[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value;
}

function validateCommonShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("audit JSON must be an object");
  }
  if (typeof data.phase !== "string" || !/^[0-6]$/u.test(data.phase)) {
    throw new Error("phase must be one of \"0\"..\"6\"");
  }
  if (typeof data.createdAt !== "string" || !data.createdAt.trim()) {
    throw new Error("createdAt must be a non-empty string");
  }
  if (typeof data.gitBase !== "string" || !data.gitBase.trim()) {
    throw new Error("gitBase must be a non-empty string");
  }
  if (typeof data.programBase !== "string" || !data.programBase.trim()) {
    throw new Error("programBase must be a non-empty string (equals gitBase in audit-0)");
  }
  requireArray(data, "changedPaths");
  requireArray(data, "commands").forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`commands[${index}] must be a non-empty string`);
    }
  });
  if (data.commands.length === 0) {
    throw new Error("commands must not be empty");
  }

  for (const key of [
    "nonTestLocAdded",
    "nonTestLocRemoved",
    "testLocAdded",
    "maxModuleNonTestLoc",
    "typecheckErrors",
    "lintErrors",
    "contractErrors",
    "failedAcceptanceItems",
    "scopeCreepFiles",
    "missingEvidenceCommands",
  ]) {
    if (!isNonNegativeInteger(data[key])) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }

  requireArray(data, "deadCodeFindings").forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`deadCodeFindings[${index}] must be a non-empty string`);
    }
  });

  for (const key of ["importCycleDelta", "duplicateModuleDelta"]) {
    const delta = requireObject(data, key);
    for (const field of ["added", "resolved"]) {
      if (!isNonNegativeInteger(delta[field])) {
        throw new Error(`${key}.${field} must be a non-negative integer`);
      }
    }
  }

  const coverage = requireObject(data, "coverage");
  for (const key of ["statements", "branches", "functions"]) {
    if (!isNonNegativeNumber(coverage[key]) || coverage[key] > 100) {
      throw new Error(`coverage.${key} must be a number in 0..100`);
    }
  }

  const comms = requireObject(data, "comms");
  for (const key of ["lost", "duplicate", "reordered"]) {
    if (!isNonNegativeInteger(comms[key])) {
      throw new Error(`comms.${key} must be a non-negative integer`);
    }
  }

  const performance = requireObject(data, "performance");
  if (!isBoolean(performance.periodicHotPathPolling)) {
    throw new Error("performance.periodicHotPathPolling must be a boolean");
  }

  const checklist = requireObject(data, "phaseExitChecklist");
  for (const key of ["entryCriteria", "exitCriteria", "notInScopeRespected"]) {
    if (!isBoolean(checklist[key])) {
      throw new Error(`phaseExitChecklist.${key} must be a boolean`);
    }
  }

  if (!isNonNegativeInteger(data.score)) {
    throw new Error("score must be a non-negative integer");
  }
  requireArray(data, "failedGates").forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`failedGates[${index}] must be a non-empty string`);
    }
  });
}

function requiredPerformanceFields(phaseNumber) {
  const required = ["periodicHotPathPolling", "admissionPermitP95Ms"];
  if (phaseNumber >= 1) {
    required.push("leak50CycleHeapDeltaMb", "leak50CycleActiveRecords");
  }
  if (phaseNumber >= 2) {
    required.push("deleteCommitTxCount");
  }
  if (phaseNumber >= 3) {
    required.push("armTxCount", "processPollToolCalls");
  }
  return required;
}

function evaluateHardGates(data, phaseNumber) {
  const failures = [];
  const checklist = data.phaseExitChecklist;
  if (!checklist.entryCriteria || !checklist.exitCriteria || !checklist.notInScopeRespected) {
    failures.push("phase-exit-checklist");
  }
  if (data.typecheckErrors !== 0) failures.push("type-errors");
  if (data.lintErrors !== 0) failures.push("lint-errors");
  if (data.contractErrors !== 0) failures.push("contract-drift");
  if (data.comms.lost !== 0 || data.comms.duplicate !== 0 || data.comms.reordered !== 0) {
    failures.push("comms-regression");
  }
  if (data.importCycleDelta.added !== 0) failures.push("new-import-cycles");
  if (data.duplicateModuleDelta.added !== 0) failures.push("new-duplicate-modules");
  if (data.deadCodeFindings.length !== 0) failures.push("new-dead-code");
  if (data.scopeCreepFiles !== 0) failures.push("scope-guard");
  if (data.missingEvidenceCommands !== 0) failures.push("missing-evidence-commands");

  const coverage = data.coverage;
  const coverageGapPoints =
    Math.max(0, 90 - coverage.statements) +
    Math.max(0, 80 - coverage.branches) +
    Math.max(0, 90 - coverage.functions);
  if (coverage.statements < 90 || coverage.branches < 80 || coverage.functions < 90) {
    failures.push("coverage-threshold");
  }

  if (data.maxModuleNonTestLoc > 700) failures.push("module-line-budget");
  if (data.nonTestLocAdded > 6000) failures.push("total-loc-budget");
  if (data.nonTestLocAdded > 0 && data.testLocAdded / data.nonTestLocAdded < 0.8) {
    failures.push("test-loc-ratio");
  }

  const performance = data.performance;
  if (performance.periodicHotPathPolling !== false) failures.push("hot-path-periodic-polling");

  const phaseNumberValue = Number(data.phase);
  if (phaseNumberValue >= 0) {
    if (!isNonNegativeNumber(performance.admissionPermitP95Ms)) {
      failures.push("missing-admission-p95");
    }
  }
  if (phaseNumberValue >= 1) {
    if (performance.leak50CycleActiveRecords !== 0 || !isNonNegativeNumber(performance.leak50CycleHeapDeltaMb)) {
      failures.push("leak-record-invalid");
    }
    if (performance.leak50CycleHeapDeltaMb > 2) failures.push("leak-heap-budget");
  }
  if (phaseNumberValue >= 2 && performance.deleteCommitTxCount !== 1) {
    failures.push("delete-transaction-count");
  }
  if (phaseNumberValue >= 3) {
    if (performance.armTxCount !== 1) failures.push("arm-transaction-count");
    if (performance.processPollToolCalls !== 0) failures.push("goal-wake-polling");
  }

  const score = recomputeScore(data, coverageGapPoints);
  if (data.score !== score) failures.push("score-recomputation-mismatch");
  if (score < 85) failures.push("score-threshold");

  return { failures: [...new Set(failures)].sort(), score };
}

function recomputeScore(data, coverageGapPoints) {
  const raw =
    100 -
    data.failedAcceptanceItems * 5 -
    coverageGapPoints -
    data.deadCodeFindings.length * 5 -
    data.importCycleDelta.added * 10 -
    data.duplicateModuleDelta.added * 5 -
    data.scopeCreepFiles * 3 -
    data.missingEvidenceCommands * 5;
  return Math.max(0, raw);
}

function validateRecordedFailedGates(data, computedFailures) {
  const recorded = [...data.failedGates].sort();
  const computed = [...computedFailures].sort();
  if (JSON.stringify(recorded) !== JSON.stringify(computed)) {
    return [
      `failedGates mismatch: recorded=[${recorded.join(", ")}] computed=[${computed.join(", ")}]`,
    ];
  }
  return [];
}

function validateFile(filePath, expectedPhase = null) {
  const text = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(text);
  validateCommonShape(data);
  if (expectedPhase !== null && String(data.phase) !== String(expectedPhase)) {
    throw new Error(`phase mismatch: file reports ${data.phase}, expected ${expectedPhase}`);
  }
  const phaseNumber = Number(data.phase);
  for (const field of requiredPerformanceFields(phaseNumber)) {
    const value = data.performance[field];
    if (value === null || value === undefined) {
      throw new Error(`performance.${field} is required for phase ${data.phase}`);
    }
  }
  const { failures, score } = evaluateHardGates(data, phaseNumber);
  const mismatch = validateRecordedFailedGates(data, failures);
  return { data, failures, mismatch, score };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let files = [];

  if (args.file) {
    files = [{ file: args.file, expectedPhase: args.phase ?? null }];
  } else if (args.phase === "all") {
    for (let phase = 0; phase <= 6; phase += 1) {
      files.push({
        file: path.join(auditDir, `audit-${phase}.json`),
        expectedPhase: String(phase),
      });
    }
  } else if (args.phase !== null) {
    files = [
      {
        file: path.join(auditDir, `audit-${args.phase}.json`),
        expectedPhase: String(args.phase),
      },
    ];
  } else {
    fail("use --phase <0..6|all> or --file <path>");
    process.exitCode = 1;
    return;
  }

  let anyFailure = false;
  for (const entry of files) {
    const display = path.relative(repoRoot, entry.file);
    try {
      const { data, failures, mismatch, score } = validateFile(entry.file, entry.expectedPhase);
      const allFailures = [...failures, ...mismatch];
      if (allFailures.length > 0) {
        anyFailure = true;
        process.stdout.write(`${display}: FAIL score=${score} gates=[${allFailures.join(", ")}]\n`);
      } else {
        process.stdout.write(`${display}: PASS score=${score}\n`);
      }
    } catch (error) {
      anyFailure = true;
      process.stdout.write(`${display}: INVALID ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  process.exitCode = anyFailure ? 1 : 0;
}

main();
