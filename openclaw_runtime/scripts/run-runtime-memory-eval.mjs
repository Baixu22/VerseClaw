#!/usr/bin/env node

// Phase 38 D3 + Phase 39 Task #87: Aggregate runtime-memory evaluation runner.
// Runs the real aggregate report test first (which produces real metrics from
// actual eval scenarios), then runs the full test suite for pass/fail summary,
// and merges the test results into the artifact.
//
// The artifact at artifacts/runtime-memory-eval/report.json contains:
//   - Real enhanced report with actual dimension data (longConversation,
//     latencyBenchmark, utility, crossAxisRejection, hazardSuppression,
//     conflictResolution) from real eval scenarios
//   - Real rejection coverage (13/13 reasons with actual fired counts)
//   - Real rejection reason distribution from actual consumer results
//   - Test suite pass/fail summary
//
// Usage: node openclaw_runtime/scripts/run-runtime-memory-eval.mjs
// Or:    pnpm eval:runtime-memory:full

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");
const artifactsDir = path.join(projectRoot, "artifacts", "runtime-memory-eval");

// The real aggregate report test runs all real eval scenarios and writes
// the artifact with real metrics. Run it first so the artifact exists.
const REAL_AGGREGATE_TEST =
  "tests/unit/runtime-memory-eval-aggregate-report-real.test.ts";

const TEST_FILES = [
  "tests/unit/runtime-memory-eval-statistics.test.ts",
  "tests/unit/runtime-memory-eval-chain-eval.test.ts",
  "tests/unit/runtime-memory-eval-utility-scorer.test.ts",
  "tests/unit/runtime-memory-eval-temporal-evolution.test.ts",
  "tests/unit/runtime-memory-eval-topic-drift.test.ts",
  "tests/unit/runtime-memory-eval-budget-pressure.test.ts",
  "tests/unit/runtime-memory-eval-enhanced-report.test.ts",
  "tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts",
  "tests/unit/runtime-memory-eval-conflict-resolution.test.ts",
  "tests/unit/runtime-memory-eval-hazard-sentinel.test.ts",
  "tests/unit/runtime-memory-eval-cross-axis-rejection.test.ts",
  "tests/unit/runtime-memory-eval-enhanced-integration.test.ts",
  "tests/unit/runtime-memory-eval-rejection-coverage-gate.test.ts",
  "tests/unit/runtime-memory-eval-latency-benchmark.test.ts",
  "tests/unit/runtime-memory-eval-latency-benchmark-real.test.ts",
  "tests/unit/runtime-memory-eval-aggregate-report.test.ts",
  REAL_AGGREGATE_TEST,
];

function runVitest(testFile, useVerbose = false) {
  try {
    const args = ["node_modules/vitest/vitest.mjs", "run", testFile, "--reporter=json"];
    const output = execFileSync(process.execPath, args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, output: error.stdout ?? error.stderr ?? error.message };
  }
}

function parseVitestJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function main() {
  console.log("Phase 39: Real aggregate report generation\n");
  console.log("Step 1: Running real aggregate report test (produces real metrics artifact)...");
  process.stdout.write(`  ${REAL_AGGREGATE_TEST} ... `);
  const realResult = runVitest(REAL_AGGREGATE_TEST);
  const realParsed = parseVitestJson(realResult.output);
  if (realResult.success && realParsed) {
    console.log(`PASS (${realParsed.numPassedTests ?? 0}/${realParsed.numTotalTests ?? 0})`);
  } else {
    console.log("FAIL — artifact will not contain real metrics");
    console.log("  The remaining suite will still run for pass/fail summary.");
  }

  console.log("\nStep 2: Running full test suite (16 files) for pass/fail summary...\n");

  mkdirSync(artifactsDir, { recursive: true });

  const failedFiles = [];
  let passedFiles = 0;
  let totalTests = 0;
  let passedTests = 0;

  for (const testFile of TEST_FILES) {
    process.stdout.write(`  ${testFile} ... `);
    const result = runVitest(testFile);
    const parsed = parseVitestJson(result.output);

    if (result.success && parsed) {
      const total = parsed.numTotalTests ?? 0;
      const passed = parsed.numPassedTests ?? 0;
      totalTests += total;
      passedTests += passed;
      passedFiles += 1;
      console.log(`PASS (${passed}/${total})`);
    } else {
      failedFiles.push(testFile);
      const total = parsed?.numTotalTests ?? 0;
      const passed = parsed?.numPassedTests ?? 0;
      totalTests += total;
      passedTests += passed;
      console.log(`FAIL (${passed}/${total})`);
    }
  }

  // Step 3: Merge test suite results into the real artifact.
  // The real aggregate report test already wrote report.json with real metrics
  // but testSuite = {0, 0, []}. Update it with the actual pass/fail counts.
  const jsonPath = path.join(artifactsDir, "report.json");
  const mdPath = path.join(artifactsDir, "report.md");

  if (existsSync(jsonPath)) {
    const realReport = JSON.parse(readFileSync(jsonPath, "utf-8"));
    realReport.testSuite = {
      totalFiles: TEST_FILES.length,
      passedFiles,
      failedFiles,
      totalTests,
      passedTests,
    };
    writeFileSync(jsonPath, JSON.stringify(realReport, null, 2) + "\n", "utf-8");
    writeFileSync(mdPath, formatMarkdown(realReport), "utf-8");
  } else {
    // Fallback: if real aggregate test failed, write a minimal report
    const report = {
      generatedAt: Date.now(),
      testSuite: {
        totalFiles: TEST_FILES.length,
        passedFiles,
        failedFiles,
        totalTests,
        passedTests,
      },
      note: "Real aggregate report test failed — metrics not available. See test output above.",
    };
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
    writeFileSync(mdPath, formatMarkdown(report), "utf-8");
  }

  console.log(`\nResults: ${passedFiles}/${TEST_FILES.length} files passed, ${passedTests}/${totalTests} tests passed`);
  console.log(`\nArtifacts written to:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);

  if (failedFiles.length > 0) {
    process.exit(1);
  }
}

function formatMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Memory Aggregate Evaluation Report");
  lines.push("");
  lines.push(`- Generated at: ${new Date(report.generatedAt).toISOString()}`);
  lines.push("");

  if (report.enhancedReport) {
    const er = report.enhancedReport;
    lines.push("## Enhanced Report Summary");
    lines.push("");
    lines.push(`- Overall score: ${er.summary.overallScore.toFixed(4)}`);
    lines.push(`- Dimensions scored: ${Object.keys(er.summary.dimensionScores).length}`);
    lines.push("");

    lines.push("### Dimension Scores");
    lines.push("");
    lines.push("| Dimension | Score |");
    lines.push("|-----------|-------|");
    for (const [dim, score] of Object.entries(er.summary.dimensionScores)) {
      lines.push(`| ${dim} | ${score.toFixed(4)} |`);
    }
    lines.push("");

    if (er.summary.strengths.length > 0) {
      lines.push("### Strengths");
      lines.push("");
      for (const s of er.summary.strengths) {
        lines.push(`- ${s}`);
      }
      lines.push("");
    }

    if (er.summary.weaknesses.length > 0) {
      lines.push("### Weaknesses");
      lines.push("");
      for (const w of er.summary.weaknesses) {
        lines.push(`- ${w}`);
      }
      lines.push("");
    }

    if (er.summary.recommendations.length > 0) {
      lines.push("### Recommendations");
      lines.push("");
      for (const r of er.summary.recommendations) {
        lines.push(`- ${r}`);
      }
      lines.push("");
    }

    if (er.rejectionReasonDistribution && er.rejectionReasonDistribution.length > 0) {
      lines.push("### Rejection Reason Distribution");
      lines.push("");
      lines.push("| Reason | Count | Percentage |");
      lines.push("|--------|-------|------------|");
      for (const entry of er.rejectionReasonDistribution) {
        lines.push(`| ${entry.reason} | ${entry.count} | ${(entry.percentage * 100).toFixed(1)}% |`);
      }
      lines.push("");
    }
  }

  if (report.rejectionCoverage) {
    lines.push("## Rejection Coverage");
    lines.push("");
    lines.push(`- Total reasons: ${report.rejectionCoverage.totalReasons}`);
    lines.push(`- Fired reasons: ${report.rejectionCoverage.firedReasons.length}`);
    lines.push(`- Missing reasons: ${report.rejectionCoverage.missingReasons.length}`);
    lines.push(`- Coverage rate: ${(report.rejectionCoverage.coverageRate * 100).toFixed(1)}%`);
    lines.push("");

    if (report.rejectionCoverage.missingReasons.length > 0) {
      lines.push("### Missing Rejection Reasons");
      lines.push("");
      for (const reason of report.rejectionCoverage.missingReasons) {
        lines.push(`- ${reason}`);
      }
      lines.push("");
    }

    if (report.rejectionCoverage.firedReasons.length > 0) {
      lines.push("### Fired Rejection Reasons");
      lines.push("");
      for (const reason of report.rejectionCoverage.firedReasons) {
        lines.push(`- ${reason}`);
      }
      lines.push("");
    }
  }

  if (report.testSuite) {
    lines.push("## Test Suite");
    lines.push("");
    lines.push(`- Total files: ${report.testSuite.totalFiles}`);
    lines.push(`- Passed files: ${report.testSuite.passedFiles}`);
    lines.push(`- Failed files: ${report.testSuite.failedFiles.length}`);
    if (report.testSuite.totalTests !== undefined) {
      lines.push(`- Total tests: ${report.testSuite.totalTests}`);
      lines.push(`- Passed tests: ${report.testSuite.passedTests}`);
    }
    if (report.testSuite.failedFiles.length > 0) {
      lines.push("");
      lines.push("### Failed Files");
      lines.push("");
      for (const f of report.testSuite.failedFiles) {
        lines.push(`- ${f}`);
      }
    }
    lines.push("");
  }

  if (report.note) {
    lines.push("## Note");
    lines.push("");
    lines.push(report.note);
    lines.push("");
  }

  return lines.join("\n");
}

main();
