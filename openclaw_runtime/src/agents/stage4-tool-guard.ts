/**
 * Stage 4 runtime tool-dispatch guard for the owner-selected golden tool
 * `write`. The wrapper is inert unless `enabled: true` is supplied; it never
 * changes default production tool behavior and adds no new product flag.
 *
 * The guard reuses the existing durable ApprovalLedger and EffectReceiptStore:
 * reserve -> policy approval -> markExecutionStarted -> derive unified
 * CapabilityGrant -> verify -> execute -> write EffectReceipt -> record outcome
 * -> expire grant.
 */
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { buildBlockedToolResult } from "./agent-tools.before-tool-call.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import { ApprovalLedger } from "./approval-ledger.js";
import { EffectReceiptStore } from "./effect-receipt.js";
import {
  stage4ActorKey,
  stage4GovernancePolicyDigest,
  Stage4GrantAuthority,
  STAGE4_GRANT_TTL_MS,
  type Stage4GrantActor,
  type Stage4GrantCall,
  type Stage4GrantDenyReason,
} from "./stage4-capability-grant.js";

export const STAGE4_WRITE_POLICY_RULE = "stage4-golden-write-under-owner-policy:v1";
export const STAGE4_WRITE_POLICY_ACTOR = "owner:stage4-golden-write-policy";
export const STAGE4_WRITE_TOOL_NAME = "write";

export type Stage4ToolGuardOptions = {
  /** Explicit opt-in. Default false. */
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
  /** Tool names guarded by this adapter. Defaults to write only. */
  toolNames?: string[];
  /** Optional prebuilt authority so callers can query audit records. */
  authority?: Stage4GrantAuthority;
};

export type Stage4ToolGuardDenyReason =
  | "approval-reserve-failed"
  | "approval-already-resolved"
  | "approval-denied"
  | "approval-execution-not-started"
  | "grant-derivation-failed"
  | "grant-verification-failed";

export type Stage4ToolGuardBlockedResult = ReturnType<typeof buildBlockedToolResult>;

export function buildStage4ToolGuardBlockedResult(
  reason: Stage4ToolGuardDenyReason | Stage4GrantDenyReason,
  detail?: string,
): Stage4ToolGuardBlockedResult {
  const text = detail ? `${reason}: ${detail}` : reason;
  return buildBlockedToolResult({ reason: text });
}

function resolveActor(options: Stage4ToolGuardOptions): Stage4GrantActor {
  return {
    sessionKey: options.identity.sessionKey,
    runId: options.identity.runId,
    attemptIndex: options.identity.attemptIndex,
    modelCallIndex: options.identity.modelCallIndex,
    actorKind: options.actorKind ?? "principal",
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
 * Wrap the owner-selected `write` tool with the Stage 4 CapabilityGrant guard.
 * Non-write tools and disabled wrappers pass through unchanged.
 */
export function wrapToolWithStage4ToolGuard(
  tool: AnyAgentTool,
  options: Stage4ToolGuardOptions,
): AnyAgentTool {
  if (options.enabled !== true) return tool;
  const toolNames = options.toolNames ?? [STAGE4_WRITE_TOOL_NAME];
  if (!toolNames.includes(tool.name)) return tool;
  const execute = tool.execute;
  if (!execute) return tool;

  const authority =
    options.authority ??
    new Stage4GrantAuthority({ nowMs: options.nowMs ?? (() => Date.now()) });

  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const now = options.nowMs?.() ?? Date.now();
      const actor = resolveActor(options);
      const approvalPolicyDigest = stage4GovernancePolicyDigest(
        STAGE4_WRITE_POLICY_RULE,
        "approved",
      );
      const deny = (
        reason: Stage4ToolGuardDenyReason | Stage4GrantDenyReason,
        detail?: string,
        grantId: string | null = null,
      ) => {
        authority.deny({
          grantId,
          policyDigest: approvalPolicyDigest,
          actorChain: [stage4ActorKey(actor)],
          reason: detail ? `${reason}: ${detail}` : reason,
          atMs: now,
        });
        return buildStage4ToolGuardBlockedResult(reason, detail);
      };

      const params = getToolParamsRecord(args) ?? {};
      const filePath = typeof params.path === "string" ? params.path.trim() : "";
      if (!filePath) {
        return deny("grant-verification-failed", "write path is required");
      }
      const resource = `workspace:${filePath.replaceAll("\\", "/").replace(/^\/+/, "")}`;
      const action = "write";
      const purpose = "golden coding turn: write one controlled workspace file";
      const ledger = new ApprovalLedger(options.database ?? {});
      const effects = new EffectReceiptStore(options.database ?? {});

      const reserved = ledger.reserve({
        idempotencyKey: `stage4:${STAGE4_WRITE_TOOL_NAME}:${toolCallId}`,
        request: {
          toolCallId,
          toolName: STAGE4_WRITE_TOOL_NAME,
          resource,
          action,
          purpose,
          identity: actor,
        },
        expiresAtMs: now + STAGE4_GRANT_TTL_MS,
        requestedByClientId: STAGE4_WRITE_POLICY_ACTOR,
        createdAt: now,
      });
      if (!reserved.ok) {
        return deny("approval-reserve-failed", reserved.reason);
      }
      if (reserved.row.state !== "approval_pending") {
        return deny("approval-already-resolved", reserved.row.state);
      }

      const resolved = ledger.resolve({
        approvalId: reserved.row.approval_id,
        decision: "approved",
        resolvedBy: STAGE4_WRITE_POLICY_ACTOR,
        resolvedAtMs: now,
      });
      if (!resolved.ok) {
        return deny("approval-reserve-failed", resolved.reason);
      }
      if (resolved.row.state === "denied") {
        return deny("approval-denied");
      }

      const started = ledger.markExecutionStarted(resolved.row.approval_id);
      if (!started.ok) {
        return deny(
          "approval-execution-not-started",
          started.reason,
        );
      }

      const issued = authority.issue({
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
      if (!issued.ok) {
        return deny("grant-derivation-failed", issued.reason);
      }

      const call: Stage4GrantCall = {
        toolCallId,
        toolName: STAGE4_WRITE_TOOL_NAME,
        resource,
        action,
        purpose,
        actor,
        approvalId: started.row.approval_id,
        policyDigest: approvalPolicyDigest,
        resolvedBy: STAGE4_WRITE_POLICY_ACTOR,
      };
      const verdict = authority.verify(issued.grant, call, now);
      if (!verdict.allow) {
        return deny(verdict.reason, undefined, issued.grant.grantId);
      }

      try {
        const result = await execute(toolCallId, args, signal, onUpdate);
        const journalRef = journalRefFromResult(result);
        const proposal = {
          effect: {
            toolCallId,
            toolName: STAGE4_WRITE_TOOL_NAME,
            resource,
            action,
          },
          identity: actor,
          governance: {
            actor: STAGE4_WRITE_POLICY_ACTOR,
            policyDigest: approvalPolicyDigest,
            rule: STAGE4_WRITE_POLICY_RULE,
          },
        };
        const effectResult = effects.record({
          idempotencyKey: issued.grant.effectIdempotency.key,
          approvalId: started.row.approval_id,
          proposal,
          approvalDecision: "approved",
          domainExecutor: "stage4-write-tool-guard",
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
          return deny("grant-verification-failed", effectResult.reason, issued.grant.grantId);
        }
        ledger.recordEffectOutcome({
          approvalId: started.row.approval_id,
          outcome: "applied",
          effectReceiptId: effectResult.effectReceiptId,
          domainJournalRef: journalRef,
        });
        authority.markExpired(issued.grant.grantId, now);
        return result;
      } catch (error) {
        try {
          const proposal = {
            effect: {
              toolCallId,
              toolName: STAGE4_WRITE_TOOL_NAME,
              resource,
              action,
            },
            identity: actor,
            governance: {
              actor: STAGE4_WRITE_POLICY_ACTOR,
              policyDigest: approvalPolicyDigest,
              rule: STAGE4_WRITE_POLICY_RULE,
            },
          };
          const effectResult = effects.record({
            idempotencyKey: issued.grant.effectIdempotency.key,
            approvalId: started.row.approval_id,
            proposal,
            approvalDecision: "approved",
            domainExecutor: "stage4-write-tool-guard",
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
