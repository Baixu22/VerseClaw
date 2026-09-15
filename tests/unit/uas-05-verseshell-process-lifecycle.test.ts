import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("UAS-05 VerseShell process lifecycle boundary", () => {
  const manifestPath = "resources/verseshell/manifest.json";
  const patchPath = "resources/verseshell/patches/uas-05-process-lifecycle.patch";
  const binaryPath = "resources/bin/win32-x64/ae.exe";
  const SOURCE_INPUTS_PATH = "resources/verseshell/source-inputs.json";
  const manifest = JSON.parse(read(manifestPath));
  const sourcePatch = read(patchPath);

  it("pins the lifecycle binary, source patch, and 31-operation catalog", () => {
    expect(manifest.upstream.pinned_commit).toBe("c3983694407a9ddb23505e05fad4a9eae653b283");
    expect(manifest.protocol).toMatchObject({
      operation_catalog_count: 31,
      operation_catalog_digest:
        "sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7",
    });
    expect(manifest.provenance.unrecorded_changes).toBe(false);
    const sourceInputs = JSON.parse(readFileSync(SOURCE_INPUTS_PATH, "utf8"));
    const expectedCombinedSha = sourceInputs.identity?.combined_sha256;
    expect(typeof expectedCombinedSha).toBe("string");
    expect(expectedCombinedSha).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.provenance.source_inputs.identity_sha256).toBe(expectedCombinedSha);
    expect(manifest.compliance).toMatchObject({
      corresponding_source_status: "tracked_ordered_patch_stack",
      patch_paths: expect.arrayContaining([patchPath]),
    });
    expect(sha256("resources/verseshell/source-inputs.json")).toBe(manifest.provenance.source_inputs.sha256);
    expect(sha256(binaryPath)).toBe(manifest.artifacts["win32-x64"].sha256);
    expect(statSync(binaryPath).size).toBe(manifest.artifacts["win32-x64"].bytes);
  });

  it("records all lifecycle operations while keeping them off the MCP surface", () => {
    for (const operation of [
      "process.start",
      "process.poll",
      "process.write",
      "process.kill",
      "process.list",
    ]) {
      expect(sourcePatch).toContain(`name: "${operation}"`);
    }
    expect(sourcePatch).toContain('spec.name.starts_with("process.")');
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

  it("leaves Task Forest release order and product graduation locks unchanged", () => {
    const nodes = JSON.parse(read(".agent-workbench/task-forest/graph/nodes.json"));
    const evidence = JSON.parse(read("artifacts/first-product-preview/TF-0009/evidence-audit.json"));
    const surrogate = read("artifacts/first-product-preview/TF-0009/agent-surrogate-report.json");

    expect(nodes["TF-0016"]).toMatchObject({ status: "done", progress: 100 });
    expect(nodes["TF-0017"]).toMatchObject({ status: "deprecated" });
    // The parent is blocked on human acceptance; lifecycle proof cannot promote it.
    expect(nodes["TF-0028"]).toMatchObject({ status: "blocked" });
    expect(nodes["TF-0041"]).toMatchObject({ status: "proposed" });
    expect(nodes["TF-0042"]).toMatchObject({ status: "blocked" });
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
