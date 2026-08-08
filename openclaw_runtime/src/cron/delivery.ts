/** Sends cron announce payloads and best-effort failure notifications. */
import { sendDurableMessageBatch } from "../channels/message/runtime.js";
import type { CliDeps } from "../gateway/cli-runtime/deps.types.js";
import { createOutboundSendDeps } from "../gateway/cli-runtime/outbound-send-deps.js";
import type { OpenClawConfig } from "../config/types.js";
import { formatErrorMessage } from "../infra/errors.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { resolveAgentOutboundIdentity } from "../infra/outbound/identity.js";
import { buildOutboundSessionContext } from "../infra/outbound/session-context.js";
import { getChildLogger } from "../logging.js";
import {
  resolveFailureDestination,
  type CronFailureDeliveryPlan,
  type CronFailureDestinationInput,
  type CronDeliveryPlan,
  resolveCronDeliveryPlan,
} from "./delivery-plan.js";
import {
  resolveDeliveryTarget,
  type DeliveryTargetResolution,
} from "./isolated-agent/delivery-target.js";
import { resolveCronNotificationSessionKey } from "./session-target.js";
import type { CronMessageChannel } from "./types.js";

export {
  resolveCronDeliveryPlan,
  resolveFailureDestination,
  type CronDeliveryPlan,
  type CronFailureDeliveryPlan,
  type CronFailureDestinationInput,
};

const FAILURE_NOTIFICATION_TIMEOUT_MS = 30_000;
const cronDeliveryLogger = getChildLogger({ subsystem: "cron-delivery" });

/** Channel target metadata used for cron announcements and failure notifications. */
export type CronAnnounceTarget = {
  channel?: string;
  to?: string;
  accountId?: string;
  sessionKey?: string;
};

type SuccessfulDeliveryTarget = Extract<DeliveryTargetResolution, { ok: true }>;

async function resolveCronAnnounceDelivery(params: {
  cfg: OpenClawConfig;
  agentId: string;
  jobId: string;
  target: CronAnnounceTarget;
}): Promise<
  | {
      ok: true;
      resolvedTarget: SuccessfulDeliveryTarget;
      session: ReturnType<typeof buildOutboundSessionContext>;
      identity: ReturnType<typeof resolveAgentOutboundIdentity>;
    }
  | { ok: false; error: Error }
> {
  // Resolve the target before building outbound identity/session so send errors
  // report the configured route, not only the cron job id.
  const resolvedTarget = await resolveDeliveryTarget(params.cfg, params.agentId, {
    channel: params.target.channel as CronMessageChannel | undefined,
    to: params.target.to,
    accountId: params.target.accountId,
    sessionKey: params.target.sessionKey,
  });

  if (!resolvedTarget.ok) {
    return { ok: false, error: resolvedTarget.error };
  }

  const identity = resolveAgentOutboundIdentity(params.cfg, params.agentId);
  const session = buildOutboundSessionContext({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: resolveCronNotificationSessionKey({
      jobId: params.jobId,
      sessionKey: params.target.sessionKey,
    }),
  });

  return {
    ok: true,
    resolvedTarget,
    session,
    identity,
  };
}

async function deliverCronAnnouncePayload(params: {
  deps: CliDeps;
  cfg: OpenClawConfig;
  delivery: {
    resolvedTarget: SuccessfulDeliveryTarget;
    session: ReturnType<typeof buildOutboundSessionContext>;
    identity: ReturnType<typeof resolveAgentOutboundIdentity>;
  };
  message: string;
  abortSignal: AbortSignal;
}): Promise<void> {
  // Cron delivery is durable and non-best-effort for primary announces; partial
  // channel failure must surface as a cron run failure.
  const send = await sendDurableMessageBatch({
    cfg: params.cfg,
    channel: params.delivery.resolvedTarget.channel,
    to: params.delivery.resolvedTarget.to,
    accountId: params.delivery.resolvedTarget.accountId,
    threadId: params.delivery.resolvedTarget.threadId,
    payloads: [{ text: params.message }],
    session: params.delivery.session,
    identity: params.delivery.identity,
    bestEffort: false,
    deps: createOutboundSendDeps(params.deps),
    signal: params.abortSignal,
  });
  if (send.status === "failed" || send.status === "partial_failed") {
    throw send.error;
  }
}

/** Sends a cron announce payload and throws if target resolution or delivery fails. */
export async function sendCronAnnouncePayloadStrict(params: {
  deps: CliDeps;
  cfg: OpenClawConfig;
  agentId: string;
  jobId: string;
  target: CronAnnounceTarget;
  message: string;
  abortSignal: AbortSignal;
  /** Per-run unique key (e.g. `${jobId}:${runAtMs}`). Required for the Operator
   *  slice idempotency key so each cron run is a distinct intent; falls back to
   *  jobId when omitted (legacy callers). */
  runKey?: string;
}): Promise<void> {
  const delivery = await resolveCronAnnounceDelivery(params);
  if (!delivery.ok) {
    throw delivery.error;
  }
  // RC-05 production wiring: when the operator-slice flag is enabled, the cron
  // announce runs the Operator governance slice (durable approval + bounded
  // message effect + EffectReceipt + restart recovery) around the real channel
  // delivery. The Cron ingress ONLY creates the approval intent; approval comes
  // from the explicit governance policy (actor + policyDigest recorded). The
  // ledger is marked applied only after the real send executor reports
  // success. Flag-off keeps the legacy announce path byte-identical.
  const sliceEnabled =
    params.cfg.runtime?.rc05?.operatorSliceEnabled === true ||
    isTruthyEnvValue(process.env.RC05_OPERATOR_SLICE);
  if (sliceEnabled) {
    const {
      createOperatorSliceIntent,
      executeOperatorSliceEffect,
      resolveOperatorGovernancePolicy,
      resolveOperatorSliceApproval,
      OPERATOR_DEFAULT_POLICY_RULE,
    } = await import("../agents/operator-slice.js");
    const identity = {
      sessionKey: params.target.sessionKey ?? `cron:${params.agentId}`,
      // RC-05 review fix: the Operator idempotency key must be per-run unique
      // (a stable jobId would make every later tick a duplicate intent).
      runId: params.runKey ?? params.jobId,
      cronJobId: params.jobId,
      inboxItemId: `inbox:${params.jobId}`,
    };
    const requestJson = { jobId: params.jobId, agentId: params.agentId, message: params.message };

    // 1. Cron ingress: create the approval intent only (never resolve inline).
    const intent = createOperatorSliceIntent({
      identity,
      requestJson,
      options: { enabled: true },
    });
    if (!intent.ok) {
      throw new Error(`RC-05 operator slice intent failed: ${intent.reason}`);
    }

    // 2. Governance: the explicit policy rule decides; the decision itself is
    //    NOT hardcoded inline — it comes from the explicit runtime config
    //    (runtime.rc05.cronAutoApprove). Default is deny: without the explicit
    //    opt-in the announce is not delivered (fail-closed). A denial produces
    //    zero effect.
    const cronAutoApprove = params.cfg.runtime?.rc05?.cronAutoApprove === true;
    const governance = resolveOperatorGovernancePolicy({
      policyRule: OPERATOR_DEFAULT_POLICY_RULE,
      decision: cronAutoApprove ? "approved" : "denied",
      actor: "cron-policy",
    });
    const resolved = resolveOperatorSliceApproval({
      approvalId: intent.approvalId,
      governance,
      options: { enabled: true },
    });
    if (!resolved.ok) {
      throw new Error(`RC-05 operator slice rejected announce: ${resolved.reason}`);
    }

    // 3. Execute: execution_started -> REAL channel send -> applied on ack.
    const sliceResult = await executeOperatorSliceEffect({
      identity,
      approvalId: intent.approvalId,
      effect: { kind: "message", text: params.message },
      governance,
      options: { enabled: true },
      executor: async (effect, _sliceIdentity) => {
        if (effect.kind !== "message") {
          return { outcome: "not_applied", error: "cron announce requires a message effect" };
        }
        try {
          await deliverCronAnnouncePayload({
            deps: params.deps,
            cfg: params.cfg,
            delivery,
            message: effect.text,
            abortSignal: params.abortSignal,
          });
          return { outcome: "applied", journalRef: `journal:cron:${params.jobId}` };
        } catch (err) {
          // Explicit failure -> not_applied (never applied/reconciled before a
          // successful channel ack); a timeout/abort without ack -> unknown.
          const message = err instanceof Error ? err.message : String(err);
          const aborted = params.abortSignal.aborted;
          return aborted
            ? { outcome: "unknown", error: message, journalRef: `journal:cron:${params.jobId}:unknown` }
            : { outcome: "not_applied", error: message };
        }
      },
    });
    if (sliceResult.ok !== true) {
      throw new Error(`RC-05 operator slice effect failed: ${sliceResult.reason}`);
    }
    return;
  }
  await deliverCronAnnouncePayload({
    deps: params.deps,
    cfg: params.cfg,
    delivery,
    message: params.message,
    abortSignal: params.abortSignal,
  });
}

/** Sends a best-effort cron failure notification, logging resolution/send failures. */
export async function sendFailureNotificationAnnounce(
  deps: CliDeps,
  cfg: OpenClawConfig,
  agentId: string,
  jobId: string,
  target: CronAnnounceTarget,
  message: string,
): Promise<void> {
  const delivery = await resolveCronAnnounceDelivery({ cfg, agentId, jobId, target });

  if (!delivery.ok) {
    // Failure alerts must not mask the original cron run failure.
    cronDeliveryLogger.warn(
      { error: delivery.error.message },
      "cron: failed to resolve failure destination target",
    );
    return;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    // Failure notifications are secondary; timeout prevents a stuck channel send
    // from extending an already-failed cron run.
    abortController.abort();
  }, FAILURE_NOTIFICATION_TIMEOUT_MS);

  try {
    await deliverCronAnnouncePayload({
      deps,
      cfg,
      delivery,
      message,
      abortSignal: abortController.signal,
    });
  } catch (err) {
    cronDeliveryLogger.warn(
      {
        err: formatErrorMessage(err),
        channel: delivery.resolvedTarget.channel,
        to: delivery.resolvedTarget.to,
      },
      "cron: failure destination announce failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}
