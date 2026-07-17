/**
 * C1 canary A/B runner entrypoint.
 * Writes artifacts/dcs-canary/c1/ab-metrics.json + decision.json
 *
 * Usage: node --import tsx scripts/dcs-canary-c1.mts [--corpus=path] [--seed=42]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeC1CanaryArtifacts } from "../src/context-engine/dcs-canary-c1.ts";
import { DEFAULT_SYNTHETIC_CORPUS_SEED } from "../src/context-engine/dcs-corpus-synthetic.ts";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(runtimeRoot, "..");
const defaultCorpus = path.join(
  runtimeRoot,
  "src/context-engine/fixtures/dcs-corpus-synthetic-agent.json",
);

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function main(): void {
  const corpusPath = argValue("corpus");
  const seedRaw = argValue("seed");
  const seed = seedRaw ? Number(seedRaw) : DEFAULT_SYNTHETIC_CORPUS_SEED;
  const outDir = path.join(repoRoot, "artifacts/dcs-canary/c1");

  const useFixture = !corpusPath && existsSync(defaultCorpus) && !seedRaw;

  const result = writeC1CanaryArtifacts({
    outDir,
    corpusPath: corpusPath ?? (useFixture ? defaultCorpus : undefined),
    seed: Number.isFinite(seed) ? seed : DEFAULT_SYNTHETIC_CORPUS_SEED,
    productApproved: false,
    liveReady: false,
  });

  if (result.decision.recommendation === "default-on") {
    throw new Error("refusing to write default-on recommendation");
  }
  if (result.decision.liveReady !== false) {
    throw new Error("refusing liveReady=true from C1 canary");
  }
  if (result.decision.defaultsUnchanged !== true) {
    throw new Error("defaultsUnchanged must be true");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        taskCount: result.abMetrics.taskCount,
        reductionFactor: result.abMetrics.ab.reductionFactor,
        meetsSimGate: result.abMetrics.ab.meetsGate,
        decision: {
          meetsGate: result.decision.meetsGate,
          recommendation: result.decision.recommendation,
          productApproved: result.decision.productApproved,
          liveReady: result.decision.liveReady,
          defaultsUnchanged: result.decision.defaultsUnchanged,
        },
      },
      null,
      2,
    ),
  );
}

main();