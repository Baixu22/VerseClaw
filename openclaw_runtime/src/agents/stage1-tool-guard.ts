/**
 * Stage 1 runtime tool-dispatch guard for the owner-selected golden tool
 * `write`. The wrapper is inert unless `enabled: true` is supplied by the
 * explicit Stage 1 golden runner; it never changes default production tool
 * behavior and adds no new product flag.
 *
 * The guard reuses the existing durable ApprovalLedger and EffectReceiptStore:
 * reserve -> policy approval -> markExecutionStarted -> derive temporary
 * minimal grant -> verify -> execute -> write EffectReceipt -> record outcome.
 */
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { buildBlockedToolResult } from "./agent-tools.before-tool-call.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import { ApprovalLedger } from "./approval-ledger.js";
import { EffectReceiptStore } from "./effect-receipt.js";
import {
  deriveStage1MinimalGrant,
  stage1GovernancePolicyDigest,
  STAGE1_GRANT_ACTOR_KIND,
  verifyStage1MinimalGrant,
  type Stage1GrantActor,
  type Stage1ToolGuardCall,
  type Stage1ToolGuardVerdict,
} from "./stage1-minimal-grant.js";

export const STAGE1_WRITE_POLICY_RULE = "stage1-golden-write-under-owner-policy:v1";
export const STAGE1_WRITE_POLICY_ACTOR = "owner:stage1-golden-write-policy";
export const STAGE1_WRITE_TOOL_NAME = "write";

export type Stage1ToolGuardOptions = {
  /** Explicit opt-in by the Stage 1 golden runner. Default false. */
  enabled?: boolean;
  database?: OpenClawStateDatabaseOptions;
  identity: {
    sessionKey: string;
    runId: string;
    attemptIndex: number;
    modelCallIndex: number;
  };
  actorKind?: "principal" | "delegate";
  workspaceRoot: string;
  sessionId?: string;
  /** Stable test clock. */
  nowMs?: () => number;
};

export type Stage1ToolGuardDenyReason =
  | "approval-reserve-failed"
  | "approval-already-resolved"
  | "approval-denied"
  | "approval-execution-not-started"
  | "grant-derivation-failed"
  | "grant-verification-failed";

export type Stage1ToolGuardBlockedResult = ReturnType<typeof buildBlockedToolResult>;

export function buildStage1ToolGuardBlockedResult(
  reason: Stage1ToolGuardDenyReason | NonNullable<Stage1ToolGuardVerdict["reason"]>,
  detail?: string,
): Stage1ToolGuardBlockedResult {
  const text = detail ? `${reason}: ${detail}` : reason;
  return buildBlockedToolResult({ reason: text });
}

function policyDigest(): string {
  return stage1GovernancePolicyDigest(STAGE1_WRITE_POLICY_RULE, "approved");
}

function resolveActor(options: Stage1ToolGuardOptions): Stage1GrantActor {
  return {
    sessionKey: options.identity.sessionKey,
    runId: options.identity.runId,
    attemptIndex: options.identity.attemptIndex,
    modelCallIndex: options.identity.modelCallIndex,
    actorKind: options.actorKind ?? STAGE1_GRANT_ACTOR_KIND,
  };
}

function journalRefFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const details = (result as Record<string, unknown>).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const writeJournal = (details as Record<string, unknown>).write_journal;
  if (!writeJournal || typeof writeJournal !== "object" || Array.isArray(writeJournal)) return undefined;
  const snapshots = (writeJournal as Record<string, unknown>).snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) return undefined;
  const first = snapshots[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;
  const journalEntryId = (first as Record<string, unknown>).journalEntryId;
  return typeof journalEntryId === "string" && journalEntryId ? journalEntryId : undefined;
}

/**
 * Wrap the owner-selected `write` tool. Non-write tools pass through unchanged.
 * The wrapper sits inside the before_tool_call hook wrapper so it observes the
 * hook-adjusted final parameters, and outside the write-journal/write-side
 * effect wrappers so it can read their journal evidence from the result.
 */
export function wrapToolWithStage1ToolGuard(
  tool: AnyAgentTool,
  options: Stage1ToolGuardOptions,
): AnyAgentTool {
  if (options.enabled !== true || tool.name !== STAGE1_WRITE_TOOL_NAME) {
    return tool;
  }
  const execute = tool.execute;
  if (!execute) return tool;
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const params = getToolParamsRecord(args) ?? {};
      const filePath = typeof params.path === "string" ? params.path.trim() : "";
      if (!filePath) {
        return buildStage1ToolGuardBlockedResult("grant-verification-failed", "write path is required");
      }
      const now = options.nowMs?.() ?? Date.now();
      const actor = resolveActor(options);
      const resource = `workspace:${filePath.replaceAll("\\", "/").replace(/^\/+/, "")}`;
      const action = "write";
      const purpose = "golden coding turn: write one controlled workspace file";
      const ledger = new ApprovalLedger(options.database ?? {});
      const effects = new EffectReceiptStore(options.database ?? {});
      const approvalPolicyDigest = policyDigest();

      const reserved = ledger.reserve({
        idempotencyKey: `stage1:${STAGE1_WRITE_TOOL_NAME}:${toolCallId}`,
        request: {
          toolCallId,
          toolName: STAGE1_WRITE_TOOL_NAME,
          resource,
          action,
          purpose,
          identity: actor,
        },
        expiresAtMs: now + 60_000,
        requestedByClientId: STAGE1_WRITE_POLICY_ACTOR,
        createdAt: now,
      });
      if (!reserved.ok) {
        return buildStage1ToolGuardBlockedResult("approval-reserve-failed", reserved.reason);
      }
      if (reserved.row.state !== "approval_pending") {
        return buildStage1ToolGuardBlockedResult("approval-already-resolved", reserved.row.state);
      }

      const resolved = ledger.resolve({
        approvalId: reserved.row.approval_id,
        decision: "approved",
        resolvedBy: STAGE1_WRITE_POLICY_ACTOR,
        resolvedAtMs: now,
      });
      if (!resolved.ok) {
        return buildStage1ToolGuardBlockedResult("approval-reserve-failed", resolved.reason);
      }
      if (resolved.row.state === "denied") {
        return buildStage1ToolGuardBlockedResult("approval-denied");
      }

      const started = ledger.markExecutionStarted(resolved.row.approval_id);
      if (!started.ok) {
        return buildStage1ToolGuardBlockedResult("approval-execution-not-started", started.reason);
      }

      const derived = deriveStage1MinimalGrant({
        approvalRow: started.row,
        actor,
        scope: {
          taskBranchId: actor.runId,
          resource,
          action,
          purpose,
        },
        policyDigest: approvalPolicyDigest,
        toolCallId,
        issuedAtMs: now,
        nowMs: now,
      });
      if (!derived.ok) {
        return buildStage1ToolGuardBlockedResult("grant-derivation-failed", derived.reason);
      }

      const call: Stage1ToolGuardCall = {
        toolCallId,
        toolName: STAGE1_WRITE_TOOL_NAME,
        resource,
        action,
        purpose,
        actor,
        approvalId: started.row.approval_id,
        policyDigest: approvalPolicyDigest,
        resolvedBy: STAGE1_WRITE_POLICY_ACTOR,
        nowMs: now,
      };
      const verdict = verifyStage1MinimalGrant(derived.grant, call);
      if (!verdict.allow) {
        return buildStage1ToolGuardBlockedResult(verdict.reason);
      }

      try {
        const result = await execute(toolCallId, args, signal, onUpdate);
        const journalRef = journalRefFromResult(result);
        const proposal = {
          effect: {
            toolCallId,
            toolName: STAGE1_WRITE_TOOL_NAME,
            resource,
            action,
          },
          identity: actor,
          governance: {
            actor: STAGE1_WRITE_POLICY_ACTOR,
            policyDigest: approvalPolicyDigest,
            rule: STAGE1_WRITE_POLICY_RULE,
          },
        };
        const effectResult = effects.record({
          idempotencyKey: verdict.grant.effectIdempotency.key,
          approvalId: started.row.approval_id,
          proposal,
          approvalDecision: "approved",
          domainExecutor: "stage1-write-tool-guard",
          outcome: "applied",
          journalRef,
          recoverability: journalRef ? "none-needed" : "journal-replay",
          stage1Context: {
            approvalPolicyDigest,
            actor,
            effect: proposal.effect,
          },
          createdAt: now,
        });
        if (!effectResult.ok) {
          return buildStage1ToolGuardBlockedResult(
            "grant-verification-failed",
            effectResult.reason,
          );
        }
        ledger.recordEffectOutcome({
          approvalId: started.row.approval_id,
          outcome: "applied",
          effectReceiptId: effectResult.effectReceiptId,
          domainJournalRef: journalRef,
        });
        return result;
      } catch (error) {
        // Unknown outcome is never replayed. Record the bounded fact and keep
        // the original error flowing to the existing tool error path.
        try {
          const proposal = {
            effect: {
              toolCallId,
              toolName: STAGE1_WRITE_TOOL_NAME,
              resource,
              action,
            },
            identity: actor,
            governance: {
              actor: STAGE1_WRITE_POLICY_ACTOR,
              policyDigest: approvalPolicyDigest,
              rule: STAGE1_WRITE_POLICY_RULE,
            },
          };
          const effectResult = effects.record({
            idempotencyKey: verdict.grant.effectIdempotency.key,
            approvalId: started.row.approval_id,
            proposal,
            approvalDecision: "approved",
            domainExecutor: "stage1-write-tool-guard",
            outcome: "unknown",
            recoverability: "reconcile-from-journal",
            stage1Context: {
              approvalPolicyDigest,
              actor,
              effect: proposal.effect,
            },
            createdAt: now,
          });
          if (effectResult.ok) {
            ledger.recordEffectOutcome({
              approvalId: started.row.approval_id,
              outcome: "unknown",
              effectReceiptId: effectResult.effectReceiptId,
            });
          }
        } catch {
          // Reconciliation stays durable through the ledger state when possible.
        }
        throw error;
      }
    },
  };
}
