/** Apply the same durable Operator approval to command and agent Cron delivery. */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isTruthyEnvValue } from "../infra/env.js";

export function isCronOperatorApprovalEnabled(cfg: OpenClawConfig): boolean {
  return (
    cfg.runtime?.rc05?.operatorSliceEnabled === true ||
    isTruthyEnvValue(process.env.RC05_OPERATOR_SLICE)
  );
}

export async function withCronOperatorApproval<T>(
  input: {
    cfg: OpenClawConfig;
    agentId: string;
    jobId: string;
    runId: string;
    sessionKey: string;
    message: string;
    signal?: AbortSignal;
    isApplied?: (value: T) => boolean;
  },
  send: () => Promise<T>,
): Promise<T> {
  if (!isCronOperatorApprovalEnabled(input.cfg)) {
    return send();
  }
  const {
    createOperatorSliceIntent,
    awaitOperatorInboxDecision,
    resolveOperatorGovernancePolicy,
    resolveOperatorSliceApproval,
    executeOperatorSliceEffect,
    OPERATOR_DEFAULT_POLICY_RULE,
  } = await import("../agents/operator-slice.js");
  const identity = {
    sessionKey: input.sessionKey,
    runId: input.runId,
    cronJobId: input.jobId,
    inboxItemId: "inbox:" + input.jobId,
  };
  const options = { enabled: true };
  const intent = createOperatorSliceIntent({
    identity,
    options,
    requestJson: { jobId: input.jobId, agentId: input.agentId, message: input.message },
  });
  if (!intent.ok) throw new Error("RC-05 operator slice intent failed: " + intent.reason);
  let governance;
  if (input.cfg.runtime?.rc05?.cronAutoApprove === true) {
    governance = resolveOperatorGovernancePolicy({
      policyRule: OPERATOR_DEFAULT_POLICY_RULE,
      decision: "approved",
      actor: "cron-policy",
    });
    const resolved = resolveOperatorSliceApproval({
      approvalId: intent.approvalId,
      governance,
      options,
    });
    if (!resolved.ok) throw new Error("RC-05 operator slice rejected announce: " + resolved.reason);
  } else {
    const decided = await awaitOperatorInboxDecision({
      approvalId: intent.approvalId,
      options,
      signal: input.signal,
    });
    if (!decided.ok) throw new Error("RC-05 operator slice rejected announce: " + decided.reason);
    governance = decided.governance;
  }
  let value!: T;
  const result = await executeOperatorSliceEffect({
    identity,
    approvalId: intent.approvalId,
    governance,
    options,
    effect: { kind: "message", text: input.message },
    executor: async () => {
      try {
        value = await send();
        if (input.isApplied?.(value) === false)
          throw new Error("Cron delivery did not acknowledge the entire payload");
        return { outcome: "applied", journalRef: "journal:cron:" + input.jobId };
      } catch (error) {
        // A thrown transport may have applied part of a batch or lost its ack.
        // Keep the outcome unknown; never turn it into permission to replay.
        return {
          outcome: "unknown",
          error: String(error),
          journalRef: "journal:cron:" + input.jobId + ":unknown",
        };
      }
    },
  });
  if (!result.ok) throw new Error("RC-05 operator slice effect failed: " + result.reason);
  return value;
}
