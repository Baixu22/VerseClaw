import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SPEC = "harness/specs/tasks/harness-gap-v02-frozen-acceptance.md";
const V03_SPEC = "harness/specs/tasks/harness-gap-delivery-verdict.md";
const V02_JSON = "docs/dev/harness-gap-closure/v02-acceptance.json";
const V02_DOC = "docs/dev/harness-gap-closure/v02-frozen-acceptance.md";
const V03_JSON = "docs/dev/harness-gap-closure/v03-acceptance.json";
const V03_DOC = "docs/dev/harness-gap-closure/v03-delivery-verdict.md";

describe("harness-gap V02/V03 acceptance records", () => {
  it("has the V02/V03 specs, evidence docs and JSON records on disk", () => {
    for (const rel of [SPEC, V03_SPEC, V02_JSON, V02_DOC, V03_JSON, V03_DOC]) {
      expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });

  it("records V02 as an internal controlled PASS with every gate green and zero test failures", () => {
    const acc = JSON.parse(readFileSync(path.join(ROOT, V02_JSON), "utf8"));
    expect(acc.decision.status).toBe("PASS");
    expect(acc.decision.scope).toBe("internal-controlled-acceptance");
    for (const gate of [
      "fullUnit",
      "typecheckUncached",
      "lintFull",
      "commsReplay",
      "commsCompare",
      "contractCheck",
      "i18nLint",
      "buildVite",
      "harnessCi",
      "agentDevAudit",
    ]) {
      expect(acc.gates[gate].exitCode, gate).toBe(0);
    }
    // The Playwright process exits 1 only from the documented worker-teardown
    // artifact; the test-level result must be zero failures.
    expect(acc.gates.fullElectronE2E.failed).toBe(0);
    expect(acc.gates.fullElectronE2E.passed).toBeGreaterThan(300);
    expect(acc.gates.fullElectronE2E.verdict).toBe("PASS");
    expect(acc.gates.fullElectronE2E.note).toMatch(/teardown/i);
    expect(acc.residual.resolvedInThisCandidate.length).toBeGreaterThanOrEqual(3);
    expect(acc.residual.notRun.length).toBeGreaterThanOrEqual(2);
    expect(acc.productLocks).toEqual({ live_ready: false, product_approved: false, default_on: false, changed: false });
  });

  it("records V03 as an internal controlled verdict with product locks unchanged", () => {
    const acc = JSON.parse(readFileSync(path.join(ROOT, V03_JSON), "utf8"));
    expect(["PARTIAL", "NO-GO"]).toContain(acc.verdict.status);
    expect(acc.verdict.gaReady).toBe(false);
    expect(acc.productLocks).toEqual({ live_ready: false, product_approved: false, default_on: false, changed: false });
    expect(acc.driven_by).toBe("agent");
  });
});
