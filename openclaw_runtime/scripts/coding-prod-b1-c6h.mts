/**
 * Goal B / B1: C6-H live-or-recorded corpus + assembler flip-gate decision pack.
 * Never auto-flips assembler / context-ladder production defaults.
 *
 * Run from openclaw_runtime:
 *   node --import tsx scripts/coding-prod-b1-c6h.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { runC6hCorpusEvidence } from "../src/context-engine/coding-c6h-corpus.ts";
import { buildAssemblerFlipDecision } from "../src/context-engine/coding-c6h-flip-decision.ts";
import { applyContextLadder } from "../src/context-engine/context-ladder.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-b1");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  const corpus = runC6hCorpusEvidence({
    repoRoot,
    preferRecordedFixture: true,
  });

  // productReviewApproved intentionally false for packaging honesty
  const decision = buildAssemblerFlipDecision({
    corpus,
    productReviewApproved: false,
    extraNotes: ["packaging run: productReviewApproved=false by design"],
  });

  // Sanity: ladder remains callable opt-in without mutating defaults
  const ladderSmoke = applyContextLadder({
    blocks: [
      {
        block_id: "persona:main",
        block_type: "persona",
        source_system: "role-contract",
        session_id: "b1-smoke",
        presence: { always_on: true, background: false },
        entities: [],
        valid_at: new Date(),
        created_at: new Date(),
        mutability: "system_managed",
        summary: "persona",
        full_content: "persona core",
        compression_depth: 0,
        entity_extraction_status: "empty",
        heat: 100,
      },
    ],
    tokenBudget: 8000,
  });
  assert(ladderSmoke.activeBlocks.length >= 1, "ladder smoke active");

  assert(decision.autoAppliedAssemblerFlip === false, "no auto assembler flip");
  assert(decision.readyToConsiderAssemblerFlip === false, "no ready without product review");
  assert(decision.defaultsUnchanged === true, "defaults unchanged");
  assert(decision.live64k === false || decision.corpusKind === "live", "live honesty");
  assert(
    decision.metricGates.cumulativeRawGe64k === true,
    "need >=64K cumulative for B1 evidence",
  );
  assert(corpus.report.flipGates.readyToConsiderAssemblerFlip === false, "curve hard false");

  const acceptance = {
    ok: true,
    card: "B1",
    wave: "C6-H",
    completionClass: decision.completionClass,
    live64k: decision.live64k,
    recorded64k: decision.recorded64k,
    synthetic64k: decision.synthetic64k,
    corpusKind: decision.corpusKind,
    readyToConsiderAssemblerFlip: decision.readyToConsiderAssemblerFlip,
    autoAppliedAssemblerFlip: decision.autoAppliedAssemblerFlip,
    recommendation: decision.recommendation,
    defaultsUnchanged: true,
    metricGates: decision.metricGates,
    decisionPackageComplete: true,
    sha: gitShortSha(),
    ts: new Date().toISOString(),
  };

  writeFileSync(path.join(outDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "corpus.json"),
    JSON.stringify(
      {
        kind: corpus.kind,
        live64k: corpus.live64k,
        recorded64k: corpus.recorded64k,
        synthetic64k: corpus.synthetic64k,
        sourcePath: corpus.sourcePath,
        cumulativeRawChars: corpus.report.cumulativeRawChars,
        finalPromptCharsEstimate: corpus.report.finalPromptCharsEstimate,
        flipGates: corpus.report.flipGates,
        notes: corpus.notes,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(acceptance, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        card: "B1",
        noAutoAssemblerFlip: true,
        readyToConsiderAssemblerFlip: false,
        defaultsUnchanged: true,
        cumulativeRawGe64k: decision.metricGates.cumulativeRawGe64k,
        live64k: decision.live64k,
        recommendation: decision.recommendation,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(JSON.stringify(acceptance, null, 2));
}

main();
