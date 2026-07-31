import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runC1Canary, writeC1CanaryArtifacts } from "./dcs-canary-c1.js";
import { generateSyntheticAgentCorpus } from "./dcs-corpus-synthetic.js";

describe("dcs-canary-c1", () => {
  it("runs A/B on synthetic corpus and keeps honest packaging decision", () => {
    const corpus = generateSyntheticAgentCorpus({ seed: 42, taskCount: 32 });
    const { abMetrics, decision } = runC1Canary({ corpus, productApproved: false });

    expect(abMetrics.ok).toBe(true);
    expect(abMetrics.kind).toBe("synthetic-agent");
    expect(abMetrics.live).toBe(false);
    expect(abMetrics.taskCount).toBeGreaterThanOrEqual(30);
    expect(abMetrics.ab.fixtureCount).toBeGreaterThanOrEqual(30);
    expect(abMetrics.reductionDefinition).toMatchObject({
      formula: "mean(offArm toolCalls) / mean(onArm toolCalls) (ratio of means)",
      corpusId: "dcs-canary-c1-synthetic-seed-42",
      fixtureCount: 32,
      live: false,
      evidenceClass: "simulated-arm-synthetic",
      role: "reference-only",
      eligibleForGateAuthority: false,
    });

    expect(decision.productApproved).toBe(false);
    expect(decision.meetsGate).toBe(false);
    expect(decision.recommendation).not.toBe("default-on");
    expect(decision.liveReady).toBe(false);
    expect(decision.defaultsUnchanged).toBe(true);
    expect(decision.viewToolsDefaultUnchanged).toBe(true);
    expect(decision.flagId).toBeTruthy();
    expect(decision.killSwitch).toBeTruthy();
    expect(decision.howToEnable).toBeTruthy();
    expect(decision.ts).toBeTruthy();
    expect(decision.metrics.reductionDefinition).toEqual(abMetrics.reductionDefinition);
  });

  it("even with productApproved still packaging meetsGate false / no default-on", () => {
    const { decision } = runC1Canary({
      seed: 7,
      productApproved: true,
      liveReady: true, // ignored for synthetic
    });
    expect(decision.meetsGate).toBe(false);
    expect(decision.recommendation).not.toBe("default-on");
    expect(decision.liveReady).toBe(false);
    expect(decision.defaultsUnchanged).toBe(true);
  });

  it("writes ab-metrics.json and decision.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dcs-c1-"));
    try {
      const result = writeC1CanaryArtifacts({ outDir: dir, seed: 42 });
      const metrics = JSON.parse(readFileSync(path.join(dir, "ab-metrics.json"), "utf8"));
      const decision = JSON.parse(readFileSync(path.join(dir, "decision.json"), "utf8"));
      expect(metrics.ok).toBe(true);
      expect(decision.ok).toBe(true);
      expect(decision.recommendation).not.toBe("default-on");
      expect(result.decision.defaultsUnchanged).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
