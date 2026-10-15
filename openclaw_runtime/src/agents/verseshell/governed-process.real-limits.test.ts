/**
 * Real Windows Job Object limit verification for the long-lived `process.start` boundary (#155).
 *
 * Drives the bundled `ae.exe` (skipped when it is absent) and checks that the limits the host
 * requests are actually enforced, not merely accepted:
 * - without a cap the root process can create a child process and the child reports success;
 * - with `maxProcesses: 1` the root still runs but its child spawn is refused;
 * - with a small `maxMemoryBytes` a large allocation fails while the same script succeeds
 *   without the cap;
 * - the receipt reports the applied limits and names the missing kernel readback.
 *
 * The root is a Node script file rather than an inline `-e` string or `cmd.exe`: an inline argv
 * element is re-split by the executor's Windows command-line handling, and `cmd.exe /C` itself
 * needs a helper process, so a `maxProcesses: 1` cap refuses the `cmd.exe` root before it can run
 * anything. A Node root isolates "the root runs, the child is refused", which is the property the
 * Job Object limit actually guarantees (see `docs/dev/p1-160-verseshell-process-start-20261012.md`).
 *
 * This is real-binary evidence on Windows, but it is still agent-driven: no human operator, no
 * elevated privileges and no unbounded resource-exhaustion experiment (the memory case allocates
 * 256 MiB against a 64 MiB cap, twice the cap, never more).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      "sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8",
    VERSESHELL_OPERATION_CATALOG_COUNT: "32",
    VERSESHELL_AE_SHA256: sha256,
    VERSESHELL_OS_SHELL: "powershell",
  };
}

async function runScenario(params: {
  /** Node script body written into the workspace and run as the root process. */
  script: string;
  resourceLimits?: { maxMemoryBytes?: number; maxProcesses?: number; requireEnforcement?: boolean };
}): Promise<{
  state: string;
  exitCode: number | null;
  stdout: string;
  receipt: Record<string, unknown>;
}> {
  const workspace = await mkdtemp(path.join(tmpdir(), "clawx-verseshell-limits-"));
  workspaces.push(workspace);
  const scriptPath = path.join(workspace, "probe.cjs");
  await writeFile(scriptPath, params.script, "utf8");
  const argv = [process.execPath, scriptPath];
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: binaryPath, source: "verified-bundled", verified: true }),
  });
  managers.push(manager);
  let stdout = "";
  const handle = await startGovernedVerseShellProcess({
    command: argv.join(" "),
    argv,
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

// The root runs as-is; only the child spawn can be refused by the Job Object.
const CHILD_MARKER_SCRIPT =
  "const r = require('node:child_process').spawnSync('cmd.exe', ['/D', '/C', 'echo inner-marker']);" +
  "console.log('outer-marker');" +
  "console.log('child-status', r.status);";

// Allocates and touches 256 MiB (twice the 64 MiB cap used below).
const MEMORY_ALLOCATION_SCRIPT =
  "const b = Buffer.alloc(268435456); b[0] = 1; b[268435455] = 1; console.log('alloc-ok');";

describe.runIf(runRealBinary)("VerseShell real Job Object limits", () => {
  it(
    "runs a child process without a cap and refuses it at maxProcesses 1",
    async () => {
      const uncapped = await runScenario({ script: CHILD_MARKER_SCRIPT });
      expect(uncapped.stdout).toContain("outer-marker");
      // The root spawned its child successfully: status 0, not null.
      expect(uncapped.stdout).toContain("child-status 0");
      expect(uncapped.exitCode).toBe(0);
      expect(uncapped.receipt).toMatchObject({ enforced: false, evidence: "none" });

      const capped = await runScenario({
        script: CHILD_MARKER_SCRIPT,
        resourceLimits: { maxProcesses: 1, requireEnforcement: true },
      });
      // The root still runs, but the Job already holds it, so the child spawn is refused
      // (spawnSync reports a null status instead of 0).
      expect(capped.stdout).toContain("outer-marker");
      expect(capped.stdout).not.toContain("child-status 0");
      expect(capped.stdout).toContain("child-status null");
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
    "enforces a per-process commit cap that the same script survives without",
    async () => {
      const uncapped = await runScenario({ script: MEMORY_ALLOCATION_SCRIPT });
      expect(uncapped.stdout).toContain("alloc-ok");
      expect(uncapped.exitCode).toBe(0);

      const capped = await runScenario({
        script: MEMORY_ALLOCATION_SCRIPT,
        resourceLimits: { maxMemoryBytes: 64 * 1024 * 1024, requireEnforcement: true },
      });
      // The allocation is twice the cap, so the process cannot reach the marker line.
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
