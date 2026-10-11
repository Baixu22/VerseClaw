/**
 * Shared outbound model-request concurrency budget (issue #154, second half).
 *
 * The gateway already bounds *inbound* request admission (`http-endpoint-budget.ts`) and
 * per-session command lanes (`process/command-queue.ts`). Neither of those bounds how many
 * physical provider requests this process has in flight: lanes count agent turns, and one
 * turn can issue several model calls (main turn, compaction/auxiliary call, retry).
 *
 * This module adds one small semaphore per **quota group** at the real outbound boundary —
 * `buildGuardedModelFetch` in `provider-transport-fetch.ts`, which every chat/subagent/cron
 * model transport goes through. A quota group is derived from
 *   (a) the normalized endpoint identity of the model's `baseUrl` origin, and
 *   (b) a non-exportable account discriminator,
 * so two provider entries that point at the same endpoint with the same credential share one
 * budget even when their model names differ, while two different credentials (or two
 * different endpoints) never block each other. Operators can map several derived groups onto
 * one canonical group with `quotaGroupAliases`.
 *
 * Deliberate boundaries:
 * - **No default limit.** With nothing configured the boundary is a single map lookup and the
 *   request proceeds ungated; the issue explicitly forbids freezing an example concurrency
 *   number as a product default. Operators opt in through the environment (below) or through
 *   `configureProviderOutboundBudget()`.
 * - The account discriminator is a truncated SHA-256 of the resolved credential, computed in
 *   process memory. It is never the credential, never sent to a provider, never logged and
 *   never written into evidence files; it exists only as a map key so different accounts on a
 *   shared endpoint cannot silently share (or silently bypass) each other's budget.
 * - Embedding adapters, media-understanding/image providers and the local provider sidecar
 *   startup are **not** gated here. See `PROVIDER_OUTBOUND_COVERAGE`.
 */
import { createHash } from "node:crypto";
import {
  createBoundedConcurrencyGate,
  type BoundedConcurrencyGate,
  type BoundedConcurrencyRejection,
  type BoundedConcurrencyStats,
} from "../infra/bounded-concurrency.js";
import type { Model } from "../llm/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ResolvedProviderRequestConfig } from "./provider-request-config.js";

const log = createSubsystemLogger("provider-outbound-budget");

/** Environment variable names for the opt-in budget. */
export const PROVIDER_OUTBOUND_ENV = {
  maxConcurrent: "OPENCLAW_PROVIDER_OUTBOUND_MAX_CONCURRENT",
  maxQueue: "OPENCLAW_PROVIDER_OUTBOUND_MAX_QUEUE",
  queueTimeoutMs: "OPENCLAW_PROVIDER_OUTBOUND_QUEUE_TIMEOUT_MS",
  quotaGroupAliases: "OPENCLAW_PROVIDER_OUTBOUND_QUOTA_ALIASES",
} as const;

/** Limits applied to one quota group. */
export type ProviderOutboundQuotaLimits = {
  /** Maximum physical requests in flight for the group. Required to activate the budget. */
  maxConcurrent: number;
  /** Maximum waiters. Defaults to `maxConcurrent` (bounded queue, not unbounded). */
  maxQueue?: number;
  /** Queued-wait deadline in milliseconds. Defaults to 30000. */
  queueTimeoutMs?: number;
};

/** Identity of one quota group. `groupId` is safe to use as an in-memory key only. */
export type ProviderOutboundQuotaGroup = {
  /** `${endpoint}#${account}` — process-local, never persisted. */
  groupId: string;
  /** Normalized `scheme://host[:port]` of the model's configured base URL origin. */
  endpoint: string;
  /** Non-exportable account discriminator (see the module header). */
  account: string;
  provider: string;
  api: string;
};

/** Slot handed to an admitted caller. */
export type ProviderOutboundSlot = {
  groupId: string;
  /** False when no limit is configured and the boundary is inert. */
  limited: boolean;
  waitedMs: number;
  /** Releases the slot once; returns false if already released. */
  release(): boolean;
};

/** Admission outcome at the outbound boundary. */
export type ProviderOutboundAdmission =
  | { ok: true; slot: ProviderOutboundSlot }
  | {
      ok: false;
      reason: BoundedConcurrencyRejection;
      groupId: string;
      waitedMs: number;
      snapshot: Pick<
        BoundedConcurrencyStats,
        "active" | "queued" | "maxConcurrent" | "maxQueue" | "queueTimeoutMs"
      >;
    };

/** Per-group counters for diagnostics and tests. */
export type ProviderOutboundGroupStats = BoundedConcurrencyStats & {
  groupId: string;
  endpoint: string;
  account: string;
  providers: string[];
};

/**
 * Typed failure raised at the outbound boundary when the budget refuses a request.
 *
 * The message deliberately contains the word `overloaded` so the existing
 * `classifyFailoverReason()` text classifier maps it to the `overloaded` failover reason and the
 * agent runner applies its overload backoff/profile rotation instead of surfacing an opaque
 * unknown error. A retry re-enters admission, it does not inherit the previous slot.
 */
export class ProviderOutboundOverloadedError extends Error {
  readonly code = "E_PROVIDER_OUTBOUND_OVERLOADED";
  readonly reason: BoundedConcurrencyRejection;
  readonly endpoint: string;
  readonly waitedMs: number;
  readonly active: number;
  readonly queued: number;
  readonly maxConcurrent: number;
  readonly maxQueue: number;

  constructor(params: {
    model: Pick<Model, "provider" | "api" | "id">;
    reason: BoundedConcurrencyRejection;
    endpoint: string;
    waitedMs: number;
    snapshot: Pick<
      BoundedConcurrencyStats,
      "active" | "queued" | "maxConcurrent" | "maxQueue" | "queueTimeoutMs"
    >;
  }) {
    super(
      `${params.model.provider}/${params.model.id}: outbound model concurrency budget is ` +
        `overloaded (reason=${params.reason}) for endpoint ${params.endpoint}; the request was not ` +
        `sent (active=${params.snapshot.active} limit=${params.snapshot.maxConcurrent} ` +
        `queued=${params.snapshot.queued} maxQueue=${params.snapshot.maxQueue} ` +
        `waitedMs=${Math.round(params.waitedMs)})`,
    );
    this.name = "ProviderOutboundOverloadedError";
    this.reason = params.reason;
    this.endpoint = params.endpoint;
    this.waitedMs = params.waitedMs;
    this.active = params.snapshot.active;
    this.queued = params.snapshot.queued;
    this.maxConcurrent = params.snapshot.maxConcurrent;
    this.maxQueue = params.snapshot.maxQueue;
  }
}

/** Budget configuration. `undefined` disables every limit (the default). */
export type ProviderOutboundBudgetConfig = {
  /** Limits applied to every derived group without a per-group override. */
  limits?: ProviderOutboundQuotaLimits;
  /** Per-group overrides keyed by derived group id. */
  quotas?: Record<string, ProviderOutboundQuotaLimits>;
  /** Explicit mapping: derived group id (or alias) to the canonical group id. */
  quotaGroupAliases?: Record<string, string>;
  /** Injectable clock, used by tests to drive queue deadlines deterministically. */
  now?: () => number;
};

/** Coverage of the outbound boundary, so "global budget" is never implied. */
export type ProviderOutboundCoverageEntry = {
  surface: string;
  covered: boolean;
  boundary: string;
  note?: string;
};

/** Static coverage table for issue #154's "state the covered scope" requirement. */
export const PROVIDER_OUTBOUND_COVERAGE: readonly ProviderOutboundCoverageEntry[] = [
  {
    surface: "chat / main agent turn (openai, anthropic, google transports)",
    covered: true,
    boundary: "buildGuardedModelFetch",
  },
  {
    surface: "subagent runs",
    covered: true,
    boundary: "same transports; a subagent turn issues its own model requests",
  },
  { surface: "cron runs", covered: true, boundary: "same transports" },
  {
    surface: "compaction and auxiliary model calls (google prompt cache, stage1 golden run)",
    covered: true,
    boundary: "buildGuardedModelFetch call sites",
  },
  {
    surface: "retries issued by the SDK/transport",
    covered: true,
    boundary: "each wire attempt passes the boundary again and re-requests admission",
  },
  {
    surface: "embedding adapters (memory-host-sdk, extensions/*/embedding-provider)",
    covered: false,
    boundary: "separate fetch clients",
    note: "Not gated in this change; a shared group would need its own admission call.",
  },
  {
    surface: "media understanding / image / music generation providers",
    covered: false,
    boundary: "provider plugins with their own transports",
    note: "Not gated in this change.",
  },
  {
    surface: "local provider sidecar startup",
    covered: false,
    boundary: "provider-local-service lease accounting",
    note: "Already reference-counted by its own lease; not part of the request budget.",
  },
] as const;

type ManagedGroup = {
  groupId: string;
  endpoint: string;
  account: string;
  gate: BoundedConcurrencyGate;
  limits: ProviderOutboundQuotaLimits;
  providers: Set<string>;
};

let config: ProviderOutboundBudgetConfig | undefined;
let envConfigLoaded = false;
let groups = new Map<string, ManagedGroup>();

/** Truncated SHA-256 used only as an in-memory account discriminator. */
function accountFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/** Normalizes a base URL into a `scheme://host[:port]` identity. */
export function normalizeProviderEndpoint(baseUrl: unknown): string {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return "unparsed-endpoint";
  }
  try {
    const parsed = new URL(baseUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "unparsed-endpoint";
    }
    const defaultPort =
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80");
    const host = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
    return `${parsed.protocol}//${host}${defaultPort || !parsed.port ? "" : `:${parsed.port}`}`;
  } catch {
    return "unparsed-endpoint";
  }
}

/** Derives the non-exportable account discriminator for one resolved request config. */
export function resolveProviderAccountDiscriminator(params: {
  model: Model;
  requestConfig: Pick<ResolvedProviderRequestConfig, "auth">;
}): string {
  const auth = params.requestConfig.auth;
  if (!auth.configured) {
    // Provider-default auth has no per-account override; the provider id is the identity.
    return `provider-default:${params.model.provider}`;
  }
  const headerIdentity =
    auth.mode === "header"
      ? auth.headerName
      : auth.mode === "query"
        ? auth.parameterName
        : "authorization";
  return `${auth.mode}:${headerIdentity}:${accountFingerprint(auth.value)}`;
}

/** Resolves the quota group a model request belongs to. */
export function resolveProviderOutboundQuotaGroup(params: {
  model: Model;
  requestConfig: Pick<ResolvedProviderRequestConfig, "auth">;
}): ProviderOutboundQuotaGroup {
  const endpoint = normalizeProviderEndpoint(params.model.baseUrl);
  const account = resolveProviderAccountDiscriminator(params);
  return {
    groupId: `${endpoint}#${account}`,
    endpoint,
    account,
    provider: params.model.provider,
    api: params.model.api,
  };
}

/** Resolves one alias hop chain (bounded to avoid cycles). */
function resolveAlias(groupId: string, aliases: Record<string, string> | undefined): string {
  if (!aliases) {
    return groupId;
  }
  let current = groupId;
  for (let hop = 0; hop < 4; hop += 1) {
    const next = aliases[current];
    if (typeof next !== "string" || !next.trim() || next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

/** Resolves the effective limits for a group, or `undefined` when ungated. */
export function resolveProviderOutboundLimits(
  groupId: string,
  active: ProviderOutboundBudgetConfig | undefined,
): ProviderOutboundQuotaLimits | undefined {
  if (!active) {
    return undefined;
  }
  const canonical = resolveAlias(groupId, active.quotaGroupAliases);
  const perGroup = active.quotas?.[groupId] ?? active.quotas?.[canonical];
  const limits = perGroup ?? active.limits;
  if (!limits || !Number.isFinite(limits.maxConcurrent) || limits.maxConcurrent < 1) {
    return undefined;
  }
  return limits;
}

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

/** Reads `a=b,c=d` alias pairs. Invalid entries are ignored rather than guessed. */
function readAliasEnv(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined || !raw.trim()) {
    return undefined;
  }
  const aliases: Record<string, string> = {};
  let count = 0;
  for (const part of raw.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const from = part.slice(0, separator).trim();
    const to = part.slice(separator + 1).trim();
    if (!from || !to) {
      continue;
    }
    aliases[from] = to;
    count += 1;
  }
  return count > 0 ? aliases : undefined;
}

/** Builds budget configuration from the environment; `undefined` when nothing is set. */
export function readProviderOutboundBudgetConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderOutboundBudgetConfig | undefined {
  const maxConcurrent = readPositiveEnvInt(env[PROVIDER_OUTBOUND_ENV.maxConcurrent]);
  const aliases = readAliasEnv(env[PROVIDER_OUTBOUND_ENV.quotaGroupAliases]);
  if (maxConcurrent === undefined) {
    return aliases ? { quotaGroupAliases: aliases } : undefined;
  }
  const maxQueue = readPositiveEnvInt(env[PROVIDER_OUTBOUND_ENV.maxQueue]);
  const queueTimeoutMs = readPositiveEnvInt(env[PROVIDER_OUTBOUND_ENV.queueTimeoutMs]);
  return {
    limits: {
      maxConcurrent,
      ...(maxQueue === undefined ? {} : { maxQueue }),
      ...(queueTimeoutMs === undefined ? {} : { queueTimeoutMs }),
    },
    ...(aliases ? { quotaGroupAliases: aliases } : {}),
  };
}

/** Replaces the budget configuration. `undefined` disables every limit. */
export function configureProviderOutboundBudget(next: ProviderOutboundBudgetConfig | undefined): void {
  groups = new Map();
  config = next;
  envConfigLoaded = true;
}

/** Restores the environment-derived configuration and drops all gates (test helper). */
export function resetProviderOutboundBudget(): void {
  groups = new Map();
  config = undefined;
  envConfigLoaded = false;
}

function activeConfig(): ProviderOutboundBudgetConfig | undefined {
  if (!envConfigLoaded) {
    envConfigLoaded = true;
    config = readProviderOutboundBudgetConfigFromEnv();
  }
  return config;
}

function gateFor(params: {
  group: ProviderOutboundQuotaGroup;
  limits: ProviderOutboundQuotaLimits;
  now?: () => number;
}): ManagedGroup {
  const canonical = resolveAlias(params.group.groupId, activeConfig()?.quotaGroupAliases);
  const existing = groups.get(canonical);
  if (existing) {
    existing.providers.add(params.group.provider);
    return existing;
  }
  const created: ManagedGroup = {
    groupId: canonical,
    endpoint: params.group.endpoint,
    account: params.group.account,
    limits: params.limits,
    providers: new Set([params.group.provider]),
    gate: createBoundedConcurrencyGate({
      maxConcurrent: params.limits.maxConcurrent,
      ...(params.limits.maxQueue === undefined ? {} : { maxQueue: params.limits.maxQueue }),
      ...(params.limits.queueTimeoutMs === undefined
        ? {}
        : { queueTimeoutMs: params.limits.queueTimeoutMs }),
      ...(params.now ? { now: params.now } : {}),
      onEvent: (event) => {
        if (event.type !== "rejected") {
          return;
        }
        // Diagnostics deliberately omit the account discriminator and the group id.
        log.warn(
          `[provider-outbound] rejected reason=${event.reason ?? "unknown"} endpoint=${created.endpoint} ` +
            `providers=${[...created.providers].join(",")} active=${event.snapshot.active} ` +
            `queued=${event.snapshot.queued} limit=${event.snapshot.maxConcurrent} maxQueue=${event.snapshot.maxQueue}`,
        );
      },
    }),
  };
  groups.set(canonical, created);
  return created;
}

/**
 * Requests admission for one outbound model request.
 *
 * When no limit is configured this resolves immediately with `limited: false`, so the
 * boundary stays inert until an operator opts in.
 */
export async function acquireProviderOutboundSlot(params: {
  group: ProviderOutboundQuotaGroup;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ProviderOutboundAdmission> {
  const active = activeConfig();
  const limits = resolveProviderOutboundLimits(params.group.groupId, active);
  if (!limits) {
    return {
      ok: true,
      slot: {
        groupId: params.group.groupId,
        limited: false,
        waitedMs: 0,
        release: () => true,
      },
    };
  }
  const managed = gateFor({ group: params.group, limits, now: active?.now });
  const admission = await managed.gate.acquire({
    ...(params.signal ? { signal: params.signal } : {}),
    ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }),
    label: `${params.group.provider}/${params.group.api}`,
  });
  if (!admission.ok) {
    return {
      ok: false,
      reason: admission.reason,
      groupId: managed.groupId,
      waitedMs: admission.waitedMs,
      snapshot: admission.snapshot,
    };
  }
  return {
    ok: true,
    slot: {
      groupId: managed.groupId,
      limited: true,
      waitedMs: admission.waitedMs,
      release: () => admission.lease.release(),
    },
  };
}

/** Snapshot of every gated group (ungated groups never allocate a slot). */
export function providerOutboundBudgetStats(): ProviderOutboundGroupStats[] {
  return [...groups.values()].map((managed) => ({
    ...managed.gate.stats(),
    groupId: managed.groupId,
    endpoint: managed.endpoint,
    account: managed.account,
    providers: [...managed.providers].sort(),
  }));
}

/** Closes every gate and rejects the queues; used by tests and shutdown paths. */
export function closeProviderOutboundBudget(): void {
  for (const managed of groups.values()) {
    managed.gate.close("aborted");
  }
}
