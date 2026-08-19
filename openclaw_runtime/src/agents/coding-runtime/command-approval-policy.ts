/**
 * P3 UFTK: command prefix approval policy.
 *
 * Prefix token rules classify commands as `allow`, `prompt`, or `forbidden`.
 * Matching is case-insensitive and runs on normalized whitespace so shell
 * quoting/spacing variants do not bypass a prefix rule. Longest prefix wins;
 * ties resolve in rule declaration order. The default decision is `prompt`
 * (fail-closed) when no rule matches.
 */
import type { CodingExecApproval } from "../../../../shared/coding-runtime/types.js";

export type CodingCommandApprovalDecision = "allow" | "prompt" | "forbidden";

export type CodingCommandApprovalRule = {
  id?: string;
  prefix: string;
  decision: CodingCommandApprovalDecision;
  reason?: string;
};

export type CodingCommandApprovalPolicy = {
  id?: string;
  rules: CodingCommandApprovalRule[];
  defaultDecision?: CodingCommandApprovalDecision;
};

export const DEFAULT_COMMAND_APPROVAL_DECISION: CodingCommandApprovalDecision = "prompt";

function normalizeDecision(value: unknown): CodingCommandApprovalDecision | null {
  if (value === "allow" || value === "prompt" || value === "forbidden") {
    return value;
  }
  return null;
}

export function normalizeCommandPrefix(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeCommandApprovalRule(
  raw: Partial<CodingCommandApprovalRule> | null | undefined,
): CodingCommandApprovalRule | null {
  if (!raw || typeof raw !== "object") return null;
  const prefix =
    typeof (raw as { prefix?: unknown }).prefix === "string"
      ? normalizeCommandPrefix((raw as { prefix?: string }).prefix ?? "")
      : "";
  if (!prefix) return null;
  const decision = normalizeDecision((raw as { decision?: unknown }).decision);
  if (!decision) return null;
  const rule: CodingCommandApprovalRule = { prefix, decision };
  const id = (raw as { id?: unknown }).id;
  const reason = (raw as { reason?: unknown }).reason;
  if (typeof id === "string" && id.trim()) rule.id = id.trim();
  if (typeof reason === "string" && reason.trim()) rule.reason = reason.trim();
  return rule;
}

export function normalizeCommandApprovalPolicy(raw: unknown): CodingCommandApprovalPolicy {
  if (!raw || typeof raw !== "object") {
    return { rules: [] };
  }
  const record = raw as Record<string, unknown>;
  const policy: CodingCommandApprovalPolicy = { rules: [] };
  const id = record.id;
  if (typeof id === "string" && id.trim()) policy.id = id.trim();
  const defaultDecision = normalizeDecision(record.defaultDecision);
  if (defaultDecision) policy.defaultDecision = defaultDecision;
  if (Array.isArray(record.rules)) {
    for (const item of record.rules) {
      const rule = normalizeCommandApprovalRule(item as Partial<CodingCommandApprovalRule> | null | undefined);
      if (rule) policy.rules.push(rule);
    }
  }
  return policy;
}

/**
 * Evaluate a command against the policy. Returns the structured approval
 * decision that the exec-audit layer records on the `CodingExecEvent`.
 */
export function evaluateCommandApprovalPolicy(
  command: string,
  policy: CodingCommandApprovalPolicy,
): CodingExecApproval {
  const normalized = normalizeCommandPrefix(command);
  const defaultDecision = normalizeDecision(policy.defaultDecision) ?? DEFAULT_COMMAND_APPROVAL_DECISION;
  let best: { rule: CodingCommandApprovalRule; matchedPrefix: string } | null = null;

  for (const rule of policy.rules) {
    const prefix = normalizeCommandPrefix(rule.prefix);
    const matches = normalized === prefix || normalized.startsWith(`${prefix} `);
    if (!matches) continue;
    if (!best || prefix.length > best.matchedPrefix.length) {
      best = { rule, matchedPrefix: prefix };
    }
  }

  if (!best) {
    return {
      decision: defaultDecision,
      ...(policy.id ? { policyId: policy.id } : {}),
      reason: "no matching prefix rule",
    };
  }

  return {
    decision: best.rule.decision,
    ...(policy.id ? { policyId: policy.id } : {}),
    matchedPrefix: best.rule.prefix,
    ...(best.rule.reason ? { reason: best.rule.reason } : {}),
  };
}
