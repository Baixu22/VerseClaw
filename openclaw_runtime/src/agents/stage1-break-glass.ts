/**
 * Stage 1 break-glass audit path. It reuses the existing durable ApprovalLedger
 * (the Q8 owner decision) with a distinct policy digest and actor marker. It
 * never executes an effect and never writes WireReceipt/EffectReceipt rows, so
 * the audit record cannot mix into normal golden-path egress/effect coverage.
 */
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import { ApprovalLedger, type ApprovalLedgerRow } from "./approval-ledger.js";
import {
  STAGE1_WRITE_TOOL_NAME,
} from "./stage1-tool-guard.js";
import {
  stage1GovernancePolicyDigest,
  type Stage1GrantActor,
} from "./stage1-minimal-grant.js";

export const STAGE1_BREAK_GLASS_POLICY_RULE =
  "stage1-break-glass-audit-under-owner-policy:v1";
export const STAGE1_BREAK_GLASS_POLICY_ACTOR =
  "owner:stage1-break-glass-policy";
export const STAGE1_BREAK_GLASS_IDEMPOTENCY_PREFIX =
  "stage1:break-glass:";

export function stage1BreakGlassPolicyDigest(): string {
  // Distinct from the normal stage1-golden-write-under-owner-policy:v1 digest.
  return stage1GovernancePolicyDigest(STAGE1_BREAK_GLASS_POLICY_RULE, "denied");
}

export type Stage1BreakGlassAuditInput = {
  database?: OpenClawStateDatabaseOptions;
  identity: Omit<Stage1GrantActor, "actorKind">;
  toolCallId: string;
  resource: string;
  action: string;
  reason: string;
  nowMs?: number;
};

export type Stage1BreakGlassAuditResult =
  | { ok: true; row: ApprovalLedgerRow; policyDigest: string }
  | { ok: false; reason: string };

/**
 * Record an audited break-glass denial under the distinct Stage 1 policy.
 * The existing approval ledger is the durable audit record. No tool execution,
 * no effect receipt, and no wire/egress receipt are produced.
 */
export function recordStage1BreakGlassAudit(
  input: Stage1BreakGlassAuditInput,
): Stage1BreakGlassAuditResult {
  const ledger = new ApprovalLedger(input.database ?? {});
  const now = input.nowMs ?? Date.now();
  const policyDigest = stage1BreakGlassPolicyDigest();
  const reserved = ledger.reserve({
    idempotencyKey: `${STAGE1_BREAK_GLASS_IDEMPOTENCY_PREFIX}${input.toolCallId}`,
    request: {
      breakGlass: true,
      policyRule: STAGE1_BREAK_GLASS_POLICY_RULE,
      policyDigest,
      identity: {
        sessionKey: input.identity.sessionKey,
        runId: input.identity.runId,
        attemptIndex: input.identity.attemptIndex,
        modelCallIndex: input.identity.modelCallIndex,
      },
      effect: {
        toolCallId: input.toolCallId,
        toolName: STAGE1_WRITE_TOOL_NAME,
        resource: input.resource,
        action: input.action,
      },
      reason: input.reason,
    },
    expiresAtMs: now + 60_000,
    requestedByClientId: STAGE1_BREAK_GLASS_POLICY_ACTOR,
    createdAt: now,
  });
  if (!reserved.ok) {
    return { ok: false, reason: reserved.reason };
  }
  if (reserved.row.state !== "approval_pending") {
    return { ok: true, row: reserved.row, policyDigest };
  }
  const resolved = ledger.resolve({
    approvalId: reserved.row.approval_id,
    decision: "denied",
    resolvedBy: STAGE1_BREAK_GLASS_POLICY_ACTOR,
    resolvedAtMs: now,
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  return { ok: true, row: resolved.row, policyDigest };
}
