/**
 * Authenticated endpoint request budget tests (issue #123).
 *
 * driven_by: agent
 * fixtures: in-process only — no live upstream, no paid provider call, no
 * resource-exhaustion experiment. Provider/model work is a stub; the clock is
 * injected so window behaviour is deterministic.
 *
 * Covered here:
 * - budget module: fixed-window capacity, per-endpoint/per-client bucket
 *   isolation, window recovery, loopback exemption policy, bucket cap;
 * - shared admission boundary (`handleGatewayPostJsonEndpoint`): N allowed /
 *   N+1 rejected with 429 + Retry-After, provider stub never invoked, no SSE
 *   200 headers, concurrency does not over-issue, success does not reset the
 *   budget, auth-failure lockout stays independent;
 * - real handlers (`/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`,
 *   streaming and non-streaming): rejection happens before SSE 200 headers and
 *   before the stubbed provider/model call, and an admitted request does reach
 *   the stub.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentCommand: vi.fn(),
  agentCommandFromIngress: vi.fn(),
  embedBatch: vi.fn(),
  getRuntimeConfig: vi.fn(() => ({}) as Record<string, unknown>),
}));

vi.mock("./agent-command.js", () => ({
  agentCommand: mocks.agentCommand,
  agentCommandFromIngress: mocks.agentCommandFromIngress,
}));

vi.mock("../config/io.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/io.js")>()),
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

vi.mock("../plugins/memory-embedding-provider-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plugins/memory-embedding-provider-runtime.js")>()),
  getMemoryEmbeddingProvider: () =>
    ({
      defaultModel: "stub-embedding-model",
      create: async () => ({
        provider: {
          id: "stub-embedding-provider",
          model: "stub-embedding-model",
          embedQuery: async () => [0, 1],
          embedBatch: mocks.embedBatch,
        },
      }),
    }) as never,
}));

import { createAuthRateLimiter } from "./auth-rate-limit.js";
import {
  ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS,
  ENDPOINT_REQUEST_BUDGET_BUCKET_EMBEDDINGS,
  ENDPOINT_REQUEST_BUDGET_BUCKET_RESPONSES,
  ENDPOINT_REQUEST_BUDGET_DEFAULT_MAX_REQUESTS,
  ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS,
  createGatewayEndpointRequestBudget,
  type GatewayEndpointRequestBudget,
} from "./http-endpoint-budget.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { resolveOpenAiCompatibleHttpOperatorScopes } from "./http-utils.js";
import { createGatewayHttpServer } from "./server-http.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenAiEmbeddingsHttpRequest } from "./embeddings-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";

const TOKEN = "test-gateway-token";
const REMOTE_CLIENT = "203.0.113.10";
const OTHER_REMOTE_CLIENT = "203.0.113.11";

const AUTH_TOKEN = {
  mode: "token" as const,
  token: TOKEN,
  password: undefined,
  allowTailscale: false,
};

// ---------------------------------------------------------------------------
// Fake HTTP request/response
// ---------------------------------------------------------------------------

type FakeResponse = {
  res: ServerResponse;
  headers: Map<string, string>;
  body: () => string;
  flushHeaders: ReturnType<typeof vi.fn>;
  ended: () => boolean;
  waitForEnd: () => Promise<void>;
};

function createFakeResponse(): FakeResponse {
  const headers = new Map<string, string>();
  let text = "";
  let ended = false;
  let resolveEnded = () => {};
  const endedPromise = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  const flushHeaders = vi.fn(() => {
    (res as { headersSent: boolean }).headersSent = true;
  });
  const res = {
    statusCode: 200,
    headersSent: false,
    flushHeaders,
    setHeader: (name: string, value: unknown) => {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader: (name: string) => headers.get(String(name).toLowerCase()),
    write: (chunk: unknown) => {
      text += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    },
    end: (chunk?: unknown) => {
      if (typeof chunk === "string") {
        text += chunk;
      }
      ended = true;
      resolveEnded();
    },
    socket: {
      on: () => {},
      off: () => {},
      once: () => {},
      removeListener: () => {},
    },
    on: () => {},
    once: () => {},
    removeListener: () => {},
  } as unknown as ServerResponse;
  return {
    res,
    headers,
    body: () => text,
    flushHeaders,
    ended: () => ended,
    waitForEnd: () => endedPromise,
  };
}

function createFakeRequest(init: {
  path: string;
  method?: string;
  body?: unknown;
  remoteAddress?: string;
  authorization?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const payload = init.body === undefined ? "" : JSON.stringify(init.body);
  const stream = new Readable({ read() {} });
  if (payload.length > 0) {
    stream.push(Buffer.from(payload, "utf8"));
  }
  stream.push(null);
  const headers: Record<string, string> = {
    host: "127.0.0.1:18789",
    ...(payload.length > 0
      ? {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload, "utf8")),
        }
      : {}),
    ...(init.authorization ? { authorization: init.authorization } : {}),
    ...init.headers,
  };
  return Object.assign(stream, {
    url: init.path,
    method: init.method ?? "POST",
    headers,
    socket: {
      remoteAddress: init.remoteAddress ?? REMOTE_CLIENT,
      on: () => {},
      off: () => {},
      once: () => {},
      removeListener: () => {},
    },
  }) as unknown as IncomingMessage;
}

/** True when a 200 SSE header set was written (what "before SSE headers" guards). */
function sseHeadersWritten(response: FakeResponse): boolean {
  return (
    response.res.statusCode === 200 &&
    (response.headers.get("content-type") ?? "").includes("text/event-stream")
  );
}

function parseError(response: FakeResponse): { message?: string; type?: string } {
  const parsed = JSON.parse(response.body()) as {
    error?: { message?: string; type?: string };
  };
  return parsed.error ?? {};
}

/** Records every provider/model call the endpoints would make. */
function createProviderStub(response: FakeResponse) {
  return vi.fn(() => {
    // Mirrors the real handlers' SSE path so a stubbed call would be visible as
    // written SSE 200 headers if admission happened after it.
    response.res.statusCode = 200;
    response.res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.flushHeaders?.();
    return "provider-called";
  });
}

// ---------------------------------------------------------------------------
// Budget module
// ---------------------------------------------------------------------------

describe("endpoint request budget module", () => {
  it("uses a conservative documented default that is not the draft's 100 RPM", () => {
    expect(ENDPOINT_REQUEST_BUDGET_DEFAULT_MAX_REQUESTS).toBe(30);
    expect(ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS).toBe(60_000);
    expect(ENDPOINT_REQUEST_BUDGET_DEFAULT_MAX_REQUESTS).toBeLessThan(100);
  });

  it("allows N requests then rejects N+1 with a retry hint (fake clock)", () => {
    // Start the fake clock on a window boundary so retryAfterMs is exact: the
    // shared limiter anchors its first window at epoch 0 until the first
    // consume after a full window elapses.
    let nowMs = 60_000;
    const budget = createGatewayEndpointRequestBudget({
      maxRequests: 3,
      windowMs: 60_000,
      now: () => nowMs,
    });
    const req = createFakeRequest({ path: "/v1/chat/completions", method: "POST" });

    const decisions = Array.from({ length: 4 }, () =>
      budget.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS, req }),
    );
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((decision) => decision.remaining)).toEqual([2, 1, 0, 0]);
    const denied = decisions[3];
    expect(!denied.allowed && denied.retryAfterMs).toBe(60_000);

    // Recovery is a fresh window, not a permanent lockout.
    nowMs += ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS;
    expect(
      budget.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS, req }).allowed,
    ).toBe(true);
  });

  it("isolates buckets per endpoint kind and per client identity", () => {
    const nowMs = 1_000;
    const budget = createGatewayEndpointRequestBudget({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => nowMs,
    });
    const chatReq = createFakeRequest({ path: "/v1/chat/completions", method: "POST" });
    const embeddingsReq = createFakeRequest({ path: "/v1/embeddings", method: "POST" });
    const otherClientChatReq = createFakeRequest({
      path: "/v1/chat/completions",
      method: "POST",
      remoteAddress: OTHER_REMOTE_CLIENT,
    });

    expect(
      budget.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS, req: chatReq })
        .allowed,
    ).toBe(true);
    // Same endpoint, same client: exhausted.
    expect(
      budget.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS, req: chatReq })
        .allowed,
    ).toBe(false);
    // Different endpoint: independent bucket.
    expect(
      budget.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_EMBEDDINGS, req: embeddingsReq })
        .allowed,
    ).toBe(true);
    // Different client, same endpoint: independent bucket.
    expect(
      budget.consume({
        bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS,
        req: otherClientChatReq,
      }).allowed,
    ).toBe(true);
    expect(budget.size()).toBe(3);
  });

  it("never over-issues without awaiting between consumes", () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 5, windowMs: 60_000 });
    const req = createFakeRequest({ path: "/v1/responses", method: "POST" });
    const results = Array.from({ length: 50 }, () =>
      budget.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_RESPONSES, req }),
    );
    expect(results.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(results.filter((decision) => !decision.allowed)).toHaveLength(45);
  });

  it("exempts loopback by default and can be configured strict", () => {
    const nowMs = 1_000;
    const exempt = createGatewayEndpointRequestBudget({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => nowMs,
    });
    const loopbackV4 = createFakeRequest({
      path: "/v1/chat/completions",
      method: "POST",
      remoteAddress: "127.0.0.1",
    });
    const loopbackV6 = createFakeRequest({
      path: "/v1/chat/completions",
      method: "POST",
      remoteAddress: "::1",
    });
    for (const req of [loopbackV4, loopbackV6]) {
      const decision = exempt.consume({
        bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS,
        req,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.allowed && decision.exempt).toBe(true);
    }
    // No bucket is created for exempt traffic, so local traffic can never
    // exhaust (or be denied by) the shared remote budget.
    expect(exempt.size()).toBe(0);

    const strict = createGatewayEndpointRequestBudget({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => nowMs,
      exemptLoopback: false,
    });
    expect(
      strict.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS, req: loopbackV4 })
        .allowed,
    ).toBe(true);
    expect(
      strict.consume({ bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS, req: loopbackV4 })
        .allowed,
    ).toBe(false);
  });

  it("clamps degenerate configuration instead of failing open", () => {
    const budget = createGatewayEndpointRequestBudget({
      maxRequests: 0,
      windowMs: 1,
      maxBuckets: 1,
    });
    const first = createFakeRequest({ path: "/v1/chat/completions", method: "POST" });
    const second = createFakeRequest({
      path: "/v1/chat/completions",
      method: "POST",
      remoteAddress: OTHER_REMOTE_CLIENT,
    });
    expect(budget.consume({ bucket: "a", req: first }).allowed).toBe(true);
    // maxRequests floors at 1 and windowMs at 1000ms; the bucket cap evicts the
    // oldest entry rather than growing without bound.
    expect(budget.consume({ bucket: "b", req: second }).allowed).toBe(true);
    expect(budget.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shared admission boundary
// ---------------------------------------------------------------------------

type BoundaryEndpoint = {
  label: string;
  path: string;
  bucket: string;
  body: () => Record<string, unknown>;
};

const BOUNDARY_ENDPOINTS: BoundaryEndpoint[] = [
  {
    label: "chat completions",
    path: "/v1/chat/completions",
    bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS,
    body: () => ({ model: "openclaw", messages: [{ role: "user", content: "hi" }] }),
  },
  {
    label: "responses",
    path: "/v1/responses",
    bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_RESPONSES,
    body: () => ({ model: "openclaw", input: "hi", stream: false }),
  },
  {
    label: "embeddings",
    path: "/v1/embeddings",
    bucket: ENDPOINT_REQUEST_BUDGET_BUCKET_EMBEDDINGS,
    body: () => ({ model: "openclaw", input: ["hi"] }),
  },
];

/** Drives the real shared admission helper for one endpoint. */
async function admit(params: {
  endpoint: BoundaryEndpoint;
  budget: GatewayEndpointRequestBudget;
  response: FakeResponse;
  providerStub: ReturnType<typeof createProviderStub>;
  remoteAddress?: string;
  authorization?: string;
  rateLimiter?: ReturnType<typeof createAuthRateLimiter>;
  method?: string;
}) {
  const req = createFakeRequest({
    path: params.endpoint.path,
    method: params.method ?? "POST",
    body: params.endpoint.body(),
    ...(params.remoteAddress ? { remoteAddress: params.remoteAddress } : {}),
    authorization: params.authorization ?? `Bearer ${TOKEN}`,
  });
  const handled = await handleGatewayPostJsonEndpoint(req, params.response.res, {
    pathname: params.endpoint.path,
    auth: AUTH_TOKEN,
    maxBodyBytes: 1_000_000,
    trustedProxies: [],
    requiredOperatorMethod: "chat.send",
    resolveOperatorScopes: resolveOpenAiCompatibleHttpOperatorScopes,
    ...(params.rateLimiter ? { rateLimiter: params.rateLimiter } : {}),
    endpointRequestBudget: params.budget,
    endpointRequestBudgetBucket: params.endpoint.bucket,
  });
  if (handled) {
    params.providerStub();
  }
  return handled;
}

describe("authenticated endpoint request budget at the shared admission boundary", () => {
  it.each(BOUNDARY_ENDPOINTS)(
    "allows N and rejects N+1 before provider work and SSE headers: $label",
    async (endpoint) => {
      let nowMs = 1_000;
      const budget = createGatewayEndpointRequestBudget({
        maxRequests: 2,
        windowMs: 60_000,
        now: () => nowMs,
      });

      for (let index = 0; index < 2; index += 1) {
        const response = createFakeResponse();
        const providerStub = createProviderStub(response);
        const handled = await admit({ endpoint, budget, response, providerStub });
        expect(handled).toBeTruthy();
        expect(providerStub).toHaveBeenCalledTimes(1);
      }

      const deniedResponse = createFakeResponse();
      const deniedStub = createProviderStub(deniedResponse);
      const denied = await admit({
        endpoint,
        budget,
        response: deniedResponse,
        providerStub: deniedStub,
      });

      expect(denied).toBeUndefined();
      expect(deniedResponse.res.statusCode).toBe(429);
      expect(Number(deniedResponse.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(deniedStub).not.toHaveBeenCalled();
      expect(deniedResponse.flushHeaders).not.toHaveBeenCalled();
      expect(sseHeadersWritten(deniedResponse)).toBe(false);
      // The 429 must not claim an authentication failure.
      const error = parseError(deniedResponse);
      expect(error.message ?? "").not.toMatch(/auth|unauthor/i);
      expect(error.type).toBe("rate_limit_exceeded");

      // Window recovery: the next window admits again.
      nowMs += ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS;
      const recoveredResponse = createFakeResponse();
      const recoveredStub = createProviderStub(recoveredResponse);
      expect(
        await admit({ endpoint, budget, response: recoveredResponse, providerStub: recoveredStub }),
      ).toBeTruthy();
      expect(recoveredStub).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps buckets independent across endpoints", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const chat = BOUNDARY_ENDPOINTS[0];
    const responses = BOUNDARY_ENDPOINTS[1];

    const firstChat = createFakeResponse();
    expect(
      await admit({
        endpoint: chat,
        budget,
        response: firstChat,
        providerStub: createProviderStub(firstChat),
      }),
    ).toBeTruthy();
    const secondChat = createFakeResponse();
    const secondChatStub = createProviderStub(secondChat);
    expect(
      await admit({ endpoint: chat, budget, response: secondChat, providerStub: secondChatStub }),
    ).toBeUndefined();
    expect(secondChat.res.statusCode).toBe(429);
    expect(secondChatStub).not.toHaveBeenCalled();

    // A different endpoint has its own bucket and is still admitted.
    const firstResponses = createFakeResponse();
    expect(
      await admit({
        endpoint: responses,
        budget,
        response: firstResponses,
        providerStub: createProviderStub(firstResponses),
      }),
    ).toBeTruthy();
  });

  it("does not over-issue under concurrent admission and recovers after the window", async () => {
    let nowMs = 1_000;
    const budget = createGatewayEndpointRequestBudget({
      maxRequests: 5,
      windowMs: 60_000,
      now: () => nowMs,
    });
    const endpoint = BOUNDARY_ENDPOINTS[0];

    const attempts = Array.from({ length: 20 }, () => {
      const response = createFakeResponse();
      return { response, providerStub: createProviderStub(response) };
    });
    const results = await Promise.all(
      attempts.map((attempt) =>
        admit({
          endpoint,
          budget,
          response: attempt.response,
          providerStub: attempt.providerStub,
        }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
    expect(attempts.filter((attempt) => attempt.response.res.statusCode === 429)).toHaveLength(15);
    expect(
      attempts.reduce((total, attempt) => total + attempt.providerStub.mock.calls.length, 0),
    ).toBe(5);

    nowMs += ENDPOINT_REQUEST_BUDGET_DEFAULT_WINDOW_MS;
    const recovered = createFakeResponse();
    expect(
      await admit({
        endpoint,
        budget,
        response: recovered,
        providerStub: createProviderStub(recovered),
      }),
    ).toBeTruthy();
  });

  it("keeps the success path from clearing the budget while the auth lockout stays independent", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const authLimiter = createAuthRateLimiter({
      maxAttempts: 2,
      windowMs: 60_000,
      lockoutMs: 60_000,
      exemptLoopback: false,
    });
    const endpoint = BOUNDARY_ENDPOINTS[0];

    // Request 1: successful authentication is allowed and spends the budget.
    const first = createFakeResponse();
    expect(
      await admit({
        endpoint,
        budget,
        response: first,
        providerStub: createProviderStub(first),
        rateLimiter: authLimiter,
      }),
    ).toBeTruthy();

    // Request 2 authenticates successfully again (and the auth limiter resets),
    // yet the inference budget still rejects it: success must not clear it.
    const second = createFakeResponse();
    const secondStub = createProviderStub(second);
    expect(
      await admit({
        endpoint,
        budget,
        response: second,
        providerStub: secondStub,
        rateLimiter: authLimiter,
      }),
    ).toBeUndefined();
    expect(second.res.statusCode).toBe(429);
    expect(parseError(second).type).toBe("rate_limit_exceeded");
    expect(secondStub).not.toHaveBeenCalled();
    // The auth limiter itself recorded no failure/lockout for this client.
    expect(authLimiter.check(REMOTE_CLIENT).allowed).toBe(true);

    // Auth-failure lockout still works on its own, on a client with budget left.
    // maxAttempts: 2 means the first two wrong tokens are 401 and lock the
    // client out; the next attempt is rejected by the auth limiter, not by the
    // inference budget.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failing = createFakeResponse();
      await admit({
        endpoint,
        budget,
        response: failing,
        providerStub: createProviderStub(failing),
        rateLimiter: authLimiter,
        remoteAddress: OTHER_REMOTE_CLIENT,
        authorization: "Bearer wrong-token",
      });
      expect(failing.res.statusCode).toBe(401);
    }
    const lockedOut = createFakeResponse();
    await admit({
      endpoint,
      budget,
      response: lockedOut,
      providerStub: createProviderStub(lockedOut),
      rateLimiter: authLimiter,
      remoteAddress: OTHER_REMOTE_CLIENT,
      authorization: `Bearer ${TOKEN}`,
    });
    expect(lockedOut.res.statusCode).toBe(429);
    expect(parseError(lockedOut).message ?? "").toMatch(/authentication/i);
    // No budget was spent on the other client's rejected requests.
    expect(budget.size()).toBe(1);
  });

  it("does not spend budget on unauthorized or wrong-method requests", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const endpoint = BOUNDARY_ENDPOINTS[0];

    const unauthorized = createFakeResponse();
    await admit({
      endpoint,
      budget,
      response: unauthorized,
      providerStub: createProviderStub(unauthorized),
      authorization: "Bearer wrong-token",
    });
    expect(unauthorized.res.statusCode).toBe(401);

    const wrongMethod = createFakeResponse();
    await admit({
      endpoint,
      budget,
      response: wrongMethod,
      providerStub: createProviderStub(wrongMethod),
      method: "GET",
    });
    expect(wrongMethod.res.statusCode).toBe(405);

    // Nothing above consumed the budget, so the first legitimate request passes
    // and the second is the one that trips the limit.
    const allowed = createFakeResponse();
    expect(
      await admit({
        endpoint,
        budget,
        response: allowed,
        providerStub: createProviderStub(allowed),
      }),
    ).toBeTruthy();
    const denied = createFakeResponse();
    expect(
      await admit({
        endpoint,
        budget,
        response: denied,
        providerStub: createProviderStub(denied),
      }),
    ).toBeUndefined();
    expect(denied.res.statusCode).toBe(429);
  });

  it("declares the loopback policy at the boundary: local traffic is exempt", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const endpoint = BOUNDARY_ENDPOINTS[0];

    const remoteFirst = createFakeResponse();
    expect(
      await admit({
        endpoint,
        budget,
        response: remoteFirst,
        providerStub: createProviderStub(remoteFirst),
      }),
    ).toBeTruthy();
    const remoteSecond = createFakeResponse();
    expect(
      await admit({
        endpoint,
        budget,
        response: remoteSecond,
        providerStub: createProviderStub(remoteSecond),
      }),
    ).toBeUndefined();
    expect(remoteSecond.res.statusCode).toBe(429);

    // Loopback is exempt, so local first-party traffic keeps working even while
    // the remote client's bucket is exhausted.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loopback = createFakeResponse();
      const stub = createProviderStub(loopback);
      expect(
        await admit({
          endpoint,
          budget,
          response: loopback,
          providerStub: stub,
          remoteAddress: "127.0.0.1",
        }),
      ).toBeTruthy();
      expect(stub).toHaveBeenCalledTimes(1);
    }
    // Only the remote client has a bucket.
    expect(budget.size()).toBe(1);
  });

  it("falls back to the request pathname so endpoints never share one bucket", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const endpoint = BOUNDARY_ENDPOINTS[0];
    const first = createFakeResponse();
    expect(
      await handleGatewayPostJsonEndpoint(
        createFakeRequest({
          path: endpoint.path,
          body: endpoint.body(),
          authorization: `Bearer ${TOKEN}`,
        }),
        first.res,
        {
          pathname: endpoint.path,
          auth: AUTH_TOKEN,
          maxBodyBytes: 1_000_000,
          trustedProxies: [],
          endpointRequestBudget: budget,
        },
      ),
    ).toBeTruthy();
    const second = createFakeResponse();
    expect(
      await handleGatewayPostJsonEndpoint(
        createFakeRequest({
          path: "/v1/embeddings",
          body: { model: "openclaw", input: ["hi"] },
          authorization: `Bearer ${TOKEN}`,
        }),
        second.res,
        {
          pathname: "/v1/embeddings",
          auth: AUTH_TOKEN,
          maxBodyBytes: 1_000_000,
          trustedProxies: [],
          endpointRequestBudget: budget,
        },
      ),
    ).toBeTruthy();
    expect(budget.size()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Endpoint-disabled behaviour and lifecycle wiring
// ---------------------------------------------------------------------------

const AUTH_NONE_LOCAL = {
  mode: "none" as const,
  token: undefined,
  password: undefined,
  allowTailscale: false,
};

function createGatewayServerForBudget(params: {
  budget: GatewayEndpointRequestBudget;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
}) {
  return createGatewayHttpServer({
    clients: new Set(),
    controlUiEnabled: false,
    controlUiBasePath: "/__control__",
    openAiChatCompletionsEnabled: params.openAiChatCompletionsEnabled,
    openResponsesEnabled: params.openResponsesEnabled,
    handleHooksRequest: async () => false,
    resolvedAuth: AUTH_NONE_LOCAL,
    endpointRequestBudget: params.budget,
  });
}

async function dispatchToGatewayServer(
  server: ReturnType<typeof createGatewayHttpServer>,
  init: { path: string; body: unknown },
): Promise<FakeResponse> {
  const response = createFakeResponse();
  server.emit(
    "request",
    createFakeRequest({ path: init.path, body: init.body, authorization: `Bearer ${TOKEN}` }),
    response.res,
  );
  await Promise.race([
    response.waitForEnd(),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`dispatch timed out for ${init.path}`)), 5_000),
    ),
  ]);
  return response;
}

describe("endpoint-disabled behaviour stays unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentCommand.mockResolvedValue(AGENT_RESULT);
    mocks.agentCommandFromIngress.mockResolvedValue(AGENT_RESULT);
    mocks.embedBatch.mockResolvedValue([[0.1, 0.2, 0.3]]);
  });

  it("keeps both main endpoints disabled by default and never spends the budget", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const server = createGatewayServerForBudget({
      budget,
      openAiChatCompletionsEnabled: false,
      openResponsesEnabled: false,
    });

    const responses: FakeResponse[] = [];
    for (const path of ["/v1/chat/completions", "/v1/responses", "/v1/embeddings"]) {
      responses.push(await dispatchToGatewayServer(server, { path, body: chatRequestBody(false) }));
    }

    for (const response of responses) {
      expect(response.res.statusCode).toBe(404);
      expect(sseHeadersWritten(response)).toBe(false);
      expect(response.flushHeaders).not.toHaveBeenCalled();
    }
    // The disabled path short-circuits before the shared admission boundary.
    expect(budget.size()).toBe(0);
    expect(mocks.agentCommandFromIngress).not.toHaveBeenCalled();
  });

  it("admits through the budget once the operator enables the endpoint", async () => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
    const server = createGatewayServerForBudget({
      budget,
      openAiChatCompletionsEnabled: true,
      openResponsesEnabled: false,
    });

    const admitted = await dispatchToGatewayServer(server, {
      path: "/v1/chat/completions",
      body: chatRequestBody(false),
    });
    expect(admitted.res.statusCode).toBe(200);
    expect(mocks.agentCommandFromIngress).toHaveBeenCalledTimes(1);

    const denied = await dispatchToGatewayServer(server, {
      path: "/v1/chat/completions",
      body: chatRequestBody(false),
    });
    expect(denied.res.statusCode).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(parseError(denied).type).toBe("rate_limit_exceeded");
    // The over-budget request never reached the model: the stub count is still 1.
    expect(mocks.agentCommandFromIngress).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Real handlers: rejection ordering and admission
// ---------------------------------------------------------------------------

function chatRequestBody(stream: boolean) {
  return {
    model: "openclaw",
    stream,
    messages: [{ role: "user", content: "hello" }],
  };
}

function responsesRequestBody(stream: boolean) {
  return { model: "openclaw", stream, input: "hello" };
}

const AGENT_RESULT = {
  text: "stub answer",
  payloads: [{ text: "stub answer" }],
};

/** Exhausts every inference bucket of a budget created with maxRequests: 1. */
function exhaustedBudget(): GatewayEndpointRequestBudget {
  const budget = createGatewayEndpointRequestBudget({ maxRequests: 1, windowMs: 60_000 });
  for (const bucket of [
    ENDPOINT_REQUEST_BUDGET_BUCKET_CHAT_COMPLETIONS,
    ENDPOINT_REQUEST_BUDGET_BUCKET_RESPONSES,
    ENDPOINT_REQUEST_BUDGET_BUCKET_EMBEDDINGS,
  ]) {
    budget.consume({
      bucket,
      req: createFakeRequest({ path: "/v1/chat/completions", method: "POST" }),
    });
  }
  return budget;
}

const HANDLERS = [
  {
    label: "chat completions streaming",
    path: "/v1/chat/completions",
    invoke: (req: IncomingMessage, res: ServerResponse, budget: GatewayEndpointRequestBudget) =>
      handleOpenAiHttpRequest(req, res, { auth: AUTH_TOKEN, endpointRequestBudget: budget }),
    body: chatRequestBody(true),
    expectedProvider: "agent" as const,
  },
  {
    label: "chat completions non-streaming",
    path: "/v1/chat/completions",
    invoke: (req: IncomingMessage, res: ServerResponse, budget: GatewayEndpointRequestBudget) =>
      handleOpenAiHttpRequest(req, res, { auth: AUTH_TOKEN, endpointRequestBudget: budget }),
    body: chatRequestBody(false),
    expectedProvider: "agent" as const,
  },
  {
    label: "responses streaming",
    path: "/v1/responses",
    invoke: (req: IncomingMessage, res: ServerResponse, budget: GatewayEndpointRequestBudget) =>
      handleOpenResponsesHttpRequest(req, res, { auth: AUTH_TOKEN, endpointRequestBudget: budget }),
    body: responsesRequestBody(true),
    expectedProvider: "agent" as const,
  },
  {
    label: "responses non-streaming",
    path: "/v1/responses",
    invoke: (req: IncomingMessage, res: ServerResponse, budget: GatewayEndpointRequestBudget) =>
      handleOpenResponsesHttpRequest(req, res, { auth: AUTH_TOKEN, endpointRequestBudget: budget }),
    body: responsesRequestBody(false),
    expectedProvider: "agent" as const,
  },
  {
    label: "embeddings",
    path: "/v1/embeddings",
    invoke: (req: IncomingMessage, res: ServerResponse, budget: GatewayEndpointRequestBudget) =>
      handleOpenAiEmbeddingsHttpRequest(req, res, {
        auth: AUTH_TOKEN,
        endpointRequestBudget: budget,
      }),
    body: { model: "openclaw", input: ["hello"] },
    expectedProvider: "embeddings" as const,
  },
];

describe("real inference handlers reject over-budget requests before SSE headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentCommand.mockResolvedValue(AGENT_RESULT);
    mocks.agentCommandFromIngress.mockResolvedValue(AGENT_RESULT);
    mocks.embedBatch.mockResolvedValue([[0.1, 0.2, 0.3]]);
  });

  it.each(HANDLERS)("$label: 429 first, provider never called", async (handler) => {
    const response = createFakeResponse();
    const req = createFakeRequest({
      path: handler.path,
      body: handler.body,
      authorization: `Bearer ${TOKEN}`,
    });

    const handled = await handler.invoke(req, response.res, exhaustedBudget());

    expect(handled).toBe(true);
    expect(response.res.statusCode).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(sseHeadersWritten(response)).toBe(false);
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(parseError(response).type).toBe("rate_limit_exceeded");
    expect(parseError(response).message ?? "").not.toMatch(/auth|unauthor/i);
    expect(mocks.agentCommandFromIngress).not.toHaveBeenCalled();
    expect(mocks.embedBatch).not.toHaveBeenCalled();
  });

  it.each(HANDLERS)("$label: an admitted request reaches the stubbed provider", async (handler) => {
    const budget = createGatewayEndpointRequestBudget({ maxRequests: 5, windowMs: 60_000 });
    const response = createFakeResponse();
    const req = createFakeRequest({
      path: handler.path,
      body: handler.body,
      authorization: `Bearer ${TOKEN}`,
    });

    const handled = await handler.invoke(req, response.res, budget);

    expect(handled).toBe(true);
    expect(response.res.statusCode).not.toBe(429);
    if (handler.expectedProvider === "agent") {
      expect(mocks.agentCommandFromIngress).toHaveBeenCalledTimes(1);
      expect(mocks.embedBatch).not.toHaveBeenCalled();
    } else {
      expect(mocks.embedBatch).toHaveBeenCalledTimes(1);
      expect(mocks.agentCommandFromIngress).not.toHaveBeenCalled();
    }
  });
});
