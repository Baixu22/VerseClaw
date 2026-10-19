// @vitest-environment node
// NET-C (TF-0440): provider endpoint health gate wired into the real outbound boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { guardedFetchMock } = vi.hoisted(() => ({ guardedFetchMock: vi.fn() }));

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: guardedFetchMock,
  withTrustedEnvProxyGuardedFetchMode: (params: unknown) => params,
}));

import type { Model } from "../llm/types.js";
import {
  admitProviderEndpointRequest,
  classifyProviderEndpointResponse,
  configureProviderEndpointHealth,
  PROVIDER_ENDPOINT_HEALTH_DEFAULT_LIMITS,
  PROVIDER_ENDPOINT_HEALTH_ENV,
  ProviderEndpointCircuitOpenError,
  providerEndpointHealthSnapshots,
  readProviderEndpointHealthConfigFromEnv,
  resetProviderEndpointHealth,
} from "./provider-endpoint-health.js";
import {
  configureProviderOutboundBudget,
  resetProviderOutboundBudget,
  resolveProviderOutboundQuotaGroup,
  ProviderOutboundOverloadedError,
} from "./provider-outbound-budget.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";
import {
  attachModelProviderRequestTransport,
  getModelProviderRequestTransport,
  resolveProviderRequestPolicyConfig,
} from "./provider-request-config.js";

const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const REQUEST_INIT = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
};

const MODEL_BASE = {
  name: "endpoint health fixture",
  reasoning: false,
  input: ["text"] as Array<"text" | "image">,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4096,
};

function makeModel(overrides: { id?: string; baseUrl?: string; token?: string } = {}): Model {
  const base = {
    ...MODEL_BASE,
    api: "openai-completions",
    provider: "deepseek",
    id: overrides.id ?? "deepseek-v4-flash",
    baseUrl: overrides.baseUrl ?? "https://api.deepseek.com/v1",
  };
  if (overrides.token === undefined) {
    return base as unknown as Model;
  }
  return attachModelProviderRequestTransport(base as never, {
    auth: { mode: "authorization-bearer", token: overrides.token },
  }) as unknown as Model;
}

function guardedFetchFor(model: Model): ReturnType<typeof buildGuardedModelFetch> {
  return buildGuardedModelFetch(model, 5_000, { sanitizeSse: false });
}

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

type HealthClock = ReturnType<typeof clock>;

function enableHealth(c: HealthClock, over: Partial<{ windowMs: number; maxFailuresPerWindow: number; cooldownMs: number }> = {}) {
  configureProviderEndpointHealth({
    windowMs: 1_000,
    maxFailuresPerWindow: 3,
    cooldownMs: 2_000,
    now: c.now,
    ...over,
  });
}

function groupFor(model: Model) {
  // Resolve auth through the real provider-request policy so the account
  // discriminator reflects the attached credential transport metadata.
  const requestConfig = resolveProviderRequestPolicyConfig({
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    request: getModelProviderRequestTransport(model),
  });
  return resolveProviderOutboundQuotaGroup({ model, requestConfig });
}

/** A response whose body stays open until the test closes it. */
function createOpenBody(): { response: Response; close: () => void } {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
      next.enqueue(encoder.encode('data: {"ok":true}\n\n'));
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    close: () => {
      try {
        controller?.close();
      } catch {
        // Already closed by the managed wrapper.
      }
    },
  };
}

function stubResponses(responses: Response[]): { attemptsMade: () => number } {
  let index = 0;
  guardedFetchMock.mockImplementation(async () => {
    const response = responses[index];
    if (!response) {
      throw new Error("unexpected extra outbound attempt: no stub response left");
    }
    index += 1;
    return {
      response,
      finalUrl: ENDPOINT,
      release: async () => undefined,
      refreshTimeout: undefined,
    };
  });
  return { attemptsMade: () => index };
}

describe("provider endpoint health gate", () => {
  beforeEach(() => {
    resetProviderEndpointHealth();
    resetProviderOutboundBudget();
    guardedFetchMock.mockReset();
  });

  afterEach(() => {
    resetProviderEndpointHealth();
    resetProviderOutboundBudget();
    guardedFetchMock.mockReset();
  });

  describe("configuration surface", () => {
    it("is inert until an operator enables it", () => {
      const model = makeModel();
      const admission = admitProviderEndpointRequest(groupFor(model));
      expect(admission.ok).toBe(true);
      admission.ok && admission.ticket.record("failure");
      expect(providerEndpointHealthSnapshots()).toHaveLength(0);
      expect(readProviderEndpointHealthConfigFromEnv({})).toBeUndefined();
    });

    it("parses the opt-in flag and ignores unusable values", () => {
      const env = { [PROVIDER_ENDPOINT_HEALTH_ENV.breaker]: "1" };
      expect(readProviderEndpointHealthConfigFromEnv(env)).toEqual({
        ...PROVIDER_ENDPOINT_HEALTH_DEFAULT_LIMITS,
      });
      expect(
        readProviderEndpointHealthConfigFromEnv({
          [PROVIDER_ENDPOINT_HEALTH_ENV.breaker]: "1000:3:2000",
        }),
      ).toEqual({ windowMs: 1_000, maxFailuresPerWindow: 3, cooldownMs: 2_000 });
      for (const raw of ["0", "off", "nonsense", "1000:3", "1000:0:2000", "a:b:c"]) {
        expect(
          readProviderEndpointHealthConfigFromEnv({ [PROVIDER_ENDPOINT_HEALTH_ENV.breaker]: raw }),
        ).toBeUndefined();
      }
    });
  });

  describe("counting policy", () => {
    it("never trips on purely legal traffic", () => {
      const c = clock();
      enableHealth(c);
      const model = makeModel();
      for (let i = 0; i < 100; i++) {
        const admission = admitProviderEndpointRequest(groupFor(model));
        expect(admission.ok).toBe(true);
        if (admission.ok) admission.ticket.record("success");
        c.advance(10);
      }
      expect(providerEndpointHealthSnapshots()).toMatchObject([
        { state: "closed", trips: 0, failuresInWindow: 0, endpoint: "https://api.deepseek.com" },
      ]);
    });

    it("classifies only 429 and 5xx responses as failures", () => {
      expect(classifyProviderEndpointResponse(200)).toBe("success");
      expect(classifyProviderEndpointResponse(429)).toBe("failure");
      expect(classifyProviderEndpointResponse(500)).toBe("failure");
      expect(classifyProviderEndpointResponse(503)).toBe("failure");
      expect(classifyProviderEndpointResponse(400)).toBe("neutral");
      expect(classifyProviderEndpointResponse(401)).toBe("neutral");
      expect(classifyProviderEndpointResponse(403)).toBe("neutral");
      expect(classifyProviderEndpointResponse(404)).toBe("neutral");
    });

    it("does not trip on auth or format outcomes that other layers own", () => {
      const c = clock();
      enableHealth(c, { maxFailuresPerWindow: 2 });
      const model = makeModel();
      for (let i = 0; i < 5; i++) {
        const admission = admitProviderEndpointRequest(groupFor(model));
        expect(admission.ok).toBe(true);
        if (admission.ok) admission.ticket.record("neutral");
      }
      expect(providerEndpointHealthSnapshots()).toMatchObject([{ state: "closed", trips: 0 }]);
    });

    it("opens after counted failures and refuses with a retry hint", () => {
      const c = clock();
      enableHealth(c);
      const model = makeModel();
      const group = groupFor(model);
      for (let i = 0; i < 3; i++) {
        const admission = admitProviderEndpointRequest(group);
        expect(admission.ok).toBe(true);
        if (admission.ok) admission.ticket.record("failure");
      }
      const refused = admitProviderEndpointRequest(group);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.endpoint).toBe("https://api.deepseek.com");
        expect(refused.retryAfterMs).toBe(2_000);
        expect(refused.snapshot).toMatchObject({ state: "open", trips: 1 });
      }
      c.advance(1_999);
      expect(admitProviderEndpointRequest(group).ok).toBe(false);
      c.advance(1);
      expect(admitProviderEndpointRequest(group).ok).toBe(true);
    });
  });

  describe("half-open probes", () => {
    it("admits exactly one probe and closes on success", () => {
      const c = clock();
      enableHealth(c);
      const model = makeModel();
      const group = groupFor(model);
      for (let i = 0; i < 3; i++) {
        const admission = admitProviderEndpointRequest(group);
        if (admission.ok) admission.ticket.record("failure");
      }
      c.advance(2_000);
      const probe = admitProviderEndpointRequest(group);
      expect(probe.ok).toBe(true);
      expect(admitProviderEndpointRequest(group).ok).toBe(false);
      if (probe.ok) probe.ticket.record("success");
      expect(providerEndpointHealthSnapshots()).toMatchObject([{ state: "closed", trips: 1 }]);
      expect(admitProviderEndpointRequest(group).ok).toBe(true);
    });

    it("re-opens with a fresh cooldown when the probe fails", () => {
      const c = clock();
      enableHealth(c);
      const model = makeModel();
      const group = groupFor(model);
      for (let i = 0; i < 3; i++) {
        const admission = admitProviderEndpointRequest(group);
        if (admission.ok) admission.ticket.record("failure");
      }
      c.advance(2_000);
      const probe = admitProviderEndpointRequest(group);
      expect(probe.ok).toBe(true);
      if (probe.ok) probe.ticket.record("failure");
      c.advance(1_999);
      expect(admitProviderEndpointRequest(group).ok).toBe(false);
      c.advance(1);
      expect(admitProviderEndpointRequest(group).ok).toBe(true);
      expect(providerEndpointHealthSnapshots()).toMatchObject([{ trips: 2 }]);
    });
  });

  describe("identity and export hygiene", () => {
    it("keeps breakers separate per endpoint and per account", () => {
      const c = clock();
      enableHealth(c);
      const accountA = makeModel({ token: "fixture-token-a" });
      // attachModelProviderRequestTransport stores metadata on a non-enumerable
      // symbol; derive the second account from the already-attached model so
      // the discriminator is preserved.
      const accountB = attachModelProviderRequestTransport(
        { ...makeModel(), id: "deepseek-v4-flash-alt" } as never,
        { auth: { mode: "authorization-bearer", token: "fixture-token-b" } },
      ) as unknown as Model;
      const otherProviderBase = makeModel({ baseUrl: "https://api.example.net/v1" });
      // Re-attach the auth transport explicitly: spreading a model drops the
      // non-enumerable symbol metadata that carries the account discriminator.
      const otherProvider = attachModelProviderRequestTransport(
        { ...otherProviderBase, provider: "other-provider" } as never,
        { auth: { mode: "authorization-bearer", token: "fixture-token-a" } },
      ) as unknown as Model;
      for (let i = 0; i < 3; i++) {
        const admission = admitProviderEndpointRequest(groupFor(accountA));
        if (admission.ok) admission.ticket.record("failure");
      }
      expect(admitProviderEndpointRequest(groupFor(accountA)).ok).toBe(false);
      const accountBAdmission = admitProviderEndpointRequest(groupFor(accountB));
      const otherEndpointAdmission = admitProviderEndpointRequest(groupFor(otherProvider));
      expect(accountBAdmission.ok).toBe(true);
      expect(otherEndpointAdmission.ok).toBe(true);
      const snapshots = providerEndpointHealthSnapshots();
      expect(snapshots).toHaveLength(3);
      expect(snapshots.filter((snapshot) => snapshot.state === "open")).toHaveLength(1);
      expect(
        snapshots.find((snapshot) => snapshot.endpoint === "https://api.example.net"),
      ).toMatchObject({ state: "closed", provider: "other-provider" });
    });

    it("never exports the credential or the account discriminator", () => {
      const c = clock();
      enableHealth(c);
      const model = makeModel({ token: "sk-fixture-secret-value" });
      const group = groupFor(model);
      for (let i = 0; i < 3; i++) {
        const admission = admitProviderEndpointRequest(group);
        if (admission.ok) admission.ticket.record("failure");
      }
      const refused = admitProviderEndpointRequest(group);
      const payload = JSON.stringify(providerEndpointHealthSnapshots()) + JSON.stringify(refused);
      expect(payload).not.toContain("sk-fixture-secret-value");
      expect(payload).not.toContain(group.account);
      expect(payload).not.toContain(group.groupId);
      expect(JSON.stringify(providerEndpointHealthSnapshots())).not.toContain("account");
    });
  });

  describe("guarded transport boundary", () => {
    it("counts 503 responses and fails fast without sending the next request", async () => {
      const c = clock();
      enableHealth(c, { maxFailuresPerWindow: 2 });
      const fetchImpl = guardedFetchFor(makeModel({ token: "fixture-token" }));
      const stub = stubResponses([
        new Response(null, { status: 503 }),
        new Response(null, { status: 503 }),
        new Response(null, { status: 200 }),
      ]);
      await fetchImpl(ENDPOINT, REQUEST_INIT);
      await fetchImpl(ENDPOINT, REQUEST_INIT);
      const blocked = await fetchImpl(ENDPOINT, REQUEST_INIT).then(
        () => null,
        (error) => error,
      );
      expect(blocked).toBeInstanceOf(ProviderEndpointCircuitOpenError);
      expect(stub.attemptsMade()).toBe(2);
      expect(providerEndpointHealthSnapshots()).toMatchObject([
        { state: "open", trips: 1, failuresInWindow: 2 },
      ]);
    });

    it("does not trip on a 401 storm", async () => {
      const c = clock();
      enableHealth(c, { maxFailuresPerWindow: 2 });
      const fetchImpl = guardedFetchFor(makeModel({ token: "fixture-token" }));
      const stub = stubResponses(
        Array.from({ length: 5 }, () => new Response(null, { status: 401 })),
      );
      for (let i = 0; i < 5; i++) {
        const response = await fetchImpl(ENDPOINT, REQUEST_INIT);
        expect(response.status).toBe(401);
      }
      expect(stub.attemptsMade()).toBe(5);
      expect(providerEndpointHealthSnapshots()).toMatchObject([
        { state: "closed", trips: 0, failuresInWindow: 0 },
      ]);
    });

    it("recovers through a single successful half-open probe", async () => {
      const c = clock();
      enableHealth(c, { maxFailuresPerWindow: 2 });
      const fetchImpl = guardedFetchFor(makeModel({ token: "fixture-token" }));
      const stub = stubResponses([
        new Response(null, { status: 503 }),
        new Response(null, { status: 503 }),
        new Response(null, { status: 200 }),
      ]);
      await fetchImpl(ENDPOINT, REQUEST_INIT);
      await fetchImpl(ENDPOINT, REQUEST_INIT);
      c.advance(2_000);
      const recovered = await fetchImpl(ENDPOINT, REQUEST_INIT);
      expect(recovered.status).toBe(200);
      expect(stub.attemptsMade()).toBe(3);
      expect(providerEndpointHealthSnapshots()).toMatchObject([{ state: "closed", trips: 1 }]);
    });

    it("does not double count a concurrency-budget refusal", async () => {
      const c = clock();
      enableHealth(c, { maxFailuresPerWindow: 2 });
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 5 } });
      const fetchImpl = guardedFetchFor(makeModel({ token: "fixture-token" }));
      const open = createOpenBody();
      const stub = stubResponses([open.response]);
      const first = await fetchImpl(ENDPOINT, REQUEST_INIT);
      expect(first.status).toBe(200);
      const refused = await fetchImpl(ENDPOINT, REQUEST_INIT).then(
        () => null,
        (error) => error,
      );
      expect(refused).toBeInstanceOf(ProviderOutboundOverloadedError);
      expect(stub.attemptsMade()).toBe(1);
      expect(providerEndpointHealthSnapshots()).toMatchObject([
        { state: "closed", trips: 0, failuresInWindow: 0 },
      ]);
      open.close();
      await first.body?.cancel().catch(() => undefined);
    });
  });
});
