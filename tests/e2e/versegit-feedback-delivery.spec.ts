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
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}
async function waitForBridge(url: string, token: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Bridge may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("VerseGit feedback bridge did not become ready");
}

test.describe("VerseGit feedback delivery", () => {
  test("carries the same risk evidence from a real tool result into the next call binding", async ({ launchElectronApp }) => {
    const configuredRoot = process.env.VERSEGIT_D1_E2E_ROOT?.trim();
    const root = configuredRoot ? configuredRoot : mkdtempSync(join(tmpdir(), "versegit-d1-e2e-"));
    if (configuredRoot) mkdirSync(root, { recursive: true });
    const port = await freePort();
    const token = `d1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventsPath = join(root, "bridge-events.jsonl");
    const observationsPath = join(root, "observations.jsonl");
    const reportPath = join(root, "delivery-report.json");
    const bridgeUrl = `http://127.0.0.1:${port}`;
    try {
      git(root, ["init", "--initial-branch=main"]);
      git(root, ["config", "user.email", "agent@example.invalid"]);
      git(root, ["config", "user.name", "Agent"]);
      writeFileSync(join(root, "base.txt"), "base\n", "utf8");
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "base"]);
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
          CLAWX_VERSGIT_OBSERVATION_EVENTS_PATH: observationsPath,
          VERSEGIT_D1_REPO_ROOT: root,
          VERSEGIT_D1_REPORT_PATH: reportPath,
        };
        await execFileAsync(process.execPath, [
          join(process.cwd(), "openclaw_runtime/node_modules/tsx/dist/cli.mjs"),
          "--tsconfig", "tsconfig.node.json", "scripts/versegit-feedback-delivery-probe.mts",
        ], { cwd: process.cwd(), env: probeEnv, timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        expect(existsSync(reportPath)).toBe(true);
        const report = JSON.parse(readFileSync(reportPath, "utf8"));
        expect(report).toMatchObject({
          passed: true,
          driven_by: "agent",
          actor: "codex",
          tool_result: { original_content_preserved: true, original_details_preserved: true, is_error: false },
          delivery: { coverage: "direct", candidate_id: null, produced: true, host_delivered: true, transcript_confirmed: true },
          transcript: { marker_in_transcript: true, marker_in_next_call: true },
          negatives: {
            duplicate_observation: "duplicate",
            duplicate_feedback_emitted: false,
            duplicate_delivery_rejected: true,
            wrong_owner_rejected: true,
            old_epoch_rejected: true,
            revoked_after_end_rejected: true,
            timeout_after_ttl_rejected: true,
            unavailable_original_preserved: true,
          },
          boundaries: { external_model_provider_claimed: false, new_agent_loop: false, new_steering_bus: false, host_verdict: "unchanged", m4_authorized: false },
        });
        const transcript = readFileSync(join(root, report.transcript.relative_path), "utf8");
        expect(transcript).toContain(report.delivery.evidence_id);
        const observations = readFileSync(observationsPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
        expect(observations.some((record) => record.kind === "tool-observation" && record.data.feedback?.evidenceId === report.delivery.evidence_id)).toBe(true);
        expect(observations.some((record) => record.kind === "feedback-delivery" && record.data.level === "host-delivered" && record.data.accepted)).toBe(true);
        expect(observations.some((record) => record.kind === "feedback-delivery" && record.data.level === "transcript-confirmed" && record.data.accepted)).toBe(true);
        const bridgeEvents = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
        expect(bridgeEvents.some((event) => event.kind === "feedback_produced" && event.evidenceId === report.delivery.evidence_id)).toBe(true);
        expect(bridgeEvents.some((event) => event.kind === "feedback_delivered" && event.evidenceId === report.delivery.evidence_id)).toBe(true);
        expect(bridgeEvents.some((event) => event.kind === "feedback_confirmed" && event.evidenceId === report.delivery.evidence_id)).toBe(true);
        expect(bridgeEvents.every((event) => event.driven_by === "agent" && event.actor === "electron-main")).toBe(true);
      } finally {
        await closeElectronApp(app);
      }
    } finally {
      if (!configuredRoot) rmSync(root, { recursive: true, force: true });
    }
  });
});
