// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertRecoveryBuildInputs, recoveryAcceptancePassed } from "../../scripts/recovery-acceptance-checks.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("rejects missing runtime builds and malformed Electron paths before live sampling", () => {
  const root = mkdtempSync(join(tmpdir(), "recovery-build-"));
  roots.push(root);
  const binary = join(root, "electron.exe");
  writeFileSync(binary, "fixture executable");
  const files = ["dist-electron/main/index.js", "dist-electron/preload/index.js", "dist/index.html"];
  for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), "fixture"); }
  expect(() => assertRecoveryBuildInputs(root, binary + "\r\n")).toThrow("trailing whitespace");
  expect(() => assertRecoveryBuildInputs(root, binary)).toThrow("openclaw_runtime/dist/entry.js");
  mkdirSync(join(root, "openclaw_runtime/dist"), { recursive: true });
  writeFileSync(join(root, "openclaw_runtime/dist/entry.js"), "fixture");
  expect(() => assertRecoveryBuildInputs(root, binary)).not.toThrow();
});

const report = (status: string, rejectedEvidence: string[] = []) => ({ evaluation: { status }, rejectedEvidence });
const complete = () => ({ windowSamples: 30, qualitySamples: 60, candidateReport: report("PASS"), legacyReport: report("FAIL") });

it("allows a complete legacy control to fail thresholds while requiring the candidate to pass", () => {
  expect(recoveryAcceptancePassed(complete())).toBe(true);
  expect(recoveryAcceptancePassed({ ...complete(), candidateReport: report("FAIL") })).toBe(false);
});

it("rejects complete sample counts with incomplete or rejected evidence", () => {
  for (const status of ["EVIDENCE_INSUFFICIENT", undefined]) {
    expect(recoveryAcceptancePassed({ ...complete(), legacyReport: { evaluation: { status }, rejectedEvidence: [] } })).toBe(false);
  }
  expect(recoveryAcceptancePassed({ ...complete(), candidateReport: report("PASS", ["hash mismatch"]) })).toBe(false);
  expect(recoveryAcceptancePassed({ ...complete(), windowSamples: 29 })).toBe(false);
  expect(recoveryAcceptancePassed({ ...complete(), qualitySamples: 59 })).toBe(false);
});
