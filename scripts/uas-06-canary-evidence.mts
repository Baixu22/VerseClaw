import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  summarizeUas06Canary,
  UAS06_ENGINEERING_SCENARIOS,
  type Uas06CanaryObservation,
} from "../openclaw_runtime/src/agents/verseshell/single-plane-canary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRelative = "artifacts/uas-06-single-local-exec-canary/report.json";
const outputPath = path.join(root, outputRelative);
const checkOnly = process.argv.includes("--check");

const sourceEvidence = [
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "README.ja-JP.md",
  "harness/specs/tasks/uas-06-single-local-exec-canary.md",
  "harness/specs/rules/verseshell-single-local-exec-canary-boundary.md",
  "openclaw_runtime/src/config/zod-schema.agent-runtime.ts",
  "openclaw_runtime/src/config/schema.help.ts",
  "openclaw_runtime/src/config/runtime-verseshell-foundation.test.ts",
  "openclaw_runtime/src/agents/bash-tools.exec-runtime.ts",
  "openclaw_runtime/src/agents/bash-tools.schemas.ts",
  "openclaw_runtime/src/agents/exec-defaults.ts",
  "openclaw_runtime/src/agents/verseshell/single-plane-canary.ts",
  "openclaw_runtime/src/agents/verseshell/single-plane-canary.test.ts",
  "openclaw_runtime/src/infra/diagnostic-events.ts",
  "openclaw_runtime/src/logging/diagnostic-stability.ts",
  "openclaw_runtime/src/logging/diagnostic-stability.exec.test.ts",
  "openclaw_runtime/extensions/diagnostics-otel/src/service.ts",
  "openclaw_runtime/test/vitest/vitest.verseshell.config.ts",
  "scripts/uas-06-canary-evidence.mts",
  "tests/unit/uas-06-single-local-exec-canary.test.ts",
  "docs/dev/verseshell-foundation/STATUS.md",
  "docs/dev/verseshell-foundation/CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md",
  "docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md",
  "docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md",
  "docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md",
  "docs/dev/handoffs/LATEST.md",
] as const;

const gates = [
  {
    id: "harness-structural",
    command: "pnpm",
    args: [
      "harness",
      "validate",
      "--spec",
      "harness/specs/tasks/uas-06-single-local-exec-canary.md",
      "--no-diff",
    ],
  },
  { id: "verseshell-matrix", command: "pnpm", args: ["verseshell:test"] },
  {
    id: "uas-06-boundary",
    command: "pnpm",
    args: [
      "exec",
      "vitest",
      "run",
      "tests/unit/uas-06-single-local-exec-canary.test.ts",
      "--reporter=verbose",
      "--maxWorkers=1",
    ],
  },
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function inventory() {
  return sourceEvidence.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath))
      throw new Error(`missing UAS-06 source evidence: ${relativePath}`);
    const content = readFileSync(absolutePath);
    return { path: relativePath, bytes: content.byteLength, sha256: sha256(content) };
  });
}

function compactOutput(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12);
}

function runGate(gate: (typeof gates)[number]) {
  const startedAt = Date.now();
  const isWindowsPnpm = process.platform === "win32" && gate.command === "pnpm";
  const command = isWindowsPnpm ? (process.env.ComSpec ?? "cmd.exe") : gate.command;
  const args = isWindowsPnpm
    ? ["/d", "/s", "/c", ["pnpm.cmd", ...gate.args].join(" ")]
    : [...gate.args];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    id: gate.id,
    command: [gate.command, ...gate.args].join(" "),
    status: result.status === 0 ? ("passed" as const) : ("failed" as const),
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    outputTail: compactOutput(`${stdout}\n${stderr}`),
  };
}

function engineeringObservations(gatesPassed: boolean): Uas06CanaryObservation[] {
  if (!gatesPassed) return [];
  return UAS06_ENGINEERING_SCENARIOS.map((scenario) => ({
    observationId: `engineering-${scenario}`,
    source: "engineering",
    cohortId: "uas-06-engineering-matrix",
    cohortArm: "verseshell",
    scenario,
    eligibleLocal: true,
    executionHost: "verseshell",
    lifecycleOwner: "verseshell",
    nativeFallback: false,
    outcome: "completed",
    durationMs: 0,
    recoveryState:
      scenario === "cancel" || scenario === "timeout"
        ? "killed"
        : scenario === "restart"
          ? "lost"
          : "exited",
    unauthorizedExecutionCount: 0,
    duplicateProcessCount: 0,
    lostOutputBytes: 0,
    sensitiveOutputLeakCount: 0,
    ...(scenario === "rollback" ? { rollbackSucceeded: true } : {}),
  }));
}

export function buildUas06EngineeringReport() {
  const verification = gates.map(runGate);
  const gatesPassed = verification.every((gate) => gate.status === "passed");
  const observations = engineeringObservations(gatesPassed);
  const summary = summarizeUas06Canary(observations);
  return {
    schema: "uas-06.engineering-evidence/v1",
    generatedAt: new Date().toISOString(),
    taskForestNode: "TF-0017",
    taskSpec: "harness/specs/tasks/uas-06-single-local-exec-canary.md",
    qualification: "engineering-only",
    sourceInventory: inventory(),
    verification,
    observations,
    summary,
    realEvidence: {
      internalCohortObservations: 0,
      pairedTasks: 0,
      actualProviderUsageRecords: 0,
      humanRecoveryRecords: 0,
      reviewedOperatorDrills: 0,
      soakDays: 0,
    },
    frozenLocks: {
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      tf0006: "blocked",
      tf0009: "review_needed",
      tf0018: "proposed",
      tf0019: "proposed",
      runtimeMemory: "diagnostics-only",
      sekbAutoWriteback: false,
    },
  };
}

export function checkUas06EngineeringReport() {
  if (!existsSync(outputPath)) throw new Error(`missing UAS-06 evidence report: ${outputRelative}`);
  const report = JSON.parse(readFileSync(outputPath, "utf8")) as ReturnType<
    typeof buildUas06EngineeringReport
  >;
  const currentInventory = inventory();
  if (JSON.stringify(report.sourceInventory) !== JSON.stringify(currentInventory)) {
    throw new Error("UAS-06 evidence is stale: source inventory changed");
  }
  if (report.qualification !== "engineering-only") {
    throw new Error("UAS-06 evidence qualification must remain engineering-only");
  }
  if (report.summary.status !== "needs-real-canary") {
    throw new Error(
      `UAS-06 engineering report must remain needs-real-canary, found ${report.summary.status}`,
    );
  }
  if (report.summary.productGraduationAuthorized !== false) {
    throw new Error("UAS-06 engineering report cannot authorize product graduation");
  }
  if (Object.values(report.realEvidence).some((value) => value !== 0)) {
    throw new Error("UAS-06 engineering report cannot contain qualifying real evidence counts");
  }
  return report;
}

if (checkOnly) {
  const report = checkUas06EngineeringReport();
  console.log(`UAS-06 evidence current: ${outputRelative} (${report.summary.status})`);
} else {
  const report = buildUas06EngineeringReport();
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`UAS-06 evidence written: ${outputRelative} (${report.summary.status})`);
  if (report.verification.some((gate) => gate.status !== "passed")) process.exitCode = 1;
}
