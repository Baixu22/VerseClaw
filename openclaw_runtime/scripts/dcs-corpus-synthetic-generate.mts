/**
 * Generate deterministic synthetic-agent coding corpus (≥30 tasks, 3 arms).
 * Writes fixtures + artifacts (allowlisted) and validates schema.
 *
 * Usage: node --import tsx scripts/dcs-corpus-synthetic-generate.mts [--seed=42] [--tasks=32]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCorpus } from "../src/context-engine/dcs-corpus-schema.ts";
import {
  DEFAULT_SYNTHETIC_CORPUS_SEED,
  DEFAULT_SYNTHETIC_TASK_COUNT,
  countSyntheticTasks,
  generateSyntheticAgentCorpus,
} from "../src/context-engine/dcs-corpus-synthetic.ts";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(runtimeRoot, "..");

function parseArg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

function main(): void {
  const seed = parseArg("seed", DEFAULT_SYNTHETIC_CORPUS_SEED);
  const taskCount = Math.max(30, parseArg("tasks", DEFAULT_SYNTHETIC_TASK_COUNT));
  const doc = generateSyntheticAgentCorpus({ seed, taskCount });
  const validated = validateCorpus(doc);

  const fixturePath = path.join(
    runtimeRoot,
    "src/context-engine/fixtures/dcs-corpus-synthetic-agent.json",
  );
  const artifactDir = path.join(repoRoot, "artifacts/dcs-corpus/synthetic-agent");
  mkdirSync(path.dirname(fixturePath), { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  const json = JSON.stringify(validated, null, 2) + "\n";
  writeFileSync(fixturePath, json, "utf8");
  writeFileSync(path.join(artifactDir, "corpus.json"), json, "utf8");
  writeFileSync(
    path.join(artifactDir, "manifest.json"),
    JSON.stringify(
      {
        ok: true,
        kind: "synthetic-agent",
        live: false,
        seed,
        taskCount: countSyntheticTasks(validated),
        entryCount: validated.entries.length,
        fixturePath: path.relative(repoRoot, fixturePath).split(path.sep).join("/"),
        artifactPath: "artifacts/dcs-corpus/synthetic-agent/corpus.json",
        ts: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: validated.kind,
        seed,
        taskCount: countSyntheticTasks(validated),
        entryCount: validated.entries.length,
        fixturePath,
        artifactDir,
      },
      null,
      2,
    ),
  );
}

main();