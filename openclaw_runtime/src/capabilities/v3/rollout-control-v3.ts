import { hashCapabilityMetadata } from "./capability-descriptor.js";

export const CAPABILITY_REGISTRY_V3_ROLLOUT_DECISION_SCHEMA_VERSION =
  "capability-registry-v3-rollout-decision/v1" as const;

export type CapabilityRegistryV3RolloutMode = "off" | "shadow" | "opt-in" | "canary";

export type CapabilityRegistryV3RolloutTarget = {
  providerId: string;
  modelId: string;
  workflowNamespace: string;
};

export type CapabilityRegistryV3RolloutPolicy = {
  /** Explicit opt-in. Omission is equivalent to false. */
  enabled?: boolean;
  mode: CapabilityRegistryV3RolloutMode;
  killSwitch?: boolean;
  allowlist: readonly CapabilityRegistryV3RolloutTarget[];
  /** Integer percentage from 0 through 100. */
  canaryPercent: number;
  /** Stable non-secret input used only for deterministic cohort assignment. */
  cohortSalt: string;
};

export type CapabilityRegistryV3RolloutCohort =
  | "none"
  | "shadow"
  | "control"
  | "treatment";

export type CapabilityRegistryV3RolloutReason =
  | "disabled"
  | "off"
  | "kill-switch"
  | "invalid-request"
  | "invalid-target"
  | "not-allowlisted"
  | "shadow-only"
  | "opt-in-required"
  | "explicit-opt-in"
  | "canary-control"
  | "canary-treatment";

export type CapabilityRegistryV3RolloutDecision = {
  schemaVersion: typeof CAPABILITY_REGISTRY_V3_ROLLOUT_DECISION_SCHEMA_VERSION;
  requestId: string;
  target?: CapabilityRegistryV3RolloutTarget;
  mode: CapabilityRegistryV3RolloutMode;
  policyHash: string;
  observe: boolean;
  activate: boolean;
  cohort: CapabilityRegistryV3RolloutCohort;
  reason: CapabilityRegistryV3RolloutReason;
  bucketBasisPoints?: number;
};

export type CapabilityRegistryV3RolloutRequest = {
  requestId: string;
  target: CapabilityRegistryV3RolloutTarget;
  explicitOptIn?: boolean;
};

export type CapabilityRegistryV3RolloutPolicyErrorCode =
  | "invalid-mode"
  | "invalid-canary-percent"
  | "invalid-cohort-salt"
  | "invalid-allowlist"
  | "duplicate-allowlist-target";

export class CapabilityRegistryV3RolloutPolicyError extends Error {
  constructor(readonly code: CapabilityRegistryV3RolloutPolicyErrorCode) {
    super(`Capability Registry V3 rollout policy is invalid: ${code}`);
    this.name = "CapabilityRegistryV3RolloutPolicyError";
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const WORKFLOW_NAMESPACE_PATTERN =
  /^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,7}$/;
const ROLLOUT_MODES = new Set<CapabilityRegistryV3RolloutMode>([
  "off",
  "shadow",
  "opt-in",
  "canary",
]);
const MAX_ALLOWLIST_ENTRIES = 256;
const MAX_TARGET_VALUE_LENGTH = 128;

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function validTargetValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TARGET_VALUE_LENGTH &&
    value.trim() === value &&
    !value.includes("*") &&
    !containsControlCharacters(value)
  );
}

export function isCapabilityRegistryV3RolloutTarget(
  value: unknown,
): value is CapabilityRegistryV3RolloutTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    Object.keys(target).every((key) =>
      ["providerId", "modelId", "workflowNamespace"].includes(key),
    ) &&
    validTargetValue(target.providerId) &&
    validTargetValue(target.modelId) &&
    typeof target.workflowNamespace === "string" &&
    WORKFLOW_NAMESPACE_PATTERN.test(target.workflowNamespace)
  );
}

function cloneTarget(
  target: CapabilityRegistryV3RolloutTarget,
): CapabilityRegistryV3RolloutTarget {
  return {
    providerId: target.providerId,
    modelId: target.modelId,
    workflowNamespace: target.workflowNamespace,
  };
}

function targetKey(target: CapabilityRegistryV3RolloutTarget): string {
  return `${target.providerId}\u0000${target.modelId}\u0000${target.workflowNamespace}`;
}

function decision(params: {
  request: unknown;
  mode: CapabilityRegistryV3RolloutMode;
  policyHash: string;
  observe?: boolean;
  activate?: boolean;
  cohort?: CapabilityRegistryV3RolloutCohort;
  reason: CapabilityRegistryV3RolloutReason;
  bucketBasisPoints?: number;
}): CapabilityRegistryV3RolloutDecision {
  const requestRecord =
    params.request && typeof params.request === "object" && !Array.isArray(params.request)
      ? (params.request as Record<string, unknown>)
      : undefined;
  const requestId = typeof requestRecord?.requestId === "string" ? requestRecord.requestId : "invalid";
  const target = requestRecord?.target;
  return {
    schemaVersion: CAPABILITY_REGISTRY_V3_ROLLOUT_DECISION_SCHEMA_VERSION,
    requestId,
    ...(isCapabilityRegistryV3RolloutTarget(target)
      ? { target: cloneTarget(target) }
      : {}),
    mode: params.mode,
    policyHash: params.policyHash,
    observe: params.observe ?? false,
    activate: params.activate ?? false,
    cohort: params.cohort ?? "none",
    reason: params.reason,
    ...(params.bucketBasisPoints !== undefined
      ? { bucketBasisPoints: params.bucketBasisPoints }
      : {}),
  };
}

function validatePolicy(
  policy: CapabilityRegistryV3RolloutPolicy,
): CapabilityRegistryV3RolloutTarget[] {
  if (!ROLLOUT_MODES.has(policy.mode)) {
    throw new CapabilityRegistryV3RolloutPolicyError("invalid-mode");
  }
  if (
    !Number.isInteger(policy.canaryPercent) ||
    policy.canaryPercent < 0 ||
    policy.canaryPercent > 100
  ) {
    throw new CapabilityRegistryV3RolloutPolicyError("invalid-canary-percent");
  }
  if (
    typeof policy.cohortSalt !== "string" ||
    policy.cohortSalt.length < 1 ||
    policy.cohortSalt.length > 128 ||
    policy.cohortSalt.trim() !== policy.cohortSalt
  ) {
    throw new CapabilityRegistryV3RolloutPolicyError("invalid-cohort-salt");
  }
  if (
    !Array.isArray(policy.allowlist) ||
    policy.allowlist.length > MAX_ALLOWLIST_ENTRIES ||
    policy.allowlist.some((target) => !isCapabilityRegistryV3RolloutTarget(target))
  ) {
    throw new CapabilityRegistryV3RolloutPolicyError("invalid-allowlist");
  }
  const allowlist = policy.allowlist.map(cloneTarget);
  if (new Set(allowlist.map(targetKey)).size !== allowlist.length) {
    throw new CapabilityRegistryV3RolloutPolicyError("duplicate-allowlist-target");
  }
  return allowlist;
}

function cohortBucketBasisPoints(params: {
  requestId: string;
  target: CapabilityRegistryV3RolloutTarget;
  cohortSalt: string;
}): number {
  const hash = hashCapabilityMetadata({
    requestId: params.requestId,
    target: params.target,
    cohortSalt: params.cohortSalt,
  });
  return Number.parseInt(hash.slice("sha256:".length, "sha256:".length + 8), 16) % 10_000;
}

/** Pure, caller-owned rollout gate. It observes policy but cannot execute a capability. */
export class CapabilityRegistryV3RolloutController {
  readonly #allowlist: ReadonlySet<string>;
  readonly #policy: Readonly<CapabilityRegistryV3RolloutPolicy>;
  readonly #policyHash: string;

  constructor(policy: CapabilityRegistryV3RolloutPolicy) {
    const allowlist = validatePolicy(policy).toSorted((left, right) =>
      targetKey(left) < targetKey(right) ? -1 : targetKey(left) > targetKey(right) ? 1 : 0,
    );
    this.#policy = Object.freeze({
      enabled: policy.enabled === true,
      mode: policy.mode,
      killSwitch: policy.killSwitch === true,
      allowlist: Object.freeze(allowlist.map((target) => Object.freeze(target))),
      canaryPercent: policy.canaryPercent,
      cohortSalt: policy.cohortSalt,
    });
    this.#allowlist = new Set(allowlist.map(targetKey));
    this.#policyHash = hashCapabilityMetadata(this.#policy);
  }

  policyHash(): string {
    return this.#policyHash;
  }

  decide(request: CapabilityRegistryV3RolloutRequest): CapabilityRegistryV3RolloutDecision {
    const requestRecord =
      request && typeof request === "object" && !Array.isArray(request)
        ? (request as Record<string, unknown>)
        : undefined;
    if (
      !requestRecord ||
      typeof requestRecord.requestId !== "string" ||
      !REQUEST_ID_PATTERN.test(requestRecord.requestId)
    ) {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        reason: "invalid-request",
      });
    }
    request = requestRecord as unknown as CapabilityRegistryV3RolloutRequest;
    if (!isCapabilityRegistryV3RolloutTarget(request.target)) {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        reason: "invalid-target",
      });
    }
    if (this.#policy.enabled !== true) {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        reason: "disabled",
      });
    }
    if (this.#policy.killSwitch === true) {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        reason: "kill-switch",
      });
    }
    if (this.#policy.mode === "off") {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        reason: "off",
      });
    }
    if (!this.#allowlist.has(targetKey(request.target))) {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        reason: "not-allowlisted",
      });
    }
    if (this.#policy.mode === "shadow") {
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        observe: true,
        cohort: "shadow",
        reason: "shadow-only",
      });
    }
    if (this.#policy.mode === "opt-in") {
      const activate = request.explicitOptIn === true;
      return decision({
        request,
        mode: this.#policy.mode,
        policyHash: this.#policyHash,
        observe: true,
        activate,
        cohort: activate ? "treatment" : "control",
        reason: activate ? "explicit-opt-in" : "opt-in-required",
      });
    }

    const bucketBasisPoints = cohortBucketBasisPoints({
      requestId: request.requestId,
      target: request.target,
      cohortSalt: this.#policy.cohortSalt,
    });
    const activate = bucketBasisPoints < this.#policy.canaryPercent * 100;
    return decision({
      request,
      mode: this.#policy.mode,
      policyHash: this.#policyHash,
      observe: true,
      activate,
      cohort: activate ? "treatment" : "control",
      reason: activate ? "canary-treatment" : "canary-control",
      bucketBasisPoints,
    });
  }
}
