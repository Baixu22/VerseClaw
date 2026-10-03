// RC-05 desktop Inbox gateway methods. The Inbox is the real governance surface
// for Operator slice intents: it lists pending operator approvals from the
// durable RC-04 approval ledger (never a fabricated list), records the operator
// decision with actor + policy digest, and projects the context/effect/recovery
// lineage from real ContextReceipt / EffectReceipt data.
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { ApprovalLedger } from "../../agents/approval-ledger.js";
import {
  inboxGovernanceDecision,
  OPERATOR_SLICE_ACTOR,
  projectOperatorLineage,
} from "../../agents/operator-slice.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

export type InboxDatabaseOptions = { env?: NodeJS.ProcessEnv; path?: string };

const OPERATOR_INTENT_LIST_LIMIT = 100;

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDecision(value: unknown): "approved" | "denied" | null {
  return value === "approved" || value === "denied" ? value : null;
}

/** List pending + recently resolved operator intents from the durable ledger. */
function listOperatorIntents(ledger: ApprovalLedger): Array<Record<string, unknown>> {
  const pending = ledger.listByState("approval_pending");
  const intents: Array<Record<string, unknown>> = [];
  for (const row of pending) {
    // Only intents created by the Cron ingress are operator-slice intents.
    if (row.requested_by_client_id !== OPERATOR_SLICE_ACTOR) continue;
    intents.push({
      approvalId: row.approval_id,
      state: row.state,
      requestDigest: row.request_digest,
      createdAtMs: row.created_at,
      expiresAtMs: row.expires_at_ms,
      resolvedBy: row.resolved_by,
      decision: row.decision,
    });
    if (intents.length >= OPERATOR_INTENT_LIST_LIMIT) break;
  }
  return intents;
}

export function createInboxHandlers(options: InboxDatabaseOptions = {}): GatewayRequestHandlers {
  const ledger = new ApprovalLedger(options);

  const listHandler: GatewayRequestHandler = async ({ respond }) => {
    respond(true, { intents: listOperatorIntents(ledger) }, undefined);
  };

  const decideHandler: GatewayRequestHandler = async ({ params, respond, client }) => {
    const record = (params ?? {}) as Record<string, unknown>;
    const approvalId = normalizeOptionalString(record.approvalId);
    const decision = normalizeDecision(record.decision);
    if (!approvalId || !decision) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "approvalId and decision are required"),
      );
      return;
    }
    // Security review fix: an Inbox decision requires a VERIFIED device
    // identity. displayName is client-supplied at connect and spoofable; the
    // actor is bound to the device identity ONLY under device-token auth.
    const connect = (client as { connect?: { device?: { id?: string }; client?: { id?: string } } } | undefined)
      ?.connect;
    const isDeviceTokenAuth = (client as { isDeviceTokenAuth?: boolean } | undefined)?.isDeviceTokenAuth === true;
    const actor = isDeviceTokenAuth
      ? normalizeOptionalString(connect?.device?.id) ?? normalizeOptionalString(connect?.client?.id)
      : null;
    if (!actor) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_LINKED, "inbox decisions require a verified device identity"),
      );
      return;
    }
    // The policy digest is computed server-side from the decision rule; a
    // client-supplied digest is never trusted verbatim.
    const governance = inboxGovernanceDecision({ decision, actor });
    // Security review fix: the Inbox may only decide OPERATOR slice intents
    // (created by the Cron ingress). Resolving arbitrary ledger rows from the
    // shared approval store would pollute the durable audit trail and strand
    // other clients' pending exec approvals.
    const row = ledger.getById(approvalId);
    if (!row || row.requested_by_client_id !== OPERATOR_SLICE_ACTOR) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.APPROVAL_NOT_FOUND, "approval is not an operator inbox intent"),
      );
      return;
    }
    const resolved = ledger.resolve({
      approvalId,
      decision: governance.decision,
      resolvedBy: governance.actor,
    });
    if (!resolved.ok) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `inbox decision failed: ${resolved.reason}`,
          resolved.row ? { details: { state: resolved.row.state } } : undefined,
        ),
      );
      return;
    }
    respond(true, { approvalId, state: resolved.row.state, actor: governance.actor, policyDigest: governance.policyDigest }, undefined);
  };

  const lineageHandler: GatewayRequestHandler = async ({ params, respond, client }) => {
    // Security review fix: lineage exposes receipt ids, approval state and
    // recovery refs for arbitrary runId/sessionKey, so it requires the same
    // VERIFIED device identity as decide (never a spoofable displayName).
    const connect = (client as { connect?: { device?: { id?: string }; client?: { id?: string } } } | undefined)
      ?.connect;
    const isDeviceTokenAuth = (client as { isDeviceTokenAuth?: boolean } | undefined)?.isDeviceTokenAuth === true;
    const actor = isDeviceTokenAuth
      ? normalizeOptionalString(connect?.device?.id) ?? normalizeOptionalString(connect?.client?.id)
      : null;
    if (!actor) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_LINKED, "inbox lineage requires a verified device identity"),
      );
      return;
    }
    const record = (params ?? {}) as Record<string, unknown>;
    const sessionKey = normalizeOptionalString(record.sessionKey);
    const runId = normalizeOptionalString(record.runId);
    if (!sessionKey || !runId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and runId are required"));
      return;
    }
    const lineage = projectOperatorLineage({
      identity: { sessionKey, runId },
      options: { database: options },
    });
    respond(true, lineage, undefined);
  };

  return {
    "inbox.operator.list": listHandler,
    "inbox.operator.decide": decideHandler,
    "inbox.operator.lineage": lineageHandler,
  };
}

/** Normalized prefix matcher reused by inbox list filters. */
export function normalizeInboxInput(value: unknown): string {
  return normalizeLowercaseStringOrEmpty(typeof value === "string" ? value : "");
}
