import { randomBytes as nodeRandomBytes } from "node:crypto";
import type { AgentToolUpdateCallback } from "../../agents/runtime/index.js";
import {
  canonicalizeCapabilityDescriptor,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";

export const CAPABILITY_TRUSTED_CATALOG_SCHEMA_VERSION =
  "capability-trusted-catalog/v1" as const;

export type TrustedCapabilityExecutor = (
  input: unknown,
  context: TrustedCapabilityExecutionContext,
) => unknown;

export type TrustedCapabilityExecutionContext = {
  sessionId: string;
  capabilityId: string;
  toolCallId?: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback;
};

export type TrustedCapabilityRegistrationInput = {
  descriptor: CapabilityDescriptor;
  executor: TrustedCapabilityExecutor;
};

export type TrustedCapabilityCatalogOptions = {
  maxActiveLeases: number;
  maxLeaseTtlMs: number;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
};

export type TrustedCapabilityRegistrationSnapshot = {
  descriptor: CapabilityDescriptor;
};

export type TrustedCapabilityCatalogSnapshot = {
  schemaVersion: typeof CAPABILITY_TRUSTED_CATALOG_SCHEMA_VERSION;
  catalogEpoch: string;
  policyEpoch: string;
  registrations: TrustedCapabilityRegistrationSnapshot[];
  bindingCount: number;
  bindingFingerprint: string;
  snapshotHash: string;
};

export type CapabilityLeaseHandle = {
  issuedId: string;
};

export type CapabilityLeaseIssueRequest = {
  sessionId: string;
  capabilityId: string;
  ttlMs: number;
  grantedPermissions: readonly string[];
};

export type CapabilityLeaseIssueResult =
  | { ok: true; handle: CapabilityLeaseHandle; expiresAt: number }
  | { ok: false; failure: CapabilityLeaseFailure };

export type CapabilityLeaseVerificationRequest = {
  handle: CapabilityLeaseHandle;
  sessionId: string;
  capabilityId: string;
  revision: string;
  manifestHash: string;
  schemaHash?: string;
  requiredPermissions: readonly string[];
  /** Trusted runtime evidence; model-facing callers must not supply it. */
  expectedExecutorRegistrationId?: string;
};

export type CapabilityLeaseVerification =
  | {
      ok: true;
      capabilityId: string;
      executorRegistrationId: string;
      catalogEpoch: string;
      policyEpoch: string;
      expiresAt: number;
    }
  | { ok: false; failure: CapabilityLeaseFailure };

export type CapabilityLeaseFailureCode =
  | "invalid-lease-handle"
  | "lease-not-found"
  | "lease-revoked"
  | "lease-expired"
  | "session-mismatch"
  | "capability-mismatch"
  | "catalog-epoch-mismatch"
  | "policy-epoch-mismatch"
  | "registration-mismatch"
  | "revision-mismatch"
  | "manifest-hash-mismatch"
  | "schema-hash-mismatch"
  | "permission-mismatch"
  | "unknown-capability"
  | "permission-denied"
  | "invalid-session"
  | "invalid-lease-ttl"
  | "lease-capacity-exceeded"
  | "lease-id-collision";

export type CapabilityLeaseFailure = {
  code: CapabilityLeaseFailureCode;
  message: string;
};

export class TrustedCapabilityCatalogBuildError extends Error {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    super(diagnostics.join("; "));
    this.name = "TrustedCapabilityCatalogBuildError";
    this.diagnostics = diagnostics;
  }
}

export class CapabilityLeaseVerificationError extends Error {
  readonly failure: CapabilityLeaseFailure;

  constructor(failure: CapabilityLeaseFailure) {
    super(failure.message);
    this.name = "CapabilityLeaseVerificationError";
    this.failure = failure;
  }
}

type TrustedBinding = {
  descriptor: CapabilityDescriptor;
  executor: TrustedCapabilityExecutor;
  executorRegistrationId: string;
};

type CapabilityLeaseRecord = {
  issuedId: string;
  sessionId: string;
  capabilityId: string;
  revision: string;
  manifestHash: string;
  schemaHash?: string;
  catalogEpoch: string;
  policyEpoch: string;
  executorRegistrationId: string;
  grantedPermissions: string[];
  expiresAt: number;
  revoked: boolean;
};

const OPAQUE_ID_BYTES = 32;
const OPAQUE_ID_PATTERN = /^cap(?:cat|pol|reg|lease)_[A-Za-z0-9_-]{43}$/;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePermissions(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted(compareStrings);
}

function hasAllPermissions(granted: readonly string[], required: readonly string[]): boolean {
  const grantedSet = new Set(granted);
  return required.every((permission) => grantedSet.has(permission));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 512
  );
}

function failure(code: CapabilityLeaseFailureCode, message: string): CapabilityLeaseFailure {
  return { code, message };
}

function randomOpaqueId(
  prefix: "capcat" | "cappol" | "capreg" | "caplease",
  randomBytes: (size: number) => Uint8Array,
): string {
  const bytes = randomBytes(OPAQUE_ID_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== OPAQUE_ID_BYTES) {
    throw new Error("trusted capability random source must return exactly 32 bytes");
  }
  const encoded = Buffer.from(bytes).toString("base64url");
  const value = `${prefix}_${encoded}`;
  if (!OPAQUE_ID_PATTERN.test(value)) {
    throw new Error("trusted capability random source produced an invalid opaque id");
  }
  return value;
}

function validateOptions(options: TrustedCapabilityCatalogOptions): void {
  if (!isPositiveInteger(options.maxActiveLeases) || !isPositiveInteger(options.maxLeaseTtlMs)) {
    throw new TrustedCapabilityCatalogBuildError([
      "maxActiveLeases and maxLeaseTtlMs must be positive integers",
    ]);
  }
}

function buildBindings(
  registrations: readonly TrustedCapabilityRegistrationInput[],
  randomBytes: (size: number) => Uint8Array,
): Map<string, TrustedBinding> {
  const bindings = new Map<string, TrustedBinding>();
  const diagnostics: string[] = [];
  for (const [index, input] of registrations.entries()) {
    if (!input || typeof input !== "object" || typeof input.executor !== "function") {
      diagnostics.push(`registration[${index}] must provide a runtime executor function`);
      continue;
    }
    let descriptor: CapabilityDescriptor;
    try {
      descriptor = canonicalizeCapabilityDescriptor(input.descriptor);
    } catch (error) {
      diagnostics.push(
        `registration[${index}] descriptor is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (descriptor.kind !== "tool") {
      diagnostics.push(`${descriptor.capabilityId} is not a Tool descriptor`);
      continue;
    }
    if (!descriptor.schemaHash) {
      diagnostics.push(`${descriptor.capabilityId} must include schemaHash before registration`);
      continue;
    }
    if (bindings.has(descriptor.capabilityId)) {
      diagnostics.push(`duplicate trusted capability id: ${descriptor.capabilityId}`);
      continue;
    }
    let executorRegistrationId: string | undefined;
    for (let attempt = 0; attempt < 8 && !executorRegistrationId; attempt += 1) {
      const candidateId = randomOpaqueId("capreg", randomBytes);
      if (![...bindings.values()].some((binding) => binding.executorRegistrationId === candidateId)) {
        executorRegistrationId = candidateId;
      }
    }
    if (!executorRegistrationId) {
      diagnostics.push(`could not allocate a unique executor registration id for ${descriptor.capabilityId}`);
      continue;
    }
    bindings.set(descriptor.capabilityId, {
      descriptor,
      executor: input.executor,
      executorRegistrationId,
    });
  }
  if (diagnostics.length > 0) {
    throw new TrustedCapabilityCatalogBuildError(diagnostics);
  }
  return bindings;
}

/**
 * Runtime-owned trusted catalog. It is intentionally not a discovery catalog:
 * executor functions never appear in snapshots or lease handles.
 */
export class TrustedCapabilityCatalog {
  readonly #options: TrustedCapabilityCatalogOptions;
  #bindings: Map<string, TrustedBinding>;
  #leases = new Map<string, CapabilityLeaseRecord>();
  #catalogEpoch: string;
  #policyEpoch: string;

  private constructor(
    bindings: Map<string, TrustedBinding>,
    options: TrustedCapabilityCatalogOptions,
    catalogEpoch: string,
    policyEpoch: string,
  ) {
    this.#options = options;
    this.#bindings = bindings;
    this.#catalogEpoch = catalogEpoch;
    this.#policyEpoch = policyEpoch;
  }

  static coldStart(
    registrations: readonly TrustedCapabilityRegistrationInput[],
    options: TrustedCapabilityCatalogOptions,
  ): TrustedCapabilityCatalog {
    validateOptions(options);
    const random = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));
    const bindings = buildBindings(registrations, random);
    return new TrustedCapabilityCatalog(
      bindings,
      { ...options, randomBytes: random },
      randomOpaqueId("capcat", random),
      randomOpaqueId("cappol", random),
    );
  }

  /** Rebuilds all bindings atomically and invalidates the previous catalog epoch. */
  reload(registrations: readonly TrustedCapabilityRegistrationInput[]): TrustedCapabilityCatalogSnapshot {
    const random = this.#randomBytes();
    const bindings = buildBindings(registrations, random);
    this.#bindings = bindings;
    this.#catalogEpoch = randomOpaqueId("capcat", random);
    return this.snapshot();
  }

  /** Rotates policy without changing the trusted executor bindings. */
  rotatePolicy(): string {
    this.#policyEpoch = randomOpaqueId("cappol", this.#randomBytes());
    return this.#policyEpoch;
  }

  get catalogEpoch(): string {
    return this.#catalogEpoch;
  }

  get policyEpoch(): string {
    return this.#policyEpoch;
  }

  snapshot(): TrustedCapabilityCatalogSnapshot {
    const registrations = [...this.#bindings.values()]
      .map((binding) => ({ descriptor: cloneDescriptor(binding.descriptor) }))
      .toSorted((left, right) => compareStrings(left.descriptor.capabilityId, right.descriptor.capabilityId));
    const bindingFingerprint = hashCapabilityMetadata(
      [...this.#bindings.values()]
        .map((binding) => ({
          capabilityId: binding.descriptor.capabilityId,
          executorRegistrationId: binding.executorRegistrationId,
        }))
        .toSorted((left, right) => compareStrings(left.capabilityId, right.capabilityId)),
    );
    const snapshot = {
      schemaVersion: CAPABILITY_TRUSTED_CATALOG_SCHEMA_VERSION,
      catalogEpoch: this.#catalogEpoch,
      policyEpoch: this.#policyEpoch,
      registrations,
      bindingCount: registrations.length,
      bindingFingerprint,
    };
    return {
      ...snapshot,
      snapshotHash: hashCapabilityMetadata(snapshot),
    };
  }

  describe(capabilityId: string): CapabilityDescriptor | undefined {
    const binding = this.#bindings.get(capabilityId);
    return binding ? cloneDescriptor(binding.descriptor) : undefined;
  }

  issueLease(request: CapabilityLeaseIssueRequest): CapabilityLeaseIssueResult {
    if (!isValidSessionId(request.sessionId)) {
      return {
        ok: false,
        failure: failure("invalid-session", "a non-empty session id is required"),
      };
    }
    if (!isPositiveInteger(request.ttlMs) || request.ttlMs > this.#options.maxLeaseTtlMs) {
      return {
        ok: false,
        failure: failure("invalid-lease-ttl", "lease ttl exceeds the trusted catalog policy"),
      };
    }
    this.pruneLeases();
    const binding = this.#bindings.get(request.capabilityId);
    if (!binding) {
      return {
        ok: false,
        failure: failure("unknown-capability", "capability is not registered in the trusted catalog"),
      };
    }
    const grantedPermissions = normalizePermissions(request.grantedPermissions);
    const requiredPermissions = binding.descriptor.permissions ?? [];
    if (!hasAllPermissions(grantedPermissions, requiredPermissions)) {
      return {
        ok: false,
        failure: failure("permission-denied", "policy did not grant all capability permissions"),
      };
    }
    const activeLeaseCount = [...this.#leases.values()].filter(
      (lease) =>
        !lease.revoked &&
        lease.expiresAt > this.#now() &&
        lease.catalogEpoch === this.#catalogEpoch &&
        lease.policyEpoch === this.#policyEpoch,
    ).length;
    if (activeLeaseCount >= this.#options.maxActiveLeases) {
      return {
        ok: false,
        failure: failure("lease-capacity-exceeded", "trusted catalog lease capacity is exhausted"),
      };
    }
    let issuedId = randomOpaqueId("caplease", this.#randomBytes());
    for (let attempt = 0; attempt < 8 && this.#leases.has(issuedId); attempt += 1) {
      issuedId = randomOpaqueId("caplease", this.#randomBytes());
    }
    if (this.#leases.has(issuedId)) {
      return {
        ok: false,
        failure: failure("lease-id-collision", "trusted catalog could not issue a unique lease id"),
      };
    }
    const expiresAt = this.#now() + request.ttlMs;
    this.#leases.set(issuedId, {
      issuedId,
      sessionId: request.sessionId,
      capabilityId: binding.descriptor.capabilityId,
      revision: binding.descriptor.revision,
      manifestHash: binding.descriptor.manifestHash,
      schemaHash: binding.descriptor.schemaHash,
      catalogEpoch: this.#catalogEpoch,
      policyEpoch: this.#policyEpoch,
      executorRegistrationId: binding.executorRegistrationId,
      grantedPermissions,
      expiresAt,
      revoked: false,
    });
    return { ok: true, handle: { issuedId }, expiresAt };
  }

  revokeLease(handle: CapabilityLeaseHandle): boolean {
    if (!isLeaseHandle(handle)) {
      return false;
    }
    const lease = this.#leases.get(handle.issuedId);
    if (!lease) {
      return false;
    }
    lease.revoked = true;
    return true;
  }

  revokeSessionLeases(sessionId: string): number {
    let revoked = 0;
    for (const lease of this.#leases.values()) {
      if (lease.sessionId === sessionId && !lease.revoked) {
        lease.revoked = true;
        revoked += 1;
      }
    }
    return revoked;
  }

  pruneLeases(): number {
    const now = this.#now();
    let removed = 0;
    for (const [issuedId, lease] of this.#leases) {
      if (lease.revoked || lease.expiresAt <= now) {
        this.#leases.delete(issuedId);
        removed += 1;
      }
    }
    return removed;
  }

  verifyLease(request: CapabilityLeaseVerificationRequest): CapabilityLeaseVerification {
    if (!isLeaseHandle(request.handle)) {
      return { ok: false, failure: failure("invalid-lease-handle", "lease handle is not opaque and well formed") };
    }
    const lease = this.#leases.get(request.handle.issuedId);
    if (!lease) {
      return { ok: false, failure: failure("lease-not-found", "lease is unknown to this trusted catalog") };
    }
    if (lease.revoked) {
      return { ok: false, failure: failure("lease-revoked", "lease was explicitly revoked") };
    }
    if (lease.expiresAt <= this.#now()) {
      return { ok: false, failure: failure("lease-expired", "lease has expired") };
    }
    if (lease.sessionId !== request.sessionId) {
      return { ok: false, failure: failure("session-mismatch", "lease is bound to another session") };
    }
    if (lease.capabilityId !== request.capabilityId) {
      return { ok: false, failure: failure("capability-mismatch", "lease capability id does not match invocation") };
    }
    if (lease.catalogEpoch !== this.#catalogEpoch) {
      return { ok: false, failure: failure("catalog-epoch-mismatch", "lease belongs to a previous catalog epoch") };
    }
    if (lease.policyEpoch !== this.#policyEpoch) {
      return { ok: false, failure: failure("policy-epoch-mismatch", "lease belongs to a previous policy epoch") };
    }
    const binding = this.#bindings.get(lease.capabilityId);
    if (!binding || binding.executorRegistrationId !== lease.executorRegistrationId) {
      return { ok: false, failure: failure("registration-mismatch", "executor registration is no longer trusted") };
    }
    if (request.expectedExecutorRegistrationId && request.expectedExecutorRegistrationId !== lease.executorRegistrationId) {
      return { ok: false, failure: failure("registration-mismatch", "trusted executor registration evidence mismatched") };
    }
    if (lease.revision !== request.revision) {
      return { ok: false, failure: failure("revision-mismatch", "lease revision does not match invocation") };
    }
    if (lease.manifestHash !== request.manifestHash) {
      return { ok: false, failure: failure("manifest-hash-mismatch", "lease manifest hash does not match invocation") };
    }
    if (lease.schemaHash !== request.schemaHash) {
      return { ok: false, failure: failure("schema-hash-mismatch", "lease schema hash does not match invocation") };
    }
    if (!hasAllPermissions(lease.grantedPermissions, normalizePermissions(request.requiredPermissions))) {
      return { ok: false, failure: failure("permission-mismatch", "lease does not carry required permissions") };
    }
    return {
      ok: true,
      capabilityId: lease.capabilityId,
      executorRegistrationId: lease.executorRegistrationId,
      catalogEpoch: lease.catalogEpoch,
      policyEpoch: lease.policyEpoch,
      expiresAt: lease.expiresAt,
    };
  }

  async invokeLease(params: {
    verification: CapabilityLeaseVerificationRequest;
    input: unknown;
    context: Omit<TrustedCapabilityExecutionContext, "sessionId" | "capabilityId">;
  }): Promise<unknown> {
    const verified = this.verifyLease(params.verification);
    if (!verified.ok) {
      throw new CapabilityLeaseVerificationError(verified.failure);
    }
    const binding = this.#bindings.get(verified.capabilityId);
    if (!binding || binding.executorRegistrationId !== verified.executorRegistrationId) {
      throw new CapabilityLeaseVerificationError(
        failure("registration-mismatch", "executor registration disappeared before invocation"),
      );
    }
    return binding.executor(params.input, {
      ...params.context,
      sessionId: params.verification.sessionId,
      capabilityId: verified.capabilityId,
    });
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #randomBytes(): (size: number) => Uint8Array {
    return this.#options.randomBytes ?? ((size: number) => nodeRandomBytes(size));
  }
}

function isLeaseHandle(value: unknown): value is CapabilityLeaseHandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const issuedId = (value as { issuedId?: unknown }).issuedId;
  return typeof issuedId === "string" && OPAQUE_ID_PATTERN.test(issuedId);
}

function cloneDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
  return {
    ...descriptor,
    triggerKeywords: [...descriptor.triggerKeywords],
    source: { ...descriptor.source },
    ...(descriptor.dependsOn ? { dependsOn: [...descriptor.dependsOn] } : {}),
    ...(descriptor.permissions ? { permissions: [...descriptor.permissions] } : {}),
    ...(descriptor.executionTopologies ? { executionTopologies: [...descriptor.executionTopologies] } : {}),
  };
}
