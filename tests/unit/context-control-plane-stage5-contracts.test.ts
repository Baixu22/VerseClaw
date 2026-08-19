import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const runtimeRoot = path.join(repoRoot, "openclaw_runtime", "src", "context-engine");

describe("context control plane stage5 contracts", () => {
  it("has one explicit durable memory writer marker and no product lock mutation", () => {
    const source = fs.readFileSync(path.join(runtimeRoot, "stage5-memory-facade.ts"), "utf8");
    expect(source.match(/\.append\(/g)?.length ?? 0).toBe(1);
    expect(source).toContain("semantic-memory-owner:single-writer:v1");
    expect(source).not.toMatch(/defaultOn|liveReady|productApproved/);
  });

  it("keeps pure facade and packer free of wall-clock/random sources", () => {
    for (const file of ["stage5-memory-facade.ts", "stage5-unit-aware-packer.ts"]) {
      const source = fs.readFileSync(path.join(runtimeRoot, file), "utf8");
      expect(source).not.toMatch(/Date\.now|new Date|Math\.random/);
    }
  });

  it("does not introduce a second durable store or DCS authority", () => {
    const source = fs.readFileSync(path.join(runtimeRoot, "stage5-memory-facade.ts"), "utf8");
    expect(source).not.toMatch(/PromptPlan|CapabilityGrant|EffectReceipt|ReceiptStore|sqlite|database/i);
    expect(source).toContain("candidate-only");
  });

  it("fails closed on schema boundaries: whitelist enums, newlines, wildcards, ids, refs, and limits", () => {
    const facadeSource = fs.readFileSync(path.join(runtimeRoot, "stage5-memory-facade.ts"), "utf8");
    for (const reason of [
      "memory-invalid-tool-name",
      "memory-invalid-namespace",
      "memory-invalid-limit",
      "memory-invalid-backend",
      "memory-invalid-source",
      "memory-invalid-freshness",
      "memory-invalid-evidence-digest",
      "content-ref",
    ]) {
      expect(facadeSource).toContain(reason);
    }
    const packerSource = fs.readFileSync(path.join(runtimeRoot, "stage5-unit-aware-packer.ts"), "utf8");
    for (const reason of [
      "invalid-unit-priority",
      "invalid-unit-kind",
      "invalid-unit-id",
      "invalid-unit-source-ref",
      "duplicate-unit-id",
      "token-count",
    ]) {
      expect(packerSource).toContain(reason);
    }
    expect(packerSource).not.toMatch(/Date\.now|new Date|Math\.random/);
  });
});
