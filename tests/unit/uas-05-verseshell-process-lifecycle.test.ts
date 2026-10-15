import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Source-text checks below pin catalog/routing contracts; they do not execute a process lifecycle.
describe("UAS-05 VerseShell process lifecycle boundary", () => {
  const manifestPath = "resources/verseshell/manifest.json";
  const binaryPath = "resources/bin/win32-x64/ae.exe";
  const SOURCE_INPUTS_PATH = "resources/verseshell/source-inputs.json";
  const SOURCE_LOCK_PATH = "harness/specs/fixtures/verseshell-reintegration/source-lock.json";
  const manifest = JSON.parse(read(manifestPath));
  // The lifecycle operations and their catalog now ship in the pinned upstream commit; the
  // frozen source lock is the inventory that proves they were carried over, not a local patch.
  const sourceLock = JSON.parse(read(SOURCE_LOCK_PATH));

  it("pins the lifecycle binary, frozen source commit, and 32-operation catalog", () => {
    expect(manifest.upstream.pinned_commit).toBe("c06f406e83566bb968448222d9c8caf429e580a0");
    expect(manifest.protocol).toMatchObject({
      operation_catalog_count: 32,
      operation_catalog_digest:
        "sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8",
    });
    expect(manifest.provenance.unrecorded_changes).toBe(false);
    const sourceInputs = JSON.parse(readFileSync(SOURCE_INPUTS_PATH, "utf8"));
    const expectedCombinedSha = sourceInputs.identity?.combined_sha256;
    expect(typeof expectedCombinedSha).toBe("string");
    expect(expectedCombinedSha).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.provenance.source_inputs.identity_sha256).toBe(expectedCombinedSha);
    expect(manifest.compliance).toMatchObject({
      corresponding_source_status: "tracked_ordered_patch_stack",
      patch_paths: sourceInputs.patches.map((patch: { path: string }) => patch.path),
    });
    expect(sha256("resources/verseshell/source-inputs.json")).toBe(manifest.provenance.source_inputs.sha256);
    expect(sha256(binaryPath)).toBe(manifest.artifacts["win32-x64"].sha256);
    expect(statSync(binaryPath).size).toBe(manifest.artifacts["win32-x64"].bytes);
  });

  it("carries every lifecycle operation in the frozen upstream inventory", () => {
    for (const operation of [
      "process.start",
      "process.poll",
      "process.write",
      "process.kill",
      "process.list",
    ]) {
      expect(sourceLock.operations).toContain(operation);
    }
    expect(sourceLock.files.some((entry: { path: string }) => entry.path === "src/ops/process_ops.rs")).toBe(true);
  });

  it("routes governed exec and process control through the lifecycle owner", () => {
    const governedProcess = read("openclaw_runtime/src/agents/verseshell/governed-process.ts");
    const execRuntime = read("openclaw_runtime/src/agents/bash-tools.exec-runtime.ts");
    const processTool = read("openclaw_runtime/src/agents/bash-tools.process.ts");
    const registry = read("openclaw_runtime/src/agents/bash-process-registry.ts");

    for (const operation of ["process.start", "process.poll", "process.write", "process.kill"]) {
      expect(governedProcess).toContain(`"${operation}"`);
    }
    expect(execRuntime).toContain("await startGovernedVerseShellProcess({");
    expect(execRuntime).toContain('session.lifecycleOwner = "verseshell"');
    expect(execRuntime).not.toContain("executeGovernedVerseShell");
    expect(processTool).toContain('session?.lifecycleOwner === "verseshell"');
    expect(processTool).toContain('session.lifecycleOwner === "verseshell"');
    expect(registry).toContain("lifecycleOwner?:");
    expect(registry).toContain('"verseshell"');
  });

  it("preserves the recorded frozen product boundaries without consulting local task status", () => {
    const evidence = JSON.parse(read("artifacts/first-product-preview/TF-0009/evidence-audit.json"));
    const surrogate = read("artifacts/first-product-preview/TF-0009/agent-surrogate-report.json");

    expect(evidence.frozenBoundaries).toMatchObject({
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      c1MeetsGate: false,
      c1Recommendation: "keep-off",
      runtimeMemory: "diagnostics-only",
    });
    expect(surrogate).toContain('"autoWriteback": false');
    expect(surrogate).not.toContain('"autoWriteback": true');
  });
});
