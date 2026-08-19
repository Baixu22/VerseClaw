import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { ApprovalLedger } from "./approval-ledger.js";
import { EffectReceiptStore } from "./effect-receipt.js";
import { ReceiptStore } from "./receipt-store.js";
import {
  recordStage1BreakGlassAudit,
  STAGE1_BREAK_GLASS_IDEMPOTENCY_PREFIX,
  STAGE1_BREAK_GLASS_POLICY_ACTOR,
  stage1BreakGlassPolicyDigest,
} from "./stage1-break-glass.js";

const tempRoots: string[] = [];
let stateDir = "";

function options() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-break-glass-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stage1 break-glass audit path", () => {
  it("writes a distinct durable audit record without mixing into normal egress/effect coverage", () => {
    const ledger = new ApprovalLedger(options());
    const result = recordStage1BreakGlassAudit({
      database: options(),
      identity: {
        sessionKey: "sess-break-glass",
        runId: "run-break-glass",
        attemptIndex: 0,
        modelCallIndex: 0,
      },
      toolCallId: "tool-break-glass",
      resource: "workspace:break-glass.txt",
      action: "write",
      reason: "owner-authorized break-glass audit",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = result.row;
    expect(row.state).toBe("denied");
    expect(row.decision).toBe("denied");
    expect(row.requested_by_client_id).toBe(STAGE1_BREAK_GLASS_POLICY_ACTOR);
    expect(row.resolved_by).toBe(STAGE1_BREAK_GLASS_POLICY_ACTOR);
    expect(row.idempotency_key.startsWith(STAGE1_BREAK_GLASS_IDEMPOTENCY_PREFIX)).toBe(true);
    expect(result.policyDigest).toBe(stage1BreakGlassPolicyDigest());
    expect(row.request_digest).toMatch(/^[a-f0-9]{64}$/);

    // Public query path for the audit row.
    expect(
      ledger.getByIdempotencyKey(`${STAGE1_BREAK_GLASS_IDEMPOTENCY_PREFIX}tool-break-glass`)?.approval_id,
    ).toBe(row.approval_id);

    // The audit path produced no effect and no normal runtime receipt coverage.
    expect(new EffectReceiptStore(options()).listByApproval(row.approval_id)).toHaveLength(0);
    expect(new ReceiptStore(options()).list({ runId: "run-break-glass" })).toHaveLength(0);
  });

  it("reuses the same durable approval truth instead of creating a second ledger", () => {
    const result = recordStage1BreakGlassAudit({
      database: options(),
      identity: {
        sessionKey: "sess-break-glass",
        runId: "run-break-glass-2",
        attemptIndex: 0,
        modelCallIndex: 0,
      },
      toolCallId: "tool-break-glass-2",
      resource: "workspace:break-glass.txt",
      action: "write",
      reason: "owner-authorized break-glass audit",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new ApprovalLedger(options()).getById(result.row.approval_id)?.state).toBe("denied");
  });
});
