import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { executeGovernedVerseShell } from "./governed-exec.js";
import { VerseShellProcessManager, type VerseShellProcessConfig } from "./process-manager.js";
import { VERSESHELL_GOVERNED_EXEC_PROFILE_ID } from "./policy-profile.js";

const binaryPath = fileURLToPath(
  new URL("../../../../resources/bin/win32-x64/ae.exe", import.meta.url),
);
const runRealBinary = process.platform === "win32" && existsSync(binaryPath);
const managers: VerseShellProcessManager[] = [];
const workspaces: string[] = [];

afterEach(async () => {
  delete process.env.AETHER_APPROVE_ALL;
  await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdownAll()));
  await Promise.allSettled(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

describe.runIf(runRealBinary)("VerseShell governed exec real binary", () => {
  it("denies before host approval, retries with one token, reduces output, and recovers an artifact", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "clawx-verseshell-governed-"));
    workspaces.push(workspace);
    const sha256 = createHash("sha256").update(await readFile(binaryPath)).digest("hex");
    const manager = new VerseShellProcessManager({
      resolveBinary: () => ({ path: binaryPath, source: "verified-bundled", verified: true }),
    });
    managers.push(manager);
    const env = {
      VERSESHELL_RUNTIME_VERSION: "1.0.0",
      VERSESHELL_SERVER_PROTOCOL: "verseshell.jsonl/v1",
      VERSESHELL_OPERATION_CATALOG_DIGEST: "sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7",
      VERSESHELL_OPERATION_CATALOG_COUNT: "31",
      VERSESHELL_AE_SHA256: sha256,
      VERSESHELL_OS_SHELL: "powershell",
    };

    // The child must not inherit a broad approval even when the parent process has one.
    process.env.AETHER_APPROVE_ALL = "1";
    await expect(executeGovernedVerseShell({
      command: "echo must-not-run",
      cwd: workspace,
      hostPolicyApproved: false,
      env,
      manager,
    })).rejects.toMatchObject({ code: "E_NEEDS_APPROVAL" });

    const result = await executeGovernedVerseShell({
      command: "$text = 'clawx-artifact-' + ('x' * 24000); Write-Output $text",
      cwd: workspace,
      hostPolicyApproved: true,
      env,
      manager,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]).toMatchObject({
      policyMode: "agent_strict",
      capabilities: ["shell.exec"],
      binaryVersion: "1.0.0",
    });

    const queryConfig: VerseShellProcessConfig = {
      workspace,
      policyProfile: VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
      expectedBinaryVersion: env.VERSESHELL_RUNTIME_VERSION,
      expectedProtocolVersion: env.VERSESHELL_SERVER_PROTOCOL,
      expectedCatalogDigest: env.VERSESHELL_OPERATION_CATALOG_DIGEST,
      expectedCatalogCount: Number(env.VERSESHELL_OPERATION_CATALOG_COUNT),
    };
    const client = await manager.getClient(queryConfig);
    const recovered = await client.queryResult(result.artifacts[0]!, {
      mode: "grep",
      pattern: "clawx-artifact",
      max_matches: 2,
      max_bytes: 4096,
      max_tokens: 500,
    });
    expect(recovered.ok).toBe(true);
    expect(JSON.stringify(recovered.data)).toContain("clawx-artifact");
  }, 30_000);
});
