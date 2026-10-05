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
  buildStage4ToolGuardBlockedResult,
  wrapToolWithStage4ToolGuard,
} from "./stage4-tool-guard.js";

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
    agentId: "stage4-guard-test",
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
    stage4ToolGuard: guardOptions(),
  });
  const tool = tools.find((candidate) => candidate.name === "write");
  if (!tool) throw new Error("write tool missing");
  return tool;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-guard-"));
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

describe("stage4 Tool Guard + EffectReceipt wiring", () => {
  it("executes one real write through grant -> guard -> journal -> EffectReceipt", async () => {
    const tool = writeTool();
    const result = await tool.execute(
      "tool-1",
      { path: "sentinel.txt", content: "hello stage4" },
      undefined,
      undefined,
    );
    expect(result).toBeDefined();
    expect(fs.readFileSync(path.join(workspace, "sentinel.txt"), "utf8")).toBe("hello stage4");

    const approval = new ApprovalLedger(options()).getByIdempotencyKey("stage4:write:tool-1");
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
    const secondRecord = second;
    const details = secondRecord.details as Record<string, unknown> | undefined;
    expect(details?.status).toBe("blocked");
    expect(fs.readFileSync(path.join(workspace, "dup.txt"), "utf8")).toBe("first");
    const approval = new ApprovalLedger(options()).getByIdempotencyKey("stage4:write:tool-dup");
    expect(
      new EffectReceiptStore(options()).listByApproval(approval!.approval_id),
    ).toHaveLength(1);
  });

  it("blocks a missing write path before any ledger write", async () => {
    const tool = writeTool();
    const blocked = await tool.execute("tool-missing-path", {}, undefined, undefined);
    const blockedRecord = blocked;
    expect((blockedRecord.details as Record<string, unknown>)?.status).toBe("blocked");
    expect(new ApprovalLedger(options()).getByIdempotencyKey("stage4:write:tool-missing-path")).toBeUndefined();
    expect(fs.existsSync(path.join(workspace, "missing.txt"))).toBe(false);
  });

  it("builds a queryable blocked result", () => {
    const result = buildStage4ToolGuardBlockedResult("grant-missing", "detail");
    const record = result;
    expect(record.content).toBeDefined();
    expect(record.details).toBeDefined();
  });

  it("passes through non-write tools and disabled wrappers", async () => {
    const fakeRead = {
      name: "read",
      description: "read",
      execute: async () => "read-executed",
    } as never;
    const wrapped = wrapToolWithStage4ToolGuard(fakeRead, guardOptions());
    expect(wrapped).toBe(fakeRead);

    const fakeWrite = {
      name: "write",
      description: "write",
      execute: async () => "write-executed",
    } as never;
    const disabled = wrapToolWithStage4ToolGuard(fakeWrite, { ...guardOptions(), enabled: false });
    expect(disabled).toBe(fakeWrite);
  });
});
