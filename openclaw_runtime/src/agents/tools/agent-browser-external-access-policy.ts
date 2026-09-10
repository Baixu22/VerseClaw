import {
  isExternalOrUnknownProvenance,
  provenanceStatus,
  type ContentProvenanceContext,
  type ProvenanceStatus,
} from "../../../../shared/security/content-provenance.js";

export type AgentBrowserExternalAccessPolicyInput = {
  provenanceContext?: ContentProvenanceContext;
  connectionMode?: unknown;
};

export type AgentBrowserExternalAccessPolicyResult = {
  status: ProvenanceStatus;
  allowed: boolean;
  restricted: boolean;
  reason?: string;
};

export type AgentBrowserSessionEffect = "click" | "type";

export type AgentBrowserSessionEffectPolicyInput = {
  provenanceContext?: ContentProvenanceContext;
  sessionConnectionMode?: unknown;
  action: AgentBrowserSessionEffect;
};

function isExternalConnectionMode(value: unknown): boolean {
  return value === "auto-connect" || value === "cdp" || value === "external-profile";
}

/** Prevent content-derived tool arguments from opting into an external browser connection. */
export function resolveAgentBrowserExternalAccessPolicy(
  input: AgentBrowserExternalAccessPolicyInput,
): AgentBrowserExternalAccessPolicyResult {
  const status = provenanceStatus(input.provenanceContext?.provenance);
  if (!isExternalConnectionMode(input.connectionMode) || !isExternalOrUnknownProvenance(status)) {
    return { status, allowed: true, restricted: false };
  }

  return {
    status,
    allowed: false,
    restricted: true,
    reason:
      "Agent browser external connection denied: external or unknown provenance may only use the managed browser connection mode.",
  };
}

export function shouldPreflightAgentBrowserSessionEffect(
  provenanceContext?: ContentProvenanceContext,
): boolean {
  return isExternalOrUnknownProvenance(provenanceStatus(provenanceContext?.provenance));
}

/** Allow risky browser effects only in a session verified as Main-owned managed mode. */
export function resolveAgentBrowserSessionEffectPolicy(
  input: AgentBrowserSessionEffectPolicyInput,
): AgentBrowserExternalAccessPolicyResult {
  const status = provenanceStatus(input.provenanceContext?.provenance);
  if (!isExternalOrUnknownProvenance(status)) {
    return { status, allowed: true, restricted: false };
  }
  if (input.sessionConnectionMode === "managed") {
    return { status, allowed: true, restricted: true };
  }
  return {
    status,
    allowed: false,
    restricted: true,
    reason: `Agent browser ${input.action} denied: external or unknown provenance may only use a verified managed browser session.`,
  };
}
