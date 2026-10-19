/**
 * NET-C (TF-0440): provider endpoint health gate.
 *
 * This module wires exactly ONE circuit breaker - the existing
 * `RateCircuitBreaker` from `rate-circuit-breaker.ts` - into the real provider
 * outbound boundary (`buildGuardedModelFetch` in `provider-transport-fetch.ts`).
 * There is deliberately no second provider breaker: the generic
 * `CircuitBreaker` in `infra/circuit-breaker.ts` keeps serving non-provider
 * call sites.
 *
 * Identity: one breaker per quota group - the normalized endpoint origin plus
 * the non-exportable account discriminator already resolved for the outbound
 * concurrency budget (`resolveProviderOutboundQuotaGroup`). The discriminator
 * is a truncated SHA-256 of the resolved credential computed in process
 * memory only: it is never the credential, never logged, never written into
 * evidence, and never included in exported snapshots.
 *
 * Counting policy: only transport errors, timeouts, HTTP 429 and HTTP 5xx
 * count as failures. Auth cooldown, model-fallback skips and outbound budget
 * refusals never reach this gate (budget admission happens first and a refusal
 * throws before the health gate is consulted), so they cannot be
 * double-counted. Mid-stream body failures are owned by stream-failure
 * recovery (TF-0441) and are not counted here.
 *
 * Deliberate boundaries:
 * - Opt-in only. With nothing configured the gate stays inert (one environment
 *   lookup) and every request is admitted; no product default changes.
 * - Open fails fast with a typed `ProviderEndpointCircuitOpenError` before any
 *   provider request is sent; half-open admits exactly one probe.
 * - In-memory only; no distributed or persisted breaker state.
 */
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ProviderOutboundQuotaGroup } from "./provider-outbound-budget.js";
import { RateCircuitBreaker, type RateBreakerState } from "./rate-circuit-breaker.js";

const log = createSubsystemLogger("provider-endpoint-health");

/** Environment variable name for the opt-in endpoint breaker. */
export const PROVIDER_ENDPOINT_HEALTH_ENV = {
  breaker: "OPENCLAW_PROVIDER_ENDPOINT_BREAKER",
} as const;

/** Fixture parameters used when the flag is enabled without explicit numbers. */
export const PROVIDER_ENDPOINT_HEALTH_DEFAULT_LIMITS = {
  windowMs: 30_000,
  maxFailuresPerWindow: 5,
  cooldownMs: 15_000,
} as const;

/** Breaker configuration. `undefined` keeps the gate inert. */
export type ProviderEndpointHealthConfig = {
  windowMs: number;
  maxFailuresPerWindow: number;
  cooldownMs: number;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
};

/** Outcome of one admitted physical attempt. */
export type ProviderEndpointOutcome = "success" | "failure" | "neutral";

/** Snapshot for diagnostics: never contains the credential or account discriminator. */
export type ProviderEndpointHealthSnapshot = {
  endpoint: string;
  provider: string;
  api: string;
  state: RateBreakerState;
  failuresInWindow: number;
  trips: number;
  halfOpenProbeInFlight: boolean;
  openedAt?: number;
};

export type ProviderEndpointTicket = {
  /** Records the physical outcome once; later calls are ignored. */
  record: (outcome: ProviderEndpointOutcome) => void;
  getSnapshot: () => ProviderEndpointHealthSnapshot;
};

export type ProviderEndpointAdmission =
  | { ok: true; endpoint: string; ticket: ProviderEndpointTicket }
  | {
      ok: false;
      endpoint: string;
      retryAfterMs: number | undefined;
      snapshot: ProviderEndpointHealthSnapshot;
    };

/** Typed refusal: the endpoint is open; nothing was sent to the provider. */
export class ProviderEndpointCircuitOpenError extends Error {
  readonly code = "E_PROVIDER_ENDPOINT_CIRCUIT_OPEN";
  readonly endpoint: string;
  readonly retryAfterMs: number | undefined;
  readonly snapshot: ProviderEndpointHealthSnapshot;

  constructor(params: {
    model: { provider: string; id: string };
    endpoint: string;
    retryAfterMs: number | undefined;
    snapshot: ProviderEndpointHealthSnapshot;
  }) {
    super(
      `${params.model.provider}/${params.model.id}: provider endpoint ${params.endpoint} is ` +
        `temporarily unavailable (circuit open, state=${params.snapshot.state}, ` +
        `trips=${params.snapshot.trips}); the request was not sent` +
        (params.retryAfterMs === undefined
          ? ""
          : ` (retryAfterMs=${Math.max(0, Math.round(params.retryAfterMs))})`),
    );
    this.name = "ProviderEndpointCircuitOpenError";
    this.endpoint = params.endpoint;
    this.retryAfterMs = params.retryAfterMs;
    this.snapshot = params.snapshot;
  }
}

type ManagedEndpoint = {
  groupId: string;
  endpoint: string;
  provider: string;
  api: string;
  config: ProviderEndpointHealthConfig;
  breaker: RateCircuitBreaker;
};

let endpoints = new Map<string, ManagedEndpoint>();
let config: ProviderEndpointHealthConfig | undefined;
let envConfigLoaded = false;

/** Parses a positive integer environment value; unusable values are ignored. */
function readPositiveEnvInt(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return undefined;
  }
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isDisabledFlag(raw: string): boolean {
  return raw === "" || raw === "0" || raw === "false" || raw === "off" || raw === "no";
}

/**
 * Parses the opt-in flag; `undefined` keeps the gate inert.
 * Accepted values: `1`/`true`/`on` (fixture defaults) or
 * `windowMs:maxFailuresPerWindow:cooldownMs`.
 */
export function readProviderEndpointHealthConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderEndpointHealthConfig | undefined {
  const raw = env[PROVIDER_ENDPOINT_HEALTH_ENV.breaker];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim().toLowerCase();
  if (isDisabledFlag(trimmed)) {
    return undefined;
  }
  if (trimmed === "1" || trimmed === "true" || trimmed === "on") {
    return { ...PROVIDER_ENDPOINT_HEALTH_DEFAULT_LIMITS };
  }
  const parts = trimmed.split(":");
  if (parts.length !== 3) {
    return undefined;
  }
  const [windowMs, maxFailuresPerWindow, cooldownMs] = parts.map((part) =>
    readPositiveEnvInt(part),
  );
  if (
    windowMs === undefined ||
    maxFailuresPerWindow === undefined ||
    cooldownMs === undefined
  ) {
    return undefined;
  }
  return { windowMs, maxFailuresPerWindow, cooldownMs };
}

/** Replaces the breaker configuration; `undefined` keeps the gate inert. */
export function configureProviderEndpointHealth(
  next: ProviderEndpointHealthConfig | undefined,
): void {
  endpoints = new Map();
  config = next;
  envConfigLoaded = true;
}

/** Restores the environment-derived configuration and drops every breaker (test helper). */
export function resetProviderEndpointHealth(): void {
  endpoints = new Map();
  config = undefined;
  envConfigLoaded = false;
}

function activeConfig(): ProviderEndpointHealthConfig | undefined {
  if (!envConfigLoaded) {
    envConfigLoaded = true;
    config = readProviderEndpointHealthConfigFromEnv();
  }
  return config;
}

/** Classifies one served HTTP response. Only 429 and 5xx count as failures. */
export function classifyProviderEndpointResponse(status: number): ProviderEndpointOutcome {
  if (status === 429 || status >= 500) {
    return "failure";
  }
  if (status >= 200 && status < 400) {
    return "success";
  }
  // Other 4xx responses prove the transport worked; auth/format/billing
  // cooldowns and fallback classification own their handling.
  return "neutral";
}

function snapshotOf(managed: ManagedEndpoint): ProviderEndpointHealthSnapshot {
  const raw = managed.breaker.getSnapshot();
  return {
    endpoint: managed.endpoint,
    provider: managed.provider,
    api: managed.api,
    state: raw.state,
    failuresInWindow: raw.failuresInWindow,
    trips: raw.trips,
    halfOpenProbeInFlight: raw.halfOpenProbeInFlight,
    ...(raw.openedAt === undefined ? {} : { openedAt: raw.openedAt }),
  };
}

function managedEndpoint(
  group: ProviderOutboundQuotaGroup,
  active: ProviderEndpointHealthConfig,
): ManagedEndpoint {
  const existing = endpoints.get(group.groupId);
  if (existing) {
    return existing;
  }
  const created: ManagedEndpoint = {
    // The group id embeds the non-exportable account discriminator; it stays a
    // map key and never leaves this module.
    groupId: group.groupId,
    endpoint: group.endpoint,
    provider: group.provider,
    api: group.api,
    config: active,
    breaker: new RateCircuitBreaker({
      windowMs: active.windowMs,
      maxFailuresPerWindow: active.maxFailuresPerWindow,
      cooldownMs: active.cooldownMs,
      ...(active.now === undefined ? {} : { now: active.now }),
    }),
  };
  endpoints.set(created.groupId, created);
  return created;
}

function remainingCooldownMs(
  managed: ManagedEndpoint,
  snapshot: ProviderEndpointHealthSnapshot,
): number | undefined {
  if (snapshot.openedAt === undefined) {
    return undefined;
  }
  const now = managed.config.now ?? Date.now;
  return Math.max(0, snapshot.openedAt + managed.config.cooldownMs - now());
}

/**
 * Requests admission for one physical provider request.
 *
 * When nothing is configured this is a single map-free check that admits the
 * request, so the boundary stays inert until an operator opts in.
 */
export function admitProviderEndpointRequest(
  group: ProviderOutboundQuotaGroup,
): ProviderEndpointAdmission {
  const active = activeConfig();
  if (!active) {
    return {
      ok: true,
      endpoint: group.endpoint,
      ticket: {
        record: () => undefined,
        getSnapshot: () => ({
          endpoint: group.endpoint,
          provider: group.provider,
          api: group.api,
          state: "closed",
          failuresInWindow: 0,
          trips: 0,
          halfOpenProbeInFlight: false,
        }),
      },
    };
  }
  const managed = managedEndpoint(group, active);
  if (!managed.breaker.allowsRequest()) {
    const snapshot = snapshotOf(managed);
    const retryAfterMs = remainingCooldownMs(managed, snapshot);
    // Diagnostics deliberately omit the account discriminator and the group id.
    log.warn(
      `[provider-endpoint-health] open endpoint=${group.endpoint} providers=${group.provider} ` +
        `state=${snapshot.state} trips=${snapshot.trips} retryAfterMs=${retryAfterMs ?? "unknown"}`,
    );
    return { ok: false, endpoint: group.endpoint, retryAfterMs, snapshot };
  }
  let settled = false;
  return {
    ok: true,
    endpoint: group.endpoint,
    ticket: {
      record: (outcome) => {
        if (settled) {
          return;
        }
        settled = true;
        // A neutral outcome (for example a 401 that auth cooldown owns) is not
        // a failure; a served response also proves the transport is reachable,
        // so a neutral half-open probe closes the breaker like a success.
        managed.breaker.record(outcome !== "failure");
      },
      getSnapshot: () => snapshotOf(managed),
    },
  };
}

/** Snapshots of every gated endpoint; inerts groups never allocate one. */
export function providerEndpointHealthSnapshots(): ProviderEndpointHealthSnapshot[] {
  return [...endpoints.values()]
    .map(snapshotOf)
    .sort((a, b) =>
      `${a.endpoint}|${a.provider}|${a.api}`.localeCompare(`${b.endpoint}|${b.provider}|${b.api}`),
    );
}
