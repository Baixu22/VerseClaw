import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const RUNTIME = path.join(ROOT, "openclaw_runtime");
const SCRIPT = path.join(ROOT, "scripts/a4-decision-quality-audit.mts");
// `tsx` is resolved from the runtime package, matching the repo convention for
// `pnpm --dir openclaw_runtime exec tsx ...` dev tools.
const TSX = pathToFileURL(path.join(RUNTIME, "node_modules/tsx/dist/loader.mjs")).href;

/**
 * A4 is frozen as "offline pure functions only": the ONLY sanctioned consumer
 * is an explicit dev-tool invocation. These tests exercise that CLI surface so
 * the dev-tool path is real and covered, without wiring A4 into any production
 * turn path.
 */
describe("A4 decision quality offline dev-tool", () => {
  it("runs the sanctioned CLI selftest", () => {
    const out = execFileSync(
      process.execPath,
      ["--import", TSX, SCRIPT, "--selftest"],
      { cwd: RUNTIME, encoding: "utf8" },
    );
    expect(out).toContain("selftest totalAudited=1 lowQualityCount=0");
  });

  it("audits a records file and fails the budget when the low-quality rate exceeds 10%", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a4-audit-"));
    const input = path.join(dir, "records.json");
    const out = path.join(dir, "report.json");
    const good = {
      decisionId: "good",
      reviewerAction: "continue",
      expectedAction: "continue",
      actionMatched: true,
      contextItemsAvailable: 10,
      contextItemsConsidered: 10,
      decisionTick: 0,
      maxTicksForDecision: 10,
    };
    // 4 of 5 decisions are low quality -> 80% rate, above the 10% budget.
    const bad = (index: number) => ({
      ...good,
      decisionId: `bad-${index}`,
      actionMatched: false,
      expectedAction: "continue",
      reviewerAction: "blocked",
      contextItemsConsidered: 0,
      decisionTick: 10,
    });
    writeFileSync(input, JSON.stringify([good, bad(1), bad(2), bad(3), bad(4)]));

    let failed = false;
    try {
      execFileSync(
        process.execPath,
        ["--import", TSX, SCRIPT, "--input", input, "--out", out],
        { cwd: RUNTIME, encoding: "utf8" },
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);

    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.totalAudited).toBe(5);
    expect(report.lowQualityCount).toBe(4);
    expect(report.withinBudget).toBe(false);
    expect(report.invoked_via).toBe("explicit-dev-tool-cli");
    expect(report.production_turn_path).toBe(false);
    expect(report.driven_by).toBe("agent");
  });

  it("keeps A4 out of the production runtime tree", () => {
    const manual = readFileSync(path.join(ROOT, "docs/runtime-design/development-manual.md"), "utf8");
    expect(manual).toContain("A4 is called ONLY via explicit dev-tool invocation");
  });
});
