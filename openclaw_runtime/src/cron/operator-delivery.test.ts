import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApprovalLedger } from "../agents/approval-ledger.js";
import { EffectReceiptStore } from "../agents/effect-receipt.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { withCronOperatorApproval } from "./operator-delivery.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cron-operator-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  vi.stubEnv("OPENCLAW_HOME", root);
  vi.stubEnv("RC05_OPERATOR_SLICE", "");
});
afterEach(() => {
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
const input = () => ({
  cfg: { runtime: { rc05: { operatorSliceEnabled: true } } },
  agentId: "main",
  jobId: "job",
  runId: "cron:job:1",
  sessionKey: "agent:main:cron:job:run:1",
  message: "bounded result",
});

it("keeps flag-off delivery unchanged, including a best-effort partial result", async () => {
  const send = vi.fn(async () => []);
  expect(
    await withCronOperatorApproval({ ...input(), cfg: {}, isApplied: () => false }, send),
  ).toEqual([]);
  expect(send).toHaveBeenCalledOnce();
  expect(new ApprovalLedger().listByState("approval_pending")).toHaveLength(0);
});

it.each(["approved", "denied"] as const)(
  "requires a durable Inbox decision before sending: %s",
  async (decision) => {
    const send = vi.fn(async () => ["ack"]);
    const result = withCronOperatorApproval(input(), send).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    );
    const ledger = new ApprovalLedger();
    await vi.waitFor(() => expect(ledger.listByState("approval_pending")).toHaveLength(1));
    const approval = ledger.listByState("approval_pending")[0];
    expect(send).not.toHaveBeenCalled();
    expect(new EffectReceiptStore().listByApproval(approval.approval_id)).toHaveLength(0);
    ledger.resolve({ approvalId: approval.approval_id, decision, resolvedBy: "verified-device" });
    if (decision === "approved") {
      expect(await result).toEqual({ value: ["ack"] });
      expect(send).toHaveBeenCalledOnce();
      expect(new EffectReceiptStore().listByApproval(approval.approval_id)).toMatchObject([
        { outcome: "applied" },
      ]);
      await expect(withCronOperatorApproval(input(), send)).rejects.toThrow("duplicate");
      expect(send).toHaveBeenCalledOnce();
    } else {
      expect(await result).toEqual({ error: expect.stringContaining("denied") });
      expect(send).not.toHaveBeenCalled();
      expect(new EffectReceiptStore().listByApproval(approval.approval_id)).toHaveLength(0);
    }
  },
);

it("records incomplete delivery as unknown and never replays it", async () => {
  const params = {
    ...input(),
    cfg: { runtime: { rc05: { operatorSliceEnabled: true, cronAutoApprove: true } } },
  };
  const send = vi.fn(async () => []);
  await expect(
    withCronOperatorApproval({ ...params, isApplied: () => false }, send),
  ).rejects.toThrow("unknown");
  const row = new ApprovalLedger().listByState("needs_reconciliation")[0];
  expect(row).toBeDefined();
  expect(new EffectReceiptStore().listByApproval(row.approval_id)).toMatchObject([
    { outcome: "unknown" },
  ]);
  await expect(withCronOperatorApproval(params, send)).rejects.toThrow("duplicate");
  expect(send).toHaveBeenCalledOnce();
});
