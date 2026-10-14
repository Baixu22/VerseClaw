import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.RESOURCE_GOVERNANCE_STRESS !== "1")("resource governance stress production", () => {
  it("produces a fail-closed raw-sample and aggregate report", async () => {
    const module = await import("../../scripts/resource-governance-stress.mts");
    const report = await module.resourceGovernanceStressRun;
    expect(report?.decision.status).toBe("stress-ok");
    expect(report?.decision.zeroSampleFailClosed).toBe(true);
    const reportPath = path.join(module.stressOutputDir, "report.json");
    const rawPath = path.join(module.stressOutputDir, "raw-samples.jsonl");
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.existsSync(rawPath)).toBe(true);
    expect(fs.readFileSync(rawPath, "utf8").trim().split(/\r?\n/).length).toBeGreaterThan(0);
  }, 120_000);
});