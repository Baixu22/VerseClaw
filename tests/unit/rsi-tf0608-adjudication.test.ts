// @vitest-environment node
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adjudicate, loadAdjudicationInputs, runNegativeControls, validateAdjudicationPack } from "../../scripts/rsi-tf0608-adjudication.mjs";

describe("TF-0608 independent adjudication", () => {
  it("recomputes the frozen upstream chain and refuses promotion on measured but unstable evidence", () => {
    const inputs = loadAdjudicationInputs(process.cwd());
    const verdict = adjudicate(inputs, undefined, process.cwd());
    expect(verdict.verdict).toBe("insufficient-evidence");
    expect(verdict.disposition).toBe("not-promote");
    expect(verdict.promotionReady).toBe(false);
    expect(verdict.reasons.map((entry) => entry.code)).toContain("insufficient-evidence");
    expect(verdict.recomputed.completeCaseCount).toBe(20);
    expect(verdict.recomputed.passK).toBe(0.15);
    expect(verdict.recomputed.passAtK).toBe(0.35);
    expect(verdict.recomputed.confidenceInterval95).toBeNull();
  });

  it("rejects actor collisions, fabricated results, path escape, drift and claim inflation", () => {
    const controls = runNegativeControls(loadAdjudicationInputs(process.cwd()), process.cwd());
    expect(controls).toHaveLength(12);
    expect(controls.every((control) => control.passed)).toBe(true);
  });

  it("re-reads the sealed pack and hash manifest from disk", () => {
    const result = validateAdjudicationPack(process.cwd());
    expect(result.passed).toBe(true);
    expect(result.controls).toHaveLength(12);
  }, 120000);

  it("rejects candidate tampering even when the manifest is re-signed", () => {
    const source = process.cwd();
    const clone = mkdtempSync(join(process.env.TEMP ?? tmpdir(), "rsi-tf0608-tamper-"));
    const fixtures = "harness/specs/fixtures/rsi-evidence-loop";
    try {
      cpSync(join(source, fixtures), join(clone, fixtures), { recursive: true });
      cpSync(join(source, "docs/dev/harness-gap-closure"), join(clone, "docs/dev/harness-gap-closure"), { recursive: true });
      const pack = join(clone, fixtures, "tf0606");
      const candidatePath = join(pack, "candidate.v1.json");
      const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
      candidate.promotionReady = true;
      writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + String.fromCharCode(10));
      const entries = ["candidate.v1.json", "report.v1.json", "control-results.v1.json"];
      const sums = entries.map((name) => createHash("sha256").update(readFileSync(join(pack, name))).digest("hex") + "  " + name).join(String.fromCharCode(10)) + String.fromCharCode(10);
      writeFileSync(join(pack, "SHA256SUMS"), sums);
      const verdict = adjudicate(loadAdjudicationInputs(clone), undefined, clone);
      expect(verdict.verdict).toBe("invalid");
      expect(verdict.reasons.map((entry) => entry.code)).toContain("candidate-recomputation");
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
