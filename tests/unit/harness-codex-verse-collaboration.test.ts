import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = "harness/specs/fixtures/harness-codex-verse-collaboration";

describe("TF-0569 Verse collaboration evidence", () => {
  it("retains VB, VS and VG scenarios with explicit owner boundaries", () => {
    const receipt = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "acceptance.json"), "utf8"));
    expect(receipt.schemaVersion).toBe("HarnessVerseCollaborationAcceptance/v1");
    expect(receipt.driven_by).toBe("agent");
    expect(receipt.actor).toBeTruthy();
    expect(receipt.node).toBe("TF-0569");
    expect(receipt.scenarios.verseBrowser).toMatchObject({ status: "pass", tests: 1, passed: 1 });
    expect(receipt.scenarios.verseBrowser.negatives).toEqual(expect.arrayContaining(["private-network-default-deny", "forged agent private-network approval rejected"]));
    expect(receipt.scenarios.verseShell).toMatchObject({ status: "pass-contract", tests: 7, passed: 7 });
    expect(receipt.scenarios.verseShell.realProcessExecution).toBe("not-run");
    expect(receipt.scenarios.verseGit).toMatchObject({ status: "pass-diagnostics", tests: 2, passed: 2 });
    expect(receipt.scenarios.verseGit.candidateApply).toBe("not-run");
    expect(receipt.boundaries).toMatchObject({
      vgM4Authorized: false,
      vgLandingAuthority: false,
      vsDefaultOff: true,
      vbContractMethodCountAsRuntimeCoverage: false,
      harnessSelfApproval: false,
      realHumanEvidence: false,
    });
    expect(JSON.stringify(receipt)).not.toMatch(/sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+/);
  });

  it("keeps the retained manifest complete", () => {
    const manifest = readFileSync(resolve(ROOT, FIXTURE, "SHA256SUMS"), "utf8");
    for (const name of ["acceptance.json", "REPORT.md"]) {
      const hash = createHash("sha256").update(readFileSync(resolve(ROOT, FIXTURE, name))).digest("hex");
      expect(manifest).toContain(hash + "  " + name);
    }
  });
});
