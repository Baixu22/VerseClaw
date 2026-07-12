// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP3

import { isToolAllowedByPolicyName } from "../../agents/tool-policy-match.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import { gateEngine } from "../gate-engine.js";
import type { GateCheckRequest, GateChecker, GateCheckerResult, GateType } from "../types.js";

type ToolPolicyShape = {
  allow?: string[];
  deny?: string[];
};

const CHECKER_ID = "tool-policy-checker";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function policyFrom(value: unknown): ToolPolicyShape | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const allow = stringArray(value.allow);
  const deny = stringArray(value.deny);
  if (!allow && !deny) {
    return undefined;
  }
  return {
    ...(allow ? { allow } : {}),
    ...(deny ? { deny } : {}),
  };
}

function requestPayloadRecord(request: GateCheckRequest): Record<string, unknown> | undefined {
  return isRecord(request.payload) ? request.payload : undefined;
}

function toolNameFrom(request: GateCheckRequest): string {
  const payload = requestPayloadRecord(request);
  const directToolName = payload?.toolName;
  if (typeof directToolName === "string") {
    return directToolName;
  }
  const toolRequest = isRecord(payload?.request) ? payload.request : undefined;
  return typeof toolRequest?.toolName === "string" ? toolRequest.toolName : "";
}

function toolPoliciesFrom(request: GateCheckRequest): ToolPolicyShape[] {
  const payload = requestPayloadRecord(request);
  const policies: ToolPolicyShape[] = [];
  const payloadPolicies = Array.isArray(payload?.policies) ? payload.policies : [];
  policies.push(...payloadPolicies.flatMap((value) => policyFrom(value) ?? []));
  const directPayloadPolicy = policyFrom(payload?.policy);
  if (directPayloadPolicy) {
    policies.push(directPayloadPolicy);
  }
  const directPolicy = policyFrom(payload?.toolPolicy);
  if (directPolicy) {
    policies.push(directPolicy);
  }
  const allowlistPolicy = policyFrom({ allow: payload?.allowlist, deny: payload?.denylist });
  if (allowlistPolicy) {
    policies.push(allowlistPolicy);
  }
  const toolRequest = isRecord(payload?.request) ? payload.request : undefined;
  const permissionContext = isRecord(toolRequest?.permissionContext)
    ? toolRequest.permissionContext
    : undefined;
  const requestPolicy = policyFrom(permissionContext?.toolPolicy);
  if (requestPolicy) {
    policies.push(requestPolicy);
  }
  return policies;
}

export class ToolPolicyChecker implements GateChecker {
  readonly checkerId = CHECKER_ID;
  readonly supportedGateTypes = ["pre_execution"] as const satisfies readonly GateType[];
  readonly gateTypes = this.supportedGateTypes;

  check(request: GateCheckRequest): GateCheckerResult {
    // [SPINE] This checker is diagnostic-only; legacy allowlist guards remain authoritative.
    const toolName = toolNameFrom(request);
    const normalizedToolName = normalizeToolName(toolName);
    const policies = toolPoliciesFrom(request);
    const passed = policies.every((policy) => isToolAllowedByPolicyName(toolName, policy));
    return {
      checkerId: this.checkerId,
      passed,
      message: passed
        ? "Tool policy diagnostic checker observed an allowed pre-execution request."
        : "Tool policy would deny this tool invocation.",
      metadata: {
        diagnosticOnly: true,
        legacyGuardUnaffected: true,
        legacyAllowlistUnaffected: true,
        supportedGateTypes: [...this.supportedGateTypes],
        toolName,
        normalizedToolName,
        policyPresent: policies.length > 0,
        policyCount: policies.length,
      },
    };
  }
}

let registered = false;

export function registerToolPolicyCheckerForRuntimeSpine(): void {
  if (registered) {
    return;
  }
  // [SPINE] Register once at runtime initialization; authority stays diagnostic_only.
  gateEngine.registerChecker(new ToolPolicyChecker());
  const config = gateEngine.getConfig();
  if (!config.mandatoryGateTypes.includes("pre_execution")) {
    gateEngine.configure({
      mandatoryGateTypes: [...config.mandatoryGateTypes, "pre_execution"],
    });
  }
  registered = true;
}
