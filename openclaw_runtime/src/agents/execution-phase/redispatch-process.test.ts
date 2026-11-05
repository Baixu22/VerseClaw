import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./redispatch-process.fixture.ts", import.meta.url));
const root = resolve(dirname(fixture), "../../..");
const stages = ["dispatch", "pending", "effect", "committed", "result"] as const;
const evidence: unknown[] = [];
function launch(dir: string, stage: string): ChildProcess {
  return spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(root, "node_modules/tsx/dist/loader.mjs")).href,
      fixture,
      dir,
      stage,
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: join(dir, "state"),
        OPENCLAW_EXECUTION_PHASE_WRITER: "taskflow",
        OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER: "taskflow",
      },
    },
  );
}
async function killOwnedChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    // This fixture owns one Node process and no child processes. Native
    // TerminateProcess avoids launching taskkill under memory pressure.
    if (!child.kill("SIGKILL")) throw new Error("owned fixture termination failed");
  } catch (error) {
    // A resumed child can exit normally between the outcome write and cleanup.
    try {
      process.kill(child.pid, 0);
    } catch {
      await exited;
      return;
    }
    throw error;
  }
  await exited;
}
async function waitForFile(file: string, child: ChildProcess) {
  const deadline = Date.now() + 45_000;
  let errors = "";
  child.stderr?.on("data", (data) => {
    errors = (errors + String(data)).slice(-4000);
  });
  while (!existsSync(file)) {
    if (child.exitCode !== null || Date.now() > deadline)
      throw new Error(`child failed (${child.exitCode}): ${errors}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

it.each(stages)(
  "real process crash at %s preserves effect and replay boundaries",
  async (stage) => {
    for (let repeat = 0; repeat < 3; repeat++) {
      const dir = mkdtempSync(join(tmpdir(), `phase-crash-${stage}-`));
      let child = launch(dir, stage);
      try {
        await waitForFile(join(dir, "ready.json"), child);
        const ready = JSON.parse(readFileSync(join(dir, "ready.json"), "utf8"));
        await killOwnedChild(child);
        child = launch(dir, "resume");
        await waitForFile(join(dir, "outcome.json"), child);
        const outcome = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"));
        expect(outcome.effects).toBe(stage === "pending" ? 0 : 1);
        expect(outcome.status).toBe(
          stage === "dispatch" || stage === "result" ? "resumed" : "reconcile",
        );
        expect(outcome.realResults).toBe(stage === "dispatch" || stage === "result" ? 1 : 0);
        evidence.push({ stage, repeat, killedPid: ready.pid, ...outcome });
        if (process.env.RECOVERY_REDISPATCH_EVIDENCE) {
          writeFileSync(
            process.env.RECOVERY_REDISPATCH_EVIDENCE,
            JSON.stringify(
              {
                schema: "RecoveryToolRedispatchProcessProof/v1",
                driven_by: "agent",
                actor: "redispatch-process-test",
                realHumanEvidence: false,
                generatedAt: new Date().toISOString(),
                trials: evidence,
                scope:
                  "actual tool adapter + SQLite + SessionManager + process kill; not the frozen K1-K5 Electron matrix",
              },
              null,
              2,
            ),
          );
        }
      } finally {
        await killOwnedChild(child);
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  },
  180_000,
);
