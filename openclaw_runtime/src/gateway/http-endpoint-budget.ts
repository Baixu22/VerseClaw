/**
 * Authenticated inference-endpoint request budget for the shared Gateway HTTP
 * admission boundary (`handleGatewayPostJsonEndpoint`).
 *
 * Why this exists
 * ---------------
 * `AuthRateLimiter` (auth-rate-limit.ts) only counts *failed* authentication
 * attempts, and a successful shared-secret auth resets that counter. Nothing
 * bounded how many *successfully authenticated* inference requests one client
 * could admit, so a credential-holding loop could drive unbounded
 * `/v1/chat/completions`, `/v1/responses`, and `/v1/embeddings` admissions.
 * This module adds that admission budget, consumed once per admitted request
 * after method/auth/scope/body checks and before any model/provider work or
 * SSE response headers.
 *
 * Design (see the issue this implements, and the report accompanying this
 * change, for the decision record):
 * - Reuses the existing in-process fixed-window limiter
 *   (`../infra/fixed-window-rate-limit.js`); no Redis, no multi-tenant
 *   service, and no second rate-limit algorithm.
 * - Bucket scope is `endpoint kind + client identity`. Client identity uses the
 *   same normalization as the auth limiter (`normalizeRateLimitClientIp` over
 *   the trusted-proxy-aware `resolveRequestClientIp`), so the inference budget
 *   and the auth-failure lockout agree on who a client is. Scoping per client
 *   (rather than one fleet-wide counter) means one looping client cannot deny
 *   the endpoint to every other client.
 * - Buckets are per process, so the budget is per gateway process, not
 *   cluster-wide. That matches the in-process limiter choice and is recorded as
 *   a residual limitation rather than a distributed guarantee.
 * - Loopback is exempt by default, mirroring `AuthRateLimiter`'s existing
 *   `exemptLoopback: true` default. The local desktop app and the local CLI
 *   reach the Gateway over loopback; throttling them would break first-party
 *   local inference, and because the exemption keeps remote traffic out of a
 *   shared counter, remote clients can never exhaust the local flow's budget.
 *   The exemption is explicit and configurable, never implicit.
 * - The default capacity is a conservative safety budget, not a frozen product
 *   decision: 30 admitted requests per 60s window per (endpoint, client).
 *   Interactive OpenAI-compatible clients issue well under one request per
 *   second, while a credential-holding loop is bounded within one window. It is
 *   deliberately lower than the "100 RPM" sketch in the issue and is intended
 *   to be revised from capacity experiments; callers that need a different
 *   budget pass `maxRequests`/`windowMs` rather than editing this constant.
 */

import type { IncomingMessage } from "node:http";
import {
  createFixedWindowRateLimiter,
  resolveFixedWindowRateLimitInteger,
  type FixedWindowRateLimiter,
} from "../infra/fixed-window-rate-limit.js";
import { normalizeRateLimitClientIp } from "./auth-rate-limit.js";
import { isLoopbackAddress, resolveRequestClientIp } from "./net.js";

/**
 * Conservative default budget: admitted requests per window, per (endpoint,
 * client) bucket.
 *
 * Rationale: at 30/60s a single authenticated client sustains ~0.5 requests per
 * second, which is far above normal interactive OpenAI-compatible traffic
 * (each completion takes seconds) and still bounds a credential-holding loop to
 * 30 model admissions per minute. This is a documented safety default, not a
 * frozen product lock; use `maxRequests` to override it.
 */
export const ENDPOINT_REQUEST_BUDGET_DEFAULT_MAX_REQUESTS = 30;

/** Default fixed window for the endpoint request budget: 60s. */
export const ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS = 60_000;

/** Hard cap on bucket entries to bound memory from unique-key injection (CWE-400). */
const ENDPOINT_REQUEST_BUDGET_MAX_BUCKETS = 10_000;

/** Bucket id for `POST /v1/chat/completions`. */
export const ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS = "chat-completions";
/** Bucket id for `POST /v1/responses`. */
export const ENDPOINT_REQUEST_BUDGET_BUCKET_RESPONSES = "responses";
/** Bucket id for `POST /v1/embeddings`. */
export const ENDPOINT_REQUEST_BUDGET_BUCKET_EMBEDDINGS = "embeddings";

export type EndpointRequestBudgetDecision =
  | {
      allowed: true;
      remaining: number;
      retryAfterMs: 0;
      /** Resolved `endpoint:clientKey` bucket this request was charged to. */
      bucketKey: string;
      /** True when loopback policy exempted the request (no quota consumed). */
      exempt: boolean;
    }
  | {
      allowed: false;
      remaining: 0;
      /** Milliseconds until the current fixed window ends. */
      retryAfterMs: number;
      bucketKey: string;
      exempt: false;
    };

export type GatewayEndpointRequestBudget = {
  /**
   * Consume one unit of the endpoint budget for `bucket` for the request's
   * client identity. Loopback-exempt callers return `allowed: true` without
   * consuming quota.
   */
  consume(params: {
    bucket: string;
    req: IncomingMessage;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  }): EndpointRequestBudgetDecision;
  /** Number of live buckets; diagnostics and tests only. */
  size(): number;
  /** Drop all buckets; diagnostics and tests only. */
  reset(): void;
};

/**
 * Creates the in-process endpoint request budget. One instance is held by the
 * Gateway lifecycle and shared by every inference endpoint so all of them admit
 * through the same boundary; each keeps its own bucket per client.
 */
export function createGatewayEndpointRequestBudget(params?: {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  /** Exempt loopback clients (default true, matching AuthRateLimiter). */
  exemptLoopback?: boolean;
  /** Override the bucket-entry cap (tests). */
  maxBuckets?: number;
}): GatewayEndpointRequestBudget {
  const maxRequests = resolveFixedWindowRateLimitInteger(
    params?.maxRequests,
    ENDPOINT_REQUEST_BUDGET_DEFAULT_MAX_REQUESTS,
    { min: 1 },
  );
  const windowMs = resolveFixedWindowRateLimitInteger(
    params?.windowMs,
    ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS,
    { min: 1_000 },
  );
  const exemptLoopback = params?.exemptLoopback ?? true;
  const maxBuckets = resolveFixedWindowRateLimitInteger(
    params?.maxBuckets,
    ENDPOINT_REQUEST_BUDGET_MAX_BUCKETS,
    { min: 1 },
  );
  const limiters = new Map<string, FixedWindowRateLimiter>();

  function resolveBucketKey(paramsLocal: {
    bucket: string;
    req: IncomingMessage;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  }): { bucketKey: string; clientIp: string } {
    // Reuse the auth limiter's canonical client identity so both budgets agree
    // on the same key for the same caller (including IPv4-mapped IPv6 forms).
    const clientIp = normalizeRateLimitClientIp(
      resolveRequestClientIp(
        paramsLocal.req,
        paramsLocal.trustedProxies,
        paramsLocal.allowRealIpFallback,
      ),
    );
    return {
      bucketKey: `${paramsLocal.bucket}:${clientIp}`,
      clientIp,
    };
  }

  function resolveLimiter(bucketKey: string): FixedWindowRateLimiter {
    const existing = limiters.get(bucketKey);
    if (existing) {
      return existing;
    }
    if (limiters.size >= maxBuckets) {
      // Enforce the cap before inserting so unique-key injection cannot grow the
      // map without bound. Evicting the oldest entry can restart that bucket's
      // window; the cap is a memory-safety bound, not a correctness guarantee.
      const oldest = limiters.keys().next().value;
      if (oldest !== undefined) {
        limiters.delete(oldest);
      }
    }
    const limiter = createFixedWindowRateLimiter({
      maxRequests,
      windowMs,
      ...(params?.now ? { now: params.now } : {}),
    });
    limiters.set(bucketKey, limiter);
    return limiter;
  }

  function consume(paramsLocal: {
    bucket: string;
    req: IncomingMessage;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
  }): EndpointRequestBudgetDecision {
    const { bucketKey, clientIp } = resolveBucketKey(paramsLocal);
    if (exemptLoopback && isLoopbackAddress(clientIp)) {
      // Declared policy: loopback traffic never consumes (or is denied) endpoint
      // budget, matching the auth limiter's default loopback exemption.
      return {
        allowed: true,
        remaining: maxRequests,
        retryAfterMs: 0,
        bucketKey,
        exempt: true,
      };
    }

    const decision = resolveLimiter(bucketKey).consume();
    if (!decision.allowed) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: decision.retryAfterMs,
        bucketKey,
        exempt: false,
      };
    }
    return {
      allowed: true,
      remaining: decision.remaining,
      retryAfterMs: 0,
      bucketKey,
      exempt: false,
    };
  }

  return {
    consume,
    size: () => limiters.size,
    reset: () => limiters.clear(),
  };
}
