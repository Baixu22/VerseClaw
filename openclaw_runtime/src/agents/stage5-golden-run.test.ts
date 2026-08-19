import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runStage5GoldenCodingTurn,
  type Stage5GoldenRunResult,
} from "./stage5-golden-run.js";

const tempRoots: string[] = [];
let workspace = "";
let stateDir = "";
let archiveRoot = "";

function evidencePath(): string {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, "../../..");
  return (
    process.env.STAGE5_REAL_EVIDENCE_PATH ??
    path.join(repoRoot, "artifacts", "context-control-plane", "stage5-real-run-evidence.json")
  );
}

function writeEvidence(runId: string, result: Extract<Stage5GoldenRunResult, { ok: true }>): void {
  const target = evidencePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify({
      schema: "Stage5RealRunEvidence/v1",
      generatedAt: new Date().toISOString(),
      model: result.model,
      runId,
      observation: result.observation,
      stage2: result.stage2,
    }, null, 2)}
`,
    "utf8",
  );
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage5-golden-"));
  tempRoots.push(root);
  workspace = path.join(root, "workspace");
  stateDir = path.join(root, "state");
  archiveRoot = path.join(root, "archive");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });
});

afterEach(async () => {
  const { closeOpenClawStateDatabase } = await import("../state/openclaw-state-db.js");
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stage5 golden runner preflight", () => {
  it("defaults flag off and refuses missing key before network", async () => {
    const original = process.env.OPENCLAW_STAGE5_OBSERVATIONS;
    delete process.env.OPENCLAW_STAGE5_OBSERVATIONS;
    try {
      const off = await runStage5GoldenCodingTurn({
        sessionKey: "sess:stage5-preflight",
        runId: "run:stage5-preflight",
        workspaceRoot: workspace,
        sentinelPath: "sentinel.txt",
        sentinelContent: "off",
      });
      expect(off).toMatchObject({ ok: false, reason: "stage5-flag-off" });

      const missingKey = await runStage5GoldenCodingTurn({
        apiKey: "",
        stage5Observations: true,
        sessionKey: "sess:stage5-preflight",
        runId: "run:stage5-preflight",
        workspaceRoot: workspace,
        sentinelPath: "sentinel.txt",
        sentinelContent: "no-key",
      });
      expect(missingKey).toMatchObject({ ok: false, reason: "api-key-missing" });
    } finally {
      if (original === undefined) delete process.env.OPENCLAW_STAGE5_OBSERVATIONS;
      else process.env.OPENCLAW_STAGE5_OBSERVATIONS = original;
    }
  });

  it("refuses workspace escape before network", async () => {
    const escaped = await runStage5GoldenCodingTurn({
      apiKey: "fixture-key",
      stage5Observations: true,
      sessionKey: "sess:stage5-preflight",
      runId: "run:stage5-preflight",
      workspaceRoot: workspace,
      sentinelPath: "../escape.txt",
      sentinelContent: "no-write",
    });
    expect(escaped).toMatchObject({ ok: false, reason: "invalid-workspace-path" });
  });
});

describe("stage5 golden runner real DeepSeek path", () => {
  it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))(
    "real run: Stage 2 chain -> stage5 packer/facade observational evidence",
    async () => {
      const runId = `run:stage5-golden:${Date.now()}`;
      const result = await runStage5GoldenCodingTurn({
        apiKey: process.env.DEEPSEEK_API_KEY,
        stage5Observations: true,
        database: { env: process.env, path: path.join(stateDir, "openclaw-state.db") },
        sessionKey: "sess:stage5-golden",
        runId,
        workspaceRoot: workspace,
        sentinelPath: "stage5-sentinel.txt",
        sentinelContent: `stage5-real-${Date.now()}`,
        taskLedgerWorkspaceId: "stage5-golden",
        taskLedgerStateDir: stateDir,
        toolResultArchiveRoot: archiveRoot,
      });
      if (!result.ok) {
        throw new Error(
          `stage5 real golden run failed: reason=${result.reason} message=${result.message ?? ""}`,
        );
      }
      expect(result.model).toBe("deepseek/deepseek-v4-flash");
      expect(result.observation.authority).toBe("candidate-only");
      expect(result.observation.tools).toEqual([
        "memory_search",
        "memory_get",
        "memory_query",
        "context_search",
        "context_read",
      ]);
      expect(result.observation.pack.status).toBe("ok");
      expect(result.observation.pack.selected).toEqual([
        "stage5:user-intent",
        "stage5:write-tool-schema",
        "stage5:effect-receipt",
      ]);
      expect(result.stage2.toolCallId).toBeTruthy();
      expect(result.stage2.effectReceiptId).toBeTruthy();
      expect(
        fs.readFileSync(path.join(workspace, "stage5-sentinel.txt"), "utf8"),
      ).toMatch(/^stage5-real-/);
      writeEvidence(runId, result);
    },
    120_000,
  );
});
