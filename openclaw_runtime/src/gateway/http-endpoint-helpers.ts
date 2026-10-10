// Gateway HTTP endpoint helpers.
// Wraps common POST JSON method, auth, scope, and body handling.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import type { GatewayEndpointRequestBudget } from "./http-endpoint-budget.js";
import {
  readJsonBodyOrError,
  sendEndpointRequestBudgetExceeded,
  sendMethodNotAllowed,
  sendMissingScopeForbidden,
} from "./http-common.js";
import {
  authorizeGatewayHttpRequestOrReply,
  type AuthorizedGatewayHttpRequest,
  resolveTrustedHttpOperatorScopes,
} from "./http-utils.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";

/** Handles a gateway POST JSON endpoint and returns the parsed body when authorized. */
export async function handleGatewayPostJsonEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    auth: ResolvedGatewayAuth;
    maxBodyBytes: number;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
    requiredOperatorMethod?: "chat.send" | (string & Record<never, never>);
    resolveOperatorScopes?: (
      req: IncomingMessage,
      requestAuth: AuthorizedGatewayHttpRequest,
    ) => string[];
    /**
     * Optional authenticated inference admission budget. When provided it is
     * consumed exactly once per request, after method/auth/scope/body checks and
     * before any model/provider work or SSE headers.
     */
    endpointRequestBudget?: GatewayEndpointRequestBudget;
    /**
     * Bucket id charged for this endpoint. Defaults to the request pathname so a
     * budget without an explicit bucket still cannot silently share one bucket
     * across endpoints.
     */
    endpointRequestBudgetBucket?: string;
  },
): Promise<false | { body: unknown; requestAuth: AuthorizedGatewayHttpRequest } | undefined> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== opts.pathname) {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return undefined;
  }

  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!requestAuth) {
    return undefined;
  }

  if (opts.requiredOperatorMethod) {
    const requestedScopes =
      opts.resolveOperatorScopes?.(req, requestAuth) ??
      resolveTrustedHttpOperatorScopes(req, requestAuth);
    const scopeAuth = authorizeOperatorScopesForMethod(
      opts.requiredOperatorMethod,
      requestedScopes,
    );
    if (!scopeAuth.allowed) {
      sendMissingScopeForbidden(res, scopeAuth.missingScope);
      return undefined;
    }
  }

  const body = await readJsonBodyOrError(req, res, opts.maxBodyBytes);
  if (body === undefined) {
    return undefined;
  }

  // Authenticated inference admission budget. Consumed exactly here — after
  // method/auth/scope/body checks so malformed or unauthorized requests never
  // spend budget, and before the caller's expensive work (model/provider calls)
  // and before any SSE 200 headers — so an over-budget request never reaches the
  // model. This is independent from the auth-failure lockout: a successful
  // authentication must never clear it.
  const endpointRequestBudget = opts.endpointRequestBudget;
  if (endpointRequestBudget) {
    const decision = endpointRequestBudget.consume({
      bucket: opts.endpointRequestBudgetBucket ?? url.pathname,
      req,
      trustedProxies: opts.trustedProxies,
      allowRealIpFallback: opts.allowRealIpFallback,
    });
    if (!decision.allowed) {
      sendEndpointRequestBudgetExceeded(res, decision.retryAfterMs);
      return undefined;
    }
  }

  return { body, requestAuth };
}
