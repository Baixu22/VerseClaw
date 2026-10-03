import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildUas06RealCohortReport,
  UAS06_FROZEN_LOCKS,
  type Uas06EvidenceSourceInventoryEntry,
  type Uas06RealCohortReport,
} from "../openclaw_runtime/src/agents/verseshell/real-canary-evidence.ts";
import type { Uas06CanaryObservation } from "../openclaw_runtime/src/agents/verseshell/single-plane-canary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = "artifacts/uas-06-single-local-exec-canary";
const liveObservationsRelative = `${artifactDirectory}/live-observations.json`;
const engineeringReportRelative = `${artifactDirectory}/report.json`;
const outputRelative = `${artifactDirectory}/real-cohort-report.json`;
const checkOnly = process.argv.includes("--check");

export const UAS06_REAL_SOURCE_EVIDENCE = [
  "package.json",
  "harness/specs/tasks/uas-06-single-local-exec-canary.md",
  "harness/specs/rules/verseshell-single-local-exec-canary-boundary.md",
  "openclaw_runtime/src/agents/verseshell/single-plane-canary.ts",
  "openclaw_runtime/src/agents/verseshell/real-canary-evidence.ts",
  "openclaw_runtime/src/agents/verseshell/real-canary-evidence.test.ts",
  "scripts/uas-06-real-canary.mts",
  "tests/unit/uas-06-single-local-exec-canary.test.ts",
  "artifacts/uas-06-single-local-exec-canary/live-observations.json",
  "docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md",
  "docs/dev/verseshell-foundation/STATUS.md",
  "docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md",
  "docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md",
  "docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(relativePath: string): { raw: string; value: unknown } {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing UAS-06 evidence input: ${relativePath}`);
  const raw = readFileSync(absolutePath, "utf8");
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    throw new Error(`invalid JSON in UAS-06 evidence input: ${relativePath}`);
  }
}

export function inventoryUas06RealSources(sourceRoot = root): Uas06EvidenceSourceInventoryEntry[] {
  return UAS06_REAL_SOURCE_EVIDENCE.map((relativePath) => {
    const absolutePath = path.join(sourceRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`missing UAS-06 real evidence source: ${relativePath}`);
    }
    const content = readFileSync(absolutePath);
    return { path: relativePath, bytes: content.byteLength, sha256: sha256(content) };
  });
}

function readEngineeringEvidence(): {
  observations: Uas06CanaryObservation[];
  sha256: string;
} {
  const { raw, value } = readJson(engineeringReportRelative);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("UAS-06 engineering evidence must be an object");
  }
  const report = value as {
    qualification?: unknown;
    observations?: unknown;
    summary?: { status?: unknown; productGraduationAuthorized?: unknown };
  };
  if (report.qualification !== "engineering-only") {
    throw new Error("UAS-06 engineering evidence qualification must remain engineering-only");
  }
  if (report.summary?.status !== "needs-real-canary") {
    throw new Error("UAS-06 engineering evidence must remain needs-real-canary");
  }
  if (report.summary?.productGraduationAuthorized !== false) {
    throw new Error("UAS-06 engineering evidence cannot authorize product graduation");
  }
  if (!Array.isArray(report.observations)) {
    throw new Error("UAS-06 engineering evidence observations must be an array");
  }
  return {
    observations: report.observations as Uas06CanaryObservation[],
    sha256: sha256(raw),
  };
}

function buildReport(): Uas06RealCohortReport {
  const liveEvidence = readJson(liveObservationsRelative);
  const engineeringEvidence = readEngineeringEvidence();
  return buildUas06RealCohortReport({
    document: liveEvidence.value,
    engineeringObservations: engineeringEvidence.observations,
    generatedAt: new Date().toISOString(),
    liveObservationsSha256: sha256(liveEvidence.raw),
    engineeringReportSha256: engineeringEvidence.sha256,
    sourceInventory: inventoryUas06RealSources(),
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCurrentReport(report: unknown, expected: Uas06RealCohortReport): void {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("UAS-06 real cohort report must be an object");
  }
  const current = report as Partial<Uas06RealCohortReport>;
  if (current.schema !== expected.schema) throw new Error("UAS-06 real cohort report schema is stale");
  if (typeof current.generatedAt !== "string" || Number.isNaN(Date.parse(current.generatedAt))) {
    throw new Error("UAS-06 real cohort report has no valid generatedAt timestamp");
  }
  for (const [name, actual, expectedValue] of [
    ["taskForestNode", current.taskForestNode, expected.taskForestNode],
    ["taskSpec", current.taskSpec, expected.taskSpec],
    ["qualification", current.qualification, expected.qualification],
    ["sourceEvidence", current.sourceEvidence, expected.sourceEvidence],
    ["sourceInventory", current.sourceInventory, expected.sourceInventory],
    ["summary", current.summary, expected.summary],
    ["evidenceCounts", current.evidenceCounts, expected.evidenceCounts],
    ["closeout", current.closeout, expected.closeout],
    ["frozenLocks", current.frozenLocks, UAS06_FROZEN_LOCKS],
  ] as const) {
    if (!sameJson(actual, expectedValue)) throw new Error(`UAS-06 real cohort report is stale: ${name}`);
  }
  if (current.closeout?.taskForestCloseoutAuthorized !== false) {
    throw new Error("UAS-06 real cohort report cannot authorize Task Forest closeout");
  }
  if (current.closeout?.productGraduationAuthorized !== false) {
    throw new Error("UAS-06 real cohort report cannot authorize product graduation");
  }
  if (current.summary?.productGraduationAuthorized !== false) {
    throw new Error("UAS-06 real cohort summary cannot authorize product graduation");
  }
}

// Inventory imports are read-only; only the explicit CLI may create a new report.
// Use realpaths because this workspace is also reached through a Windows junction.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.slice(2).some((argument) => argument !== "--check")) {
    throw new Error("UAS-06 real evidence accepts no arguments other than --check");
  }
  if (checkOnly) {
    const outputPath = path.join(root, outputRelative);
    if (!existsSync(outputPath)) throw new Error(`missing UAS-06 real cohort report: ${outputRelative}`);
    const { value } = readJson(outputRelative);
    const expected = buildReport();
    assertCurrentReport(value, expected);
    console.log(`UAS-06 real evidence current: ${outputRelative} (${expected.summary.status})`);
  } else {
    const report = buildReport();
    const outputPath = path.join(root, outputRelative);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`UAS-06 real evidence written: ${outputRelative} (${report.summary.status})`);
  }
}
