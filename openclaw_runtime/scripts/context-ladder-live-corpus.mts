/**
 * TF-0462: agent-driven live corpus evidence for the explicit context ladder.
 *
 * Reads real current-session source/test files (not the synthetic 64K fixture),
 * writes a live corpus manifest, runs the C6-H curve, and records the advisory
 * flip decision. Defaults are never flipped and no human traffic is claimed.
 *
 * Run from repo root:
 *   node --import tsx openclaw_runtime/scripts/context-ladder-live-corpus.mts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runC6hCorpusEvidence } from "../experiments/coding-c6h-corpus.ts";
import { buildAssemblerFlipDecision } from "../experiments/coding-c6h-flip-decision.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "harness/specs/fixtures/context-ladder-live-corpus");

const sourceFiles = [
  "openclaw_runtime/src/context-engine/context-ladder.ts",
  "openclaw_runtime/src/context-engine/token-pressure.ts",
  "openclaw_runtime/src/context-engine/assembler.ts",
  "openclaw_runtime/src/context-engine/assembler.test.ts",
  "openclaw_runtime/src/context-engine/block-lifecycle.ts",
  "openclaw_runtime/src/context-engine/block-lifecycle.test.ts",
  "openclaw_runtime/src/agents/orchestration-patch-flow.ts",
  "openclaw_runtime/src/agents/orchestration-patch-flow.test.ts",
] as const;

type LiveCorpusManifest = {
  kind: "live";
  sessionId: string;
  source: "agent-driven current-session source corpus";
  targetCumulativeChars: number;
  turns: Array<{ turn: number; rawChars: number; label: string }>;
  notes: string[];
  driven_by: "agent";
  actor: "codex";
  sourceFiles: Array<{ path: string; sha256: string; rawChars: number }>;
  generatedAt: string;
  reproduceCommand: string;
};

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const turns: LiveCorpusManifest["turns"] = [];
  const fileRecords: LiveCorpusManifest["sourceFiles"] = [];
  let cumulative = 0;

  for (const [index, relativePath] of sourceFiles.entries()) {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = readFileSync(absolutePath, "utf8");
    const rawChars = content.length;
    cumulative += rawChars;
    turns.push({ turn: index + 1, rawChars, label: relativePath });
    fileRecords.push({
      path: relativePath,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
      rawChars,
    });
  }

  const generatedAt = new Date().toISOString();
  const manifest: LiveCorpusManifest = {
    kind: "live",
    sessionId: "tf-0462-agent-driven-live-corpus",
    source: "agent-driven current-session source corpus",
    targetCumulativeChars: cumulative,
    turns,
    notes: [
      "Agent-driven live corpus from current-session source/test files.",
      "Not human traffic; driven_by=agent and actor=codex.",
      "No synthetic 64K fixture is used.",
      "Assembler production defaults remain unchanged.",
    ],
    driven_by: "agent",
    actor: "codex",
    sourceFiles: fileRecords,
    generatedAt,
    reproduceCommand:
      "pnpm --dir openclaw_runtime exec tsx scripts/context-ladder-live-corpus.mts",
  };

  const manifestPath = path.join(outDir, "live-corpus.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const corpus = runC6hCorpusEvidence({
    repoRoot,
    corpusPath: manifestPath,
    preferRecordedFixture: false,
    env: {
      ...process.env,
      DCS_C6H_CORPUS_KIND: "live",
    },
  });

  const decision = buildAssemblerFlipDecision({
    corpus,
    productReviewApproved: false,
    extraNotes: [
      "TF-0462 live corpus is agent-driven from current repository source.",
      "No real-human traffic is claimed.",
      "Explicit assembler contextLadder request remains opt-in; defaults unchanged.",
    ],
  });

  const evidence = {
    schemaVersion: 1,
    driven_by: "agent",
    actor: "codex",
    generatedAt,
    task: "TF-0462",
    manifestPath: path.relative(repoRoot, manifestPath).split(path.sep).join("/"),
    reproduceCommand: manifest.reproduceCommand,
    corpusKind: corpus.kind,
    live64k: corpus.live64k,
    recorded64k: corpus.recorded64k,
    synthetic64k: corpus.synthetic64k,
    cumulativeRawChars: corpus.report.cumulativeRawChars,
    finalPromptCharsEstimate: corpus.report.finalPromptCharsEstimate,
    sourceTurnCount: manifest.turns.length,
    sourceFileCount: manifest.sourceFiles.length,
    defaultsUnchanged: decision.defaultsUnchanged,
    autoAppliedAssemblerFlip: decision.autoAppliedAssemblerFlip,
    readyToConsiderAssemblerFlip: decision.readyToConsiderAssemblerFlip,
    recommendation: decision.recommendation,
    notes: decision.notes,
  };

  writeFileSync(
    path.join(outDir, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(outDir, "decision.json"),
    `${JSON.stringify(decision, null, 2)}\n`,
    "utf8",
  );

  console.log(JSON.stringify(evidence, null, 2));
}

main();
