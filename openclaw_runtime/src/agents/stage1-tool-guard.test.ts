import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeEffectReceipt } from "../../../shared/types/context-control-plane/artifacts.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { createOpenClawCodingTools } from "./agent-tools.js";
import { ApprovalLedger } from "./approval-ledger.js";
import { EffectReceiptStore } from "./effect-receipt.js";
import { projectStage1EffectReceipt } from "./stage1-effect-projection.js";
import {
  buildStage1ToolGuardBlockedResult,
  wrapToolWithStage1ToolGuard,
} from "./stage1-tool-guard.js";

const tempRoots: string[] = [];
let stateDir = "";
let workspace = "";

function options() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}

function guardOptions() {
  return {
    enabled: true,
    database: options(),
    identity: {
      sessionKey: "sess-guard",
      runId: "run-guard",
      attemptIndex: 0,
      modelCallIndex: 0,
    },
    actorKind: "principal" as const,
    workspaceRoot: workspace,
    sessionId: "sess-guard",
    nowMs: () => Date.now(),
  };
}

function writeTool() {
  const tools = createOpenClawCodingTools({
    agentId: "stage1-guard-test",
    sessionKey: "sess-guard",
    runId: "run-guard",
    sessionId: "sess-guard",
    workspaceDir: workspace,
    cwd: workspace,
    toolConstructionPlan: {
      includeBaseCodingTools: true,
      includeShellTools: false,
      includeChannelTools: false,
      includeOpenClawTools: false,
      includePluginTools: false,
    },
    writeJournalEnabled: true,
    stage1ToolGuard: guardOptions(),
  });
  const tool = tools.find((candidate) => candidate.name === "write");
  if (!tool) throw new Error("write tool missing");
  return tool;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-guard-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  workspace = path.join(root, "workspace");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stage1 Tool Guard + EffectReceipt wiring", () => {
  it("executes one real write through grant -> guard -> journal -> EffectReceipt", async () => {
    const tool = writeTool();
    const result = await tool.execute(
      "tool-1",
      { path: "sentinel.txt", content: "hello stage1" },
      undefined,
      undefined,
    );
    expect(result).toBeDefined();
    const record = result as Record<string, unknown>;
    expect(record.details).toBeDefined();
    expect(fs.readFileSync(path.join(workspace, "sentinel.txt"), "utf8")).toBe("hello stage1");

    const approval = new ApprovalLedger(options()).getByIdempotencyKey("stage1:write:tool-1");
    expect(approval?.state).toBe("reconciled");
    expect(approval?.outcome).toBe("applied");
    expect(approval?.effect_receipt_id).toBeTruthy();
    const projected = projectStage1EffectReceipt(
      new EffectReceiptStore(options()).getById(approval!.effect_receipt_id!),
    );
    expect(projected).toBeDefined();
    expect(() => normalizeEffectReceipt(projected)).not.toThrow();
    expect(projected?.outcome).toBe("applied");
    expect(projected?.journalRef).toContain("write-journal:");
  });

  it("rejects a duplicate toolCallId without re-executing the effect", async () => {
    const tool = writeTool();
    await tool.execute("tool-dup", { path: "dup.txt", content: "first" }, undefined, undefined);
    const second = await tool.execute(
      "tool-dup",
      { path: "dup.txt", content: "second" },
      undefined,
      undefined,
    );
    const secondRecord = second as Record<string, unknown>;
    const details = secondRecord.details as Record<string, unknown> | undefined;
    expect(details?.status).toBe("blocked");
    expect(fs.readFileSync(path.join(workspace, "dup.txt"), "utf8")).toBe("first");
    expect(new EffectReceiptStore(options()).listByApproval(
      new ApprovalLedger(options()).getByIdempotencyKey("stage1:write:tool-dup")!.approval_id,
    )).toHaveLength(1);
  });

  it("records unknown outcome and keeps needs_reconciliation when execution throws", async () => {
    const fakeTool = {
      name: "write",
      description: "write",
      execute: async () => {
        throw new Error("executor exploded");
      },
    } as never;
    const wrapped = wrapToolWithStage1ToolGuard(fakeTool, guardOptions());
    await expect(wrapped.execute("tool-unknown", { path: "unknown.txt", content: "x" }, undefined, undefined))
      .rejects.toThrow("executor exploded");
    const approval = new ApprovalLedger(options()).getByIdempotencyKey("stage1:write:tool-unknown");
    expect(approval?.state).toBe("needs_reconciliation");
    const projected = projectStage1EffectReceipt(
      new EffectReceiptStore(options()).getById(approval!.effect_receipt_id!),
    );
    expect(projected?.outcome).toBe("unknown");
    expect(projected?.recoverability).toBe("reconcile-from-journal");
  });

  it("denies with zero side effects when the guard is not active or path is missing", async () => {
    const inactive = wrapToolWithStage1ToolGuard(writeTool(), { ...guardOptions(), enabled: false });
    const result = await inactive.execute("tool-inactive", { path: "inactive.txt", content: "x" }, undefined, undefined);
    expect(result).toBeDefined();
    expect(fs.existsSync(path.join(workspace, "inactive.txt"))).toBe(true);

    const active = writeTool();
    const blocked = await active.execute("tool-missing-path", {}, undefined, undefined);
    const blockedRecord = blocked as Record<string, unknown>;
    expect((blockedRecord.details as Record<string, unknown>)?.status).toBe("blocked");
    expect(new ApprovalLedger(options()).getByIdempotencyKey("stage1:write:tool-missing-path")).toBeUndefined();
  });

  it("builds a queryable blocked result", () => {
    const result = buildStage1ToolGuardBlockedResult("grant-missing", "detail");
    const record = result as unknown as Record<string, unknown>;
    expect(record.content).toBeDefined();
    expect(record.details).toBeDefined();
  });
});
