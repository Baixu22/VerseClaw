/**
 * Real Windows Job Object limit verification for issue #155.
 *
 * Drives the bundled `ae.exe` (skipped when it is absent) and checks that the limits the host
 * requests are actually enforced, not merely accepted:
 * - without a cap the root process can create a child process and the child's marker appears;
 * - with `maxProcesses: 1` the same command still runs the root but the child is refused;
 * - with a small `maxMemoryBytes` a large allocation fails while the same command succeeds
 *   without the cap;
 * - the receipt reports the applied limits and names the missing kernel readback.
 *
 * This is real-binary evidence on Windows, but it is still agent-driven: no human operator, no
 * elevated privileges and no unbounded resource-exhaustion experiment (the memory case allocates
 * 256 MiB against a 64 MiB cap, twice the cap, never more).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startGovernedVerseShellProcess } from "./governed-process.js";
import { VerseShellProcessManager } from "./process-manager.js";

const binaryPath = fileURLToPath(
  new URL("../../../../resources/bin/win32-x64/ae.exe", import.meta.url),
);
/**
 * Opt-in only. On this host the shipped executor's `process.start` fails with
 * `Access denied (os error 5)` for every command, with or without limits, so the long-lived
 * boundary cannot be behaviourally verified here yet (see
 * `docs/dev/p1-155-windows-job-limits-20261011.md`). Set
 * `VERSESHELL_REAL_PROCESS_START_LIMITS=1` to run this suite once that executor path works.
 */
const runRealBinary =
  process.platform === "win32" &&
  existsSync(binaryPath) &&
  process.env.VERSESHELL_REAL_PROCESS_START_LIMITS === "1";
const workspaces: string[] = [];
const managers: VerseShellProcessManager[] = [];

afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdownAll()));
  await Promise.allSettled(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })),
  );
});

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

async function contractEnv(): Promise<Record<string, string>> {
  const sha256 = createHash("sha256").update(await readFile(binaryPath)).digest("hex");
  return {
    VERSESHELL_RUNTIME_VERSION: "1.0.0",
    VERSESHELL_SERVER_PROTOCOL: "verseshell.jsonl/v1",
    VERSESHELL_OPERATION_CATALOG_DIGEST:
      "sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7",
    VERSESHELL_OPERATION_CATALOG_COUNT: "31",
    VERSESHELL_AE_SHA256: sha256,
    VERSESHELL_OS_SHELL: "powershell",
  };
}

async function runScenario(params: {
  argv: string[];
  resourceLimits?: { maxMemoryBytes?: number; maxProcesses?: number; requireEnforcement?: boolean };
}): Promise<{
  state: string;
  exitCode: number | null;
  stdout: string;
  receipt: Record<string, unknown>;
}> {
  const workspace = await mkdtemp(path.join(tmpdir(), "clawx-verseshell-limits-"));
  workspaces.push(workspace);
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: binaryPath, source: "verified-bundled", verified: true }),
  });
  managers.push(manager);
  let stdout = "";
  const handle = await startGovernedVerseShellProcess({
    command: params.argv.join(" "),
    argv: params.argv,
    cwd: workspace,
    processEnv: childEnv(),
    timeoutMs: 30_000,
    maxOutputBytes: 256 * 1024,
    usePty: false,
    agentId: "agent-limits-probe",
    sessionId: "session-limits-probe",
    hostPolicyApproved: true,
    runtimeEnv: await contractEnv(),
    manager,
    ...(params.resourceLimits ? { resourceLimits: params.resourceLimits } : {}),
    onStdout: (chunk) => {
      stdout += chunk;
    },
  });
  const exit = await handle.wait();
  return {
    state: exit.state,
    exitCode: exit.exitCode,
    stdout,
    receipt: handle.resourceReceipt as unknown as Record<string, unknown>,
  };
}

const CHILD_MARKER_COMMAND = [
  "cmd.exe",
  "/D",
  "/C",
  "echo outer-marker & cmd.exe /D /C echo inner-marker",
];

const MEMORY_ALLOCATION_COMMAND = [
  "powershell",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "$a = New-Object byte[] (268435456); $a[0] = 1; $a[268435455] = 1; Write-Output alloc-ok",
];

describe.runIf(runRealBinary)("VerseShell real Job Object limits", () => {
  it(
    "runs a child process without a cap and refuses it at maxProcesses 1",
    async () => {
      const uncapped = await runScenario({ argv: CHILD_MARKER_COMMAND });
      expect(uncapped.stdout).toContain("outer-marker");
      expect(uncapped.stdout).toContain("inner-marker");
      expect(uncapped.receipt).toMatchObject({ enforced: false, evidence: "none" });

      const capped = await runScenario({
        argv: CHILD_MARKER_COMMAND,
        resourceLimits: { maxProcesses: 1, requireEnforcement: true },
      });
      expect(capped.stdout).toContain("outer-marker");
      // The Job already holds the root process, so the child cannot be created.
      expect(capped.stdout).not.toContain("inner-marker");
      expect(capped.exitCode).not.toBe(0);
      expect(capped.receipt).toMatchObject({
        applied: { maxProcesses: 1 },
        enforced: true,
        enforcement: "job-object",
        evidence: "job-object-configured",
        readback: "unavailable",
      });
    },
    120_000,
  );

  it(
    "enforces a per-process commit cap that the same command survives without",
    async () => {
      const uncapped = await runScenario({ argv: MEMORY_ALLOCATION_COMMAND });
      expect(uncapped.stdout).toContain("alloc-ok");

      const capped = await runScenario({
        argv: MEMORY_ALLOCATION_COMMAND,
        resourceLimits: { maxMemoryBytes: 64 * 1024 * 1024, requireEnforcement: true },
      });
      // The allocation is twice the cap, so the executor must refuse it rather than succeed.
      expect(capped.stdout).not.toContain("alloc-ok");
      expect(capped.exitCode).not.toBe(0);
      expect(capped.receipt).toMatchObject({
        applied: { maxMemoryMb: 64 },
        enforced: true,
        enforcement: "job-object",
      });
    },
    180_000,
  );
});
