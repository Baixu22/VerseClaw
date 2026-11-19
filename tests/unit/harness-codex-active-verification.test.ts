import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVE_ACCEPTANCE_SCHEMA,
  DEFAULT_MATRIX_PATH,
  EVIDENCE_LEVELS,
  REQUIRED_SCENARIO_IDS,
  buildAcceptance,
  fingerprintPath,
  validateMatrixStructure,
  verifyActiveMatrix,
  verifyActiveMatrixArtifacts,
} from "../../scripts/verify-harness-active-matrix.mjs";
import type { VerificationMatrix, VerificationAcceptance, VerificationScenario } from "../../scripts/verify-harness-active-matrix.mjs";
import { collectTaskSpecLifecycleErrors } from "../../scripts/check-spec-lifecycle.mjs";
import { initializeFrozenGitReplay } from "../helpers/frozen-source-replay";

const ROOT = resolve(process.cwd());
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function matrixFixture() {
  const root = mkdtempSync(join(tmpdir(), "active-verification-matrix-"));
  roots.push(root);
  mkdirSync(join(root, "harness", "specs", "fixtures", "harness-codex-authority-baseline"), { recursive: true });
  mkdirSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification"), { recursive: true });
  mkdirSync(join(root, "tests", "unit"), { recursive: true });
  writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-authority-baseline", "scenario-matrix.json"), JSON.stringify({ scenarios: [] }), "utf8");
  writeFileSync(join(root, "tests", "unit", "readback.ts"), "export {};\n", "utf8");
  writeFileSync(join(root, "tests", "unit", "evidence.json"), JSON.stringify({ generatedAt: "2026-10-26T00:00:00.000Z" }), "utf8");
  writeFileSync(join(root, "tests", "unit", "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
  const scenarios: VerificationScenario[] = REQUIRED_SCENARIO_IDS.map((id: string) => ({
    id,
    name: "scenario-" + id,
    owner: "owner-" + id,
    command: "node verify.mjs " + id,
    input: "input " + id,
    expected: "expected " + id,
    negative: "negative " + id,
    readback: "tests/unit/readback.ts",
    evidenceGrade: id === "S4" ? "packaged" : id === "S7" ? "external-provider" : id === "S8" ? "effect" : "runtime",
    status: id === "S2" || id === "S3" ? "partial" : "pass",
    notRunReason: id === "S2" || id === "S3" ? "not-run reason " + id : null,
    evidence: ["tests/unit/evidence.json"],
  }));
  const matrix: VerificationMatrix = {
    schemaVersion: "HarnessActiveVerificationMatrix/v1",
    generatedAt: "2026-10-26T00:00:00.000Z",
    driven_by: "agent",
    actor: "fixture-agent",
    scenarioSource: "harness/specs/fixtures/harness-codex-authority-baseline/scenario-matrix.json",
    sourceFiles: ["tests/unit/readback.ts"],
    packageFiles: ["tests/unit/package.json"],
    evidenceVocabulary: ["source", "runtime", "effect", "packaged", "external-provider", "not-run"],
    freshnessPolicy: { maxAgeHours: null, sourceNewerThanEvidence: "stale", missingArtifact: "stale", hashMismatch: "stale", invalidSchema: "stale", verifyWhen: "every verifier run" },
    scenarios,
  };
  return { root, matrix };
}

describe("TF-0570 active verification matrix", () => {
  it("covers all scenarios with command, input, expected, negative, owner and readback", () => {
    const { root, matrix } = matrixFixture();
    const result = validateMatrixStructure(matrix, { root });
    expect(result.ok, result.issues.join("\n")).toBe(true);
    expect(matrix.scenarios.map((entry) => entry.id)).toEqual(REQUIRED_SCENARIO_IDS);
    expect(matrix.scenarios.filter((entry) => entry.id === "S11")).toHaveLength(1);
    for (const entry of matrix.scenarios) {
      expect(entry.command).toMatch(/S\d+/);
      expect(entry.input).toBeTruthy();
      expect(entry.expected).toBeTruthy();
      expect(entry.negative).toBeTruthy();
      expect(entry.owner).toMatch(/^owner-/);
      expect(entry.readback).toMatch(/^tests\//);
    }
  });

  it("rejects an incomplete or duplicated scenario matrix", () => {
    const { root, matrix } = matrixFixture();
    const cases = [
      { mutate: (value: VerificationMatrix) => { value.scenarios[0].input = ""; }, expectation: "input missing" },
      { mutate: (value: VerificationMatrix) => { value.scenarios[0].expected = ""; }, expectation: "expected missing" },
      { mutate: (value: VerificationMatrix) => { value.scenarios[0].readback = "../escape.ts"; }, expectation: "readback must be a repo-relative path" },
      { mutate: (value: VerificationMatrix) => { value.scenarios[1].notRunReason = null; }, expectation: "notRunReason must be present exactly" },
    ];
    for (const entry of cases) {
      const clone = structuredClone(matrix);
      entry.mutate(clone);
      const result = validateMatrixStructure(clone, { root });
      expect(result.ok, entry.expectation + ": " + result.issues.join("\n")).toBe(false);
    }
  });

  it("retains a fresh acceptance receipt with evidence levels and honest partial rows", () => {
    const { root, matrix } = matrixFixture();
    writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification", "matrix.json"), JSON.stringify(matrix), "utf8");
    writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification", "smoke-positive.txt"), "positive smoke", "utf8");
    writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification", "smoke-negative.txt"), "negative smoke", "utf8");
    const acceptance = buildAcceptance({
      matrix,
      sourceCommit: "0".repeat(40),
      sourceTree: "1".repeat(40),
      sourceDirty: false,
      freshness: "fresh",
      validation: [{ command: "node verifier.mjs", exitCode: 0, outputSha256: null }],
      smoke: [
        { id: "positive-fixture", status: "pass", exitCode: 0, log: "smoke-positive.txt" },
        { id: "negative-fixture", status: "pass", exitCode: 0, log: "smoke-negative.txt" },
      ],
      root,
    });
    expect(acceptance.actor).toBe(matrix.actor);
    expect(acceptance.schemaVersion).toBe(ACTIVE_ACCEPTANCE_SCHEMA);
    expect(acceptance.evidenceLevels).toEqual(EVIDENCE_LEVELS);
    expect(acceptance.summary).toMatchObject({ total: 11, pass: 9, partial: 2, failed: 0 });
    expect(acceptance.scenarios.find((entry) => entry.id === "S4")?.evidenceLevel).toBe("packaged-available");
    expect(acceptance.scenarios.find((entry) => entry.id === "S8")?.evidenceLevel).toBe("effect-verified");
    expect(acceptance.boundaries).toMatchObject({ defaultPathChanged: false, productApproved: false, releaseApproved: false, realHumanEvidence: false, secondExecutorAuthority: false });
    expect(acceptance.limitations.length).toBeGreaterThan(0);
    const result = verifyActiveMatrix({ matrix, acceptance, root, sourceDirty: false });
    expect(result.issues, result.issues.join("\n")).toEqual([]);
  });

  it("invalidates a receipt when a source input changes", () => {
    const { root, matrix } = matrixFixture();
    writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification", "matrix.json"), JSON.stringify(matrix), "utf8");
    writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification", "smoke-positive.txt"), "positive smoke", "utf8");
    writeFileSync(join(root, "harness", "specs", "fixtures", "harness-codex-active-verification", "smoke-negative.txt"), "negative smoke", "utf8");
    const acceptance = buildAcceptance({
      matrix,
      sourceCommit: "0".repeat(40),
      sourceTree: "1".repeat(40),
      sourceDirty: false,
      validation: [{ command: "node verifier.mjs", exitCode: 0, outputSha256: null }],
      smoke: [
        { id: "positive-fixture", status: "pass", exitCode: 0, log: "smoke-positive.txt", outputSha256: null },
        { id: "negative-fixture", status: "pass", exitCode: 0, log: "smoke-negative.txt", outputSha256: null },
      ],
      root,
    });
    expect(verifyActiveMatrix({ matrix, acceptance, root, sourceDirty: false }).issues).toEqual([]);
    writeFileSync(join(root, "tests", "unit", "package.json"), JSON.stringify({ name: "fixture", version: "2.0.0" }), "utf8");
    const result = verifyActiveMatrix({ matrix, acceptance, root, sourceDirty: false });
    expect(result.issues.join("\n")).toContain("source input hash mismatch: tests/unit/package.json");
    expect(result.summary.stale).toBeGreaterThan(0);
  });

  it("fails closed on missing evidence and credential/local-path content", () => {
    const { root, matrix } = matrixFixture();
    rmSync(join(root, "tests", "unit", "evidence.json"));
    const missing = verifyActiveMatrix({ matrix: structuredClone(matrix), acceptance: null, root, sourceDirty: false });
    expect(missing.issues.join("\n")).toContain("evidence missing");
    const local = structuredClone(matrix);
    local.scenarios[0].input = "C:\\Users\\developer\\private.txt";
    expect(validateMatrixStructure(local, { root }).issues.join("\n")).toContain("local absolute path retained");
    const credential = structuredClone(matrix);
    credential.scenarios[0].input = "api_key=abcdef123456";
    expect(validateMatrixStructure(credential, { root }).issues.join("\n")).toContain("credential-like content retained");
  });

  it("replays the tracked matrix at its source revision and rejects absent historical binaries", { timeout: 120_000 }, () => {
    const matrix = JSON.parse(readFileSync(join(ROOT, DEFAULT_MATRIX_PATH), "utf8")) as VerificationMatrix;
    const acceptance = JSON.parse(readFileSync(join(ROOT, "harness/specs/fixtures/harness-codex-active-verification/acceptance.json"), "utf8")) as VerificationAcceptance;
    expect(matrix.scenarios).toHaveLength(11);
    expect(matrix.scenarios.filter((entry) => entry.id === "S11")).toHaveLength(1);
    const root = mkdtempSync(join(tmpdir(), "active-matrix-source-replay-"));
    roots.push(root);
    initializeFrozenGitReplay(ROOT, root, acceptance.source.commit, [
      ...matrix.sourceFiles, ...matrix.packageFiles,
      ...matrix.scenarios.flatMap((entry) => [entry.readback, ...entry.evidence]),
      matrix.scenarioSource!, "harness/specs/fixtures/harness-codex-active-verification",
    ]);
    cpSync(join(ROOT, "harness/specs/fixtures/harness-codex-active-verification"), join(root, "harness/specs/fixtures/harness-codex-active-verification"), { recursive: true });
    mkdirSync(join(root, "resources/bin/win32-x64"), { recursive: true });
    cpSync(join(ROOT, "resources/bin/win32-x64/vg.exe"), join(root, "resources/bin/win32-x64/vg.exe"));
    const missing = [
      "resources/bin/win32-x64/ae.exe",
      "release/win-unpacked/Verse Claw.exe",
      "release/win-unpacked/resources/openclaw-runtime/extensions/codex/package.json",
      "release/win-unpacked/resources/openclaw-runtime/extensions/codex/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    ];
    for (const input of acceptance.sourceInputs.filter((entry) => !missing.includes(entry.path) && entry.path !== 'harness/src')) {
      expect(fingerprintPath(root, input.path), input.path).toEqual(input);
    }
    // The retained directory digest also differs from its declared Git revision.
    expect(fingerprintPath(root, 'harness/src')).toMatchObject({
      sha256: 'c50d4bea343bcd199a3a6651449df7a1f9cb8d5ef87c980b1e5a95d05fbd4e64', bytes: 43170, files: 14,
    });
    expect(acceptance.sourceInputs.find((entry) => entry.path === 'harness/src')).toMatchObject({
      sha256: '6d8a7edaa3ea1fd1c4e9cd0081745f2757fe81b0b8961d610177539764b01e51', bytes: 43234, files: 14,
    });
    const result = verifyActiveMatrixArtifacts({ root });
    // Package payloads are not tracked source. Missing original bytes must stay stale.
    expect(result.ok).toBe(false);
    expect(result.issues.sort(), result.issues.join("\n")).toEqual([
      ...missing.map((path) => `matrix input missing: ${path}`),
      "acceptance source input digest mismatch",
      "acceptance source input hash mismatch: harness/src",
      ...missing.map((path) => `acceptance source input hash mismatch: ${path}`),
    ].sort());
    expect(result.acceptance).not.toBeNull();
    for (const entry of result.acceptance!.scenarios) {
      expect(entry.evidence.length).toBeGreaterThan(0);
      for (const evidence of entry.evidence) {
        expect(fingerprintPath(root, evidence.path), evidence.path).toEqual(evidence);
      }
    }
  });

  it("rejects a tampered receipt and stale evidence", { timeout: 120_000 }, () => {
    const matrix = JSON.parse(readFileSync(join(ROOT, DEFAULT_MATRIX_PATH), "utf8"));
    const acceptance = JSON.parse(readFileSync(join(ROOT, "harness/specs/fixtures/harness-codex-active-verification/acceptance.json"), "utf8")) as VerificationAcceptance;
    const tampered = structuredClone(acceptance);
    const tamperedScenario = tampered.scenarios.find((entry) => entry.id === "S8");
    expect(tamperedScenario).toBeTruthy();
    tamperedScenario!.status = "partial";
    const receiptResult = verifyActiveMatrix({ matrix, acceptance: tampered, root: ROOT, sourceDirty: false });
    expect(receiptResult.issues.join("\n")).toContain("status mismatch");
    tampered.source.matrixSha256 = "0".repeat(64);
    expect(verifyActiveMatrix({ matrix, acceptance: tampered, root: ROOT, sourceDirty: false }).issues.join("\n")).toContain("matrix hash mismatch");
    const stale = structuredClone(acceptance);
    stale.freshness.state = "stale";
    expect(verifyActiveMatrix({ matrix, acceptance: stale, root: ROOT, sourceDirty: false }).issues.join("\n")).toContain("freshness is not fresh");
  });

  it("keeps the task spec lifecycle explicit", async () => {
    const errors = await collectTaskSpecLifecycleErrors();
    expect(errors.filter((error) => error.includes("harness-codex-active-verification"))).toEqual([]);
  });

  it("rejects a missing or duplicated S11", () => {
    const { root, matrix } = matrixFixture();
    const cases = [
      { mutate: (value: VerificationMatrix) => { value.scenarios = value.scenarios.slice(0, -1); }, expectation: "matrix missing S11" },
      { mutate: (value: VerificationMatrix) => value.scenarios.push({ ...value.scenarios[10] }), expectation: "duplicate id" },
    ];
    for (const entry of cases) {
      const clone = structuredClone(matrix);
      entry.mutate(clone);
      const result = validateMatrixStructure(clone, { root });
      expect(result.ok).toBe(false);
      expect(result.issues.join("\n")).toContain(entry.expectation);
    }
  });
});
