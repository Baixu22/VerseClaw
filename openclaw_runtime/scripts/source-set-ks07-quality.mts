/**
 * KS-07 committed SourceSet quality report runner.
 *
 * Runs the committed corpus with the real engine (no embedding provider in the
 * offline worktree, so the semantic lane is honestly reported as unavailable)
 * and writes the reproducible JSON report into the knowledge evidence tree.
 *
 * Usage: node --import tsx scripts/source-set-ks07-quality.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSourceSetQualityCorpus } from "../src/context-engine/source-set-quality.ts";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(runtimeRoot, "..");
const fixturePath = path.join(
  runtimeRoot,
  "src/context-engine/fixtures/source-set-ks07-corpus.json",
);
const reportPath = path.join(
  repoRoot,
  "docs/dev/knowledge-system-unification/quality/KS-07-SOURCE-SET-QUALITY.json",
);

async function main(): Promise<void> {
  const report = await evaluateSourceSetQualityCorpus({ fixturePath });

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const failures: string[] = [];
  if (report.metrics.recallAt5 !== 1) failures.push("recallAt5 must be 1");
  if (report.metrics.precisionAt5 !== 1) failures.push("precisionAt5 must be 1");
  if (report.metrics.citationValidity !== 1) failures.push("citationValidity must be 1");
  if (report.metrics.conflictDisclosure !== 1) failures.push("conflictDisclosure must be 1");
  if (report.metrics.staleInclusion.retrieved !== 0) failures.push("staleInclusion.retrieved must be 0");
  if (report.metrics.staleInclusion.groundedClaims !== 0) failures.push("staleInclusion.groundedClaims must be 0");
  if (report.humanUsefulness !== "not-evaluated (E4 missing)") failures.push("human usefulness must stay not-evaluated");
  if (report.semanticAvailability) failures.push("committed run must not claim semantic availability without a real provider");

  if (failures.length > 0) {
    console.error(`KS-07 SourceSet quality report failed: ${failures.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixturePath,
        fixtureSha256: report.fixtureSha256,
        reportPath,
        metrics: report.metrics,
        humanUsefulness: report.humanUsefulness,
        semanticAvailability: report.semanticAvailability,
      },
      null,
      2,
    ),
  );
}

void main();
