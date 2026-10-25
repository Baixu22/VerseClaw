import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeElectronApp, expect, test } from "./fixtures/electron";

const execFileAsync = promisify(execFile);
async function freePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return rejectPort(new Error("no port"));
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}
function git(cwd: string, args: string[]): string { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }
async function waitForBridge(url: string, token: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${url}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* bridge may still be starting */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("VerseGit paired-evaluation bridge did not become ready");
}

test.describe("VerseGit paired agent evaluation", () => {
  test("runs identical off/on fixtures and records a reproduceable behavior shift", async ({ launchElectronApp }) => {
    const configuredRoot = process.env.VERSEGIT_D2_E2E_ROOT?.trim();
    const root = configuredRoot ? configuredRoot : mkdtempSync(join(tmpdir(), "versegit-d2-e2e-"));
    if (configuredRoot) mkdirSync(root, { recursive: true });
    const port = await freePort();
    const token = `d2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventsPath = join(root, "bridge-events.jsonl");
    const observationsPath = join(root, "observations.jsonl");
    const reportPath = join(root, "paired-report.json");
    const bridgeUrl = `http://127.0.0.1:${port}`;
    try {
      git(root, ["init", "--initial-branch=main"]);
      git(root, ["config", "user.email", "agent@example.invalid"]);
      git(root, ["config", "user.name", "Agent"]);
      writeFileSync(join(root, "bootstrap.txt"), "paired\n", "utf8");
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "bootstrap"]);
      const app = await launchElectronApp({
        skipSetup: true,
        env: {
          CLAWX_VERSGIT_BINDING_ENABLED: "1",
          CLAWX_VERSGIT_BINDING_PORT: String(port),
          CLAWX_VERSGIT_BINDING_TOKEN: token,
          CLAWX_VERSGIT_BINDING_EVENTS_PATH: eventsPath,
          CLAWX_VERSGIT_OBSERVATION_EVENTS_PATH: observationsPath,
          CLAWX_VERSGIT_OWNER_ID: "agent:codex",
          CLAWX_VERSGIT_EPOCH: "4",
          CLAWX_VERSGIT_ALLOWED_REPO_ROOT: root,
        },
      });
      try {
        await waitForBridge(bridgeUrl, token);
        const probeEnv = {
          ...process.env,
          CLAWX_VERSGIT_BINDING_ENABLED: "1",
          CLAWX_VERSGIT_RUNTIME_BINDING_URL: bridgeUrl,
          CLAWX_VERSGIT_BINDING_TOKEN: token,
          CLAWX_VERSGIT_OWNER_ID: "agent:codex",
          CLAWX_VERSGIT_EPOCH: "4",
          VERSEGIT_D2_REPO_ROOT: root,
          VERSEGIT_D2_REPORT_PATH: reportPath,
        };
        await execFileAsync(process.execPath, [
          join(process.cwd(), "openclaw_runtime/node_modules/tsx/dist/cli.mjs"),
          "--tsconfig", "tsconfig.node.json", "scripts/versegit-product-paired-evaluation.mts",
        ], { cwd: process.cwd(), env: probeEnv, timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        expect(existsSync(reportPath)).toBe(true);
        const report = JSON.parse(readFileSync(reportPath, "utf8"));
        expect(report).toMatchObject({
          passed: true,
          driven_by: "agent",
          actor: "codex",
          execution_class: { driver: "deterministic-simulated-agent", effects: "actual-read-write-tools-and-host-git-tsc", external_model_provider: false, real_human: false },
          summary: { positive_trials: 3, negative_trials: 2, behavior_shift_count: 3, negative_false_positive_count: 0, stable_normalized_outcomes: true },
          boundaries: { supported_language_only: "typescript", cjs_claim: false, transcript_presence_is_behavior_shift: false, cost_measured: false, external_model_quality_measured: false },
        });
        expect(report.trials).toHaveLength(5);
        for (const trial of report.trials.filter((entry: Record<string, any>) => entry.kind === "positive")) {
          expect(trial.off).toMatchObject({ feedback_delivered: false, reread_count: 0, rework_count: 0, validation_status: "failed" });
          expect(trial.on).toMatchObject({ feedback_delivered: true, reread_count: 1, rework_count: 1, validation_status: "passed" });
          expect(trial.on.feedback_evidence_id).toBeTruthy();
        }
        for (const trial of report.trials.filter((entry: Record<string, any>) => entry.kind === "negative")) {
          expect(trial.off).toMatchObject({ feedback_delivered: false, reread_count: 0, rework_count: 0, validation_status: "passed" });
          expect(trial.on).toMatchObject({ feedback_delivered: false, reread_count: 0, rework_count: 0, validation_status: "passed" });
        }
        const observations = readFileSync(observationsPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
        expect(observations.filter((record) => record.kind === "tool-observation" && record.data.feedback).length).toBe(3);
        const events = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
        expect(events.filter((event) => event.kind === "feedback_produced").length).toBe(3);
        expect(events.every((event) => event.driven_by === "agent" && event.actor === "electron-main")).toBe(true);
      } finally {
        await closeElectronApp(app);
      }
    } finally {
      if (!configuredRoot) rmSync(root, { recursive: true, force: true });
    }
  });
});
