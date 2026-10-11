/**
 * Real Windows Job Object limit verification for issue #155 (exec boundary).
 *
 * Uses the bundled `ae.exe` (skipped when absent) and proves that the limits the host requests are
 * actually enforced, not merely accepted:
 * - a child process runs without a cap and is refused at `maxProcesses: 1`;
 * - a 256 MiB allocation succeeds under a 512 MiB cap and fails under a 64 MiB cap.
 *
 * The size of the memory experiment is fixed and bounded (256 MiB, twice the small cap); this is
 * not an unbounded resource-exhaustion test. Everything is agent-driven: no human operator and no
 * elevated privileges.
 *
 * The long-lived `process.start` boundary is covered separately by `governed-process.test.ts`
 * (unit) and `governed-process.real-limits.test.ts` (opt-in real run); on this host the shipped
 * executor's `process.start` currently fails with `Access denied (os error 5)` for every command
 * even with no limits requested, which is recorded in
 * `docs/dev/p1-155-windows-job-limits-20261011.md`.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeGovernedVerseShell } from "./governed-exec.js";
import { VerseShellProcessManager } from "./process-manager.js";

const binaryPath = fileURLToPath(
  new URL("../../../../resources/bin/win32-x64/ae.exe", import.meta.url),
);
const runRealBinary = process.platform === "win32" && existsSync(binaryPath);

/** Spawns a child process: exit 0 when the child ran, 9 when the spawn was refused. */
const CHILD_SCRIPT =
  "const r=require('node:child_process').spawnSync('cmd.exe',['/D','/C','exit 0']);process.exit(r.status===0?0:9);";

/** Allocates and touches 256 MiB (twice the small cap used below). */
const MEMORY_SCRIPT =
  "const b=Buffer.alloc(268435456);for(let i=0;i<b.length;i+=4096)b[i]=1;process.exit(0);";

async function contractEnv(): Promise<NodeJS.ProcessEnv> {
  const sha256 = createHash("sha256").update(await readFile(binaryPath)).digest("hex");
  return {
    ...process.env,
    VERSESHELL_RUNTIME_VERSION: "1.0.0",
    VERSESHELL_SERVER_PROTOCOL: "verseshell.jsonl/v1",
    VERSESHELL_OPERATION_CATALOG_DIGEST:
      "sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7",
    VERSESHELL_OPERATION_CATALOG_COUNT: "31",
    VERSESHELL_AE_SHA256: sha256,
    VERSESHELL_OS_SHELL: "powershell",
  };
}

async function runScript(
  script: string,
  limits?: { maxMemoryBytes?: number; maxProcesses?: number },
): Promise<{
  success: boolean;
  exitCode: number;
  stderr: string;
  resourceLimits: unknown;
}> {
  const workspace = await mkdtemp(path.join(tmpdir(), "clawx-exec-limits-"));
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: binaryPath, source: "verified-bundled", verified: true }),
  });
  try {
    const result = await executeGovernedVerseShell({
      command: "node -e probe",
      argv: [process.execPath, "-e", script],
      cwd: workspace,
      timeoutMs: 30_000,
      hostPolicyApproved: true,
      env: await contractEnv(),
      manager,
      ...(limits ? { resourceLimits: limits } : {}),
    });
    return {
      success: result.success,
      exitCode: result.exitCode,
      stderr: result.stderr,
      resourceLimits: result.resourceLimits ?? null,
    };
  } finally {
    await manager.shutdownAll();
  }
}

describe.runIf(runRealBinary)("VerseShell real Job Object limits (exec boundary)", () => {
  it(
    "runs a child process without a cap and refuses it at maxProcesses 1",
    async () => {
      const uncapped = await runScript(CHILD_SCRIPT);
      expect(uncapped).toMatchObject({ success: true, exitCode: 0 });
      expect(uncapped.resourceLimits).toBeNull();

      const capped = await runScript(CHILD_SCRIPT, { maxProcesses: 1 });
      // The Job already holds the root process, so the child spawn is refused: the script's own
      // "spawn was refused" exit code is 9, and a successful uncapped run above returned 0.
      expect(capped).toMatchObject({ success: false, exitCode: 9 });
      expect(capped.resourceLimits).toMatchObject({
        requested: { maxProcesses: 1 },
        applied: { maxProcesses: 1 },
        enforcement: "job-object",
        readback: "unavailable",
      });
    },
    180_000,
  );

  it(
    "enforces a per-process commit cap that the same allocation survives without",
    async () => {
      const uncapped = await runScript(MEMORY_SCRIPT);
      expect(uncapped).toMatchObject({ success: true, exitCode: 0 });

      const generous = await runScript(MEMORY_SCRIPT, { maxMemoryBytes: 512 * 1024 * 1024 });
      expect(generous).toMatchObject({ success: true, exitCode: 0 });

      const tight = await runScript(MEMORY_SCRIPT, { maxMemoryBytes: 64 * 1024 * 1024 });
      expect(tight.success).toBe(false);
      expect(tight.exitCode).not.toBe(0);
      expect(tight.stderr.toLowerCase()).toContain("allocation failed");
      expect(tight.resourceLimits).toMatchObject({
        requested: { maxMemoryBytes: 64 * 1024 * 1024 },
        applied: { maxMemoryMb: 64 },
        enforcement: "job-object",
        readback: "unavailable",
      });
    },
    240_000,
  );
});
