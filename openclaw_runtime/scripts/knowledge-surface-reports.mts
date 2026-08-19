/**
 * KS-09 reproducible per-surface canary/graduation evaluator.
 *
 * Runs the committed unit/integration tests for all six knowledge surfaces,
 * optionally runs their committed Electron E2E evidence, applies the
 * no-default-on / no-GA / no-E4E5-fabrication assertions, and writes one JSON
 * report per surface plus a summary.
 *
 * Usage:
 *   node --import tsx scripts/knowledge-surface-reports.mts [--include-e2e]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoFalseGraduation,
  buildSurfaceReport,
  loadKnowledgeSurfacePlan,
  type KnowledgeCommandKind,
  type KnowledgeCommandResult,
  type KnowledgeSurfaceCommand,
} from "../src/knowledge/ks09-surface-report.ts";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(runtimeRoot, "..");
const planPath = path.join(
  runtimeRoot,
  "src/knowledge/fixtures/ks09-surface-plan.json",
);
const outDir = path.join(
  repoRoot,
  "docs/dev/knowledge-system-unification/surface-reports",
);

function commandParts(command: KnowledgeSurfaceCommand): { cmd: string; args: string[] } {
  const configByKind: Record<KnowledgeCommandKind, string | null> = {
    "runtime-unit": "test/vitest/vitest.unit.config.ts",
    "runtime-config": "test/vitest/vitest.runtime-config.config.ts",
    "runtime-agents": "test/vitest/vitest.agents.config.ts",
    "root-unit": null,
    e2e: null,
  };
  if (command.kind === "root-unit") {
    return { cmd: "pnpm", args: ["exec", "vitest", "run", ...command.files] };
  }
  if (command.kind === "e2e") {
    return { cmd: "pnpm", args: ["run", "test:e2e:run", ...command.files] };
  }
  const config = configByKind[command.kind];
  if (!config) throw new Error(`unsupported command kind ${command.kind}`);
  return {
    cmd: "pnpm",
    args: [
      "--dir",
      "openclaw_runtime",
      "exec",
      "node",
      "scripts/run-vitest.mjs",
      "run",
      "--config",
      config,
      ...command.files,
    ],
  };
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g"), "");
}

function parseVitestOutput(rawText: string): {
  testFilesPassed: number;
  testsPassed: number;
  testsFailed: number;
} {
  const text = stripAnsi(rawText);
  const filesMatches = [...text.matchAll(/Test Files\s+(\d+)\s+passed(?:\s+\((\d+)\))?/g)];
  const testsMatches = [...text.matchAll(/Tests\s+(\d+)\s+passed(?:\s+\((\d+)\))?/g)];
    const anyPassedMatches = [...text.matchAll(/(\d+)\s+passed/g)];
  const filesPassed = filesMatches.length > 0
    ? Number(filesMatches.at(-1)![1])
    : Number(anyPassedMatches.at(-1)?.[1] ?? 0);
  const testsPassed = testsMatches.length > 0
    ? Number(testsMatches.at(-1)![1])
    : filesPassed;
  const failedMatch = text.match(/Tests?\s+\d+\s+failed|\b(\d+)\s+failed\b/);
  const testsFailed = failedMatch ? Number(failedMatch[1] ?? 0) : 0;
  return { testFilesPassed: filesPassed, testsPassed, testsFailed };
}

async function runCommand(
  command: KnowledgeSurfaceCommand,
): Promise<KnowledgeCommandResult> {
  const { cmd, args } = commandParts(command);
  const startedAt = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      shell: process.platform === "win32",
      env: (() => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        return env;
      })(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        commandId: command.id,
        label: command.label,
        kind: command.kind,
        exitCode: 1,
        testFilesPassed: 0,
        testsPassed: 0,
        testsFailed: 0,
        durationMs: Date.now() - startedAt,
        outputSummary: error.message,
      });
    });
    child.on("close", (exitCode) => {
      const text = `${stdout}\n${stderr}`;
      const sanitizedOutput = stripAnsi(text);
      const parsed = parseVitestOutput(text);
      resolve({
        commandId: command.id,
        label: command.label,
        kind: command.kind,
        exitCode: exitCode ?? 1,
        testFilesPassed: parsed.testFilesPassed,
        testsPassed: parsed.testsPassed,
        testsFailed: parsed.testsFailed,
        durationMs: Date.now() - startedAt,
        outputSummary: sanitizedOutput
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-6)
          .join(" | "),
      });
    });
  });
}

async function main(): Promise<void> {
  const includeE2e = process.argv.includes("--include-e2e");
  const plan = loadKnowledgeSurfacePlan(planPath);
  const generatedAt = new Date().toISOString();
  const results = new Map<string, KnowledgeCommandResult>();
  let failedCommands = 0;

  for (const command of plan.guardCommands) {
    const result = await runCommand(command);
    results.set(command.id, result);
    if (result.exitCode !== 0) failedCommands += 1;
    console.log(`guard ${command.id}: exit=${result.exitCode} passed=${result.testsPassed}`);
  }

  for (const surface of plan.surfaces) {
    console.log(`surface ${surface.id} stage=${surface.currentStage}`);
    for (const command of surface.evaluation.commands) {
      if (command.kind === "e2e" && !includeE2e) {
        console.log(`  skip e2e ${command.id} (--include-e2e not set)`);
        continue;
      }
      const result = await runCommand(command);
      results.set(command.id, result);
      if (result.exitCode !== 0) failedCommands += 1;
      console.log(`  ${command.id}: exit=${result.exitCode} passed=${result.testsPassed} files=${result.testFilesPassed}`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const reports = plan.surfaces.map((surface) => {
    const report = buildSurfaceReport({
      plan,
      surface,
      results: Object.fromEntries(results),
      productLocks: plan.productLocks,
      includeE2e,
      generatedAt,
    });
    assertNoFalseGraduation(report, plan.productLocks);
    writeFileSync(
      path.join(outDir, `${surface.id}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    return report;
  });

  const guardResults = plan.guardCommands.map((command) => results.get(command.id)).filter(Boolean);
  const summary = {
    schema: "KnowledgeSurfaceSummary/v1",
    generatedAt,
    includeE2e,
    productLocks: plan.productLocks,
    failedCommands,
    guardResults: guardResults.map((result) => ({
      commandId: result?.commandId,
      exitCode: result?.exitCode,
      testsPassed: result?.testsPassed,
    })),
    surfaces: reports.map((report) => ({
      surfaceId: report.surfaceId,
      title: report.title,
      currentStage: report.currentStage,
      evidenceLevel: report.evidenceLevel,
      e4: report.e4,
      e5: report.e5,
      claims: report.claims,
    })),
  };
  writeFileSync(
    path.join(outDir, "KS-09-SUMMARY.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));

  if (failedCommands > 0) {
    console.error(`KS-09 surface evaluator failed: ${failedCommands} command(s) failed`);
    process.exitCode = 1;
  }
}

void main();
