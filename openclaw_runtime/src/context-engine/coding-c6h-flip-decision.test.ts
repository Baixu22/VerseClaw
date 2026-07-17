import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "./coding-observability.js";
import {
  loadC6hCorpusManifest,
  runC6hCorpusEvidence,
  runLongChatCurveFromCorpus,
} from "./coding-c6h-corpus.js";
import {
  buildAssemblerFlipDecision,
  evaluateAssemblerFlipGates,
} from "./coding-c6h-flip-decision.js";

describe("coding-c6h-corpus + flip-decision (Goal B / B1)", () => {
  beforeEach(() => codingObservability.reset());
  afterEach(() => codingObservability.reset());

  it("synthetic path never claims live64k and keeps auto flip false", () => {
    const corpus = runC6hCorpusEvidence({ preferRecordedFixture: false });
    expect(corpus.kind).toBe("synthetic");
    expect(corpus.live64k).toBe(false);
    expect(corpus.report.cumulativeRawChars).toBeGreaterThanOrEqual(64_000);
    expect(corpus.report.flipGates.readyToConsiderAssemblerFlip).toBe(false);

    const decision = buildAssemblerFlipDecision({ corpus });
    expect(decision.autoAppliedAssemblerFlip).toBe(false);
    expect(decision.readyToConsiderAssemblerFlip).toBe(false);
    expect(decision.recommendation).toBe("metrics-green-review-required");
    expect(decision.defaultsUnchanged).toBe(true);
    expect(decision.metricGates.allMetricGatesGreen).toBe(true);
  });

  it("recorded fixture yields recorded64k without live claim", () => {
    const root = process.cwd().includes("openclaw_runtime")
      ? path.resolve(process.cwd(), "..")
      : process.cwd();
    const corpus = runC6hCorpusEvidence({
      repoRoot: root,
      preferRecordedFixture: true,
    });
    // Fixture may or may not resolve depending on cwd; if resolved, honesty holds.
    if (corpus.sourcePath) {
      expect(corpus.kind).toBe("recorded");
      expect(corpus.live64k).toBe(false);
      expect(corpus.recorded64k).toBe(true);
    }
    const decision = buildAssemblerFlipDecision({ corpus });
    expect(decision.readyToConsiderAssemblerFlip).toBe(false);
    expect(decision.autoAppliedAssemblerFlip).toBe(false);
  });

  it("product review may set readyToConsider but never auto-applies", () => {
    const corpus = runC6hCorpusEvidence({ preferRecordedFixture: false });
    const decision = buildAssemblerFlipDecision({
      corpus,
      productReviewApproved: true,
    });
    expect(decision.metricGates.allMetricGatesGreen).toBe(true);
    expect(decision.readyToConsiderAssemblerFlip).toBe(true);
    expect(decision.autoAppliedAssemblerFlip).toBe(false);
    expect(decision.recommendation).toBe("product-review-may-consider");
  });

  it("loads explicit live corpus only when kind is live", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c6h-live-"));
    try {
      const file = path.join(dir, "live.json");
      writeFileSync(
        file,
        JSON.stringify({
          kind: "live",
          targetCumulativeChars: 64_000,
          turns: Array.from({ length: 16 }, (_, i) => ({
            turn: i + 1,
            rawChars: 4000,
          })),
        }),
        "utf8",
      );
      const manifest = loadC6hCorpusManifest(file);
      expect(manifest.kind).toBe("live");
      const report = runLongChatCurveFromCorpus(manifest);
      expect(report.cumulativeRawChars).toBeGreaterThanOrEqual(64_000);
      const corpus = runC6hCorpusEvidence({
        corpusPath: file,
        preferRecordedFixture: false,
        env: { ...process.env, DCS_C6H_CORPUS_KIND: "live" },
      });
      expect(corpus.live64k).toBe(true);
      expect(corpus.report.flipGates.readyToConsiderAssemblerFlip).toBe(false);
      const gates = evaluateAssemblerFlipGates(corpus.report);
      expect(gates.allMetricGatesGreen).toBe(true);
      const decision = buildAssemblerFlipDecision({ corpus });
      expect(decision.readyToConsiderAssemblerFlip).toBe(false);
      expect(decision.autoAppliedAssemblerFlip).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
