import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { guardedFetchMock } = vi.hoisted(() => ({ guardedFetchMock: vi.fn() }));

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: guardedFetchMock,
  withTrustedEnvProxyGuardedFetchMode: (params: unknown) => params,
}));

import type { Model } from "../llm/types.js";
import {
  acquireProviderOutboundSlot,
  closeProviderOutboundBudget,
  configureProviderOutboundBudget,
  normalizeProviderEndpoint,
  PROVIDER_OUTBOUND_COVERAGE,
  PROVIDER_OUTBOUND_ENV,
  providerOutboundBudgetStats,
  ProviderOutboundOverloadedError,
  readProviderOutboundBudgetConfigFromEnv,
  resetProviderOutboundBudget,
  resolveProviderOutboundQuotaGroup,
} from "./provider-outbound-budget.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";
import { createRequestAttemptBudget, runWithRequestAttemptBudget } from "./request-attempt-budget.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";

const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const REQUEST_INIT = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
};

const MODEL_BASE = {
  name: "budget fixture",
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

/** A response whose body stays open until the test closes or cancels it. */
function createOpenBody(): {
  response: Response;
  close: () => void;
  wasCanceled: () => boolean;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
      next.enqueue(encoder.encode('data: {"ok":true}\n\n'));
    },
    cancel() {
      canceled = true;
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
    wasCanceled: () => canceled,
  };
}

type StubAttempt = { response: Response };

/** Stubs the guarded transport and records how many physical attempts were made. */
function stubAttempts(attempts: StubAttempt[]): {
  releases: string[];
  attemptsMade: () => number;
} {
  const releases: string[] = [];
  let index = 0;
  guardedFetchMock.mockImplementation(async () => {
    const attempt = attempts[index];
    if (!attempt) {
      throw new Error("unexpected extra outbound attempt: no stub response left");
    }
    index += 1;
    const attemptId = `attempt-${index}`;
    return {
      response: attempt.response,
      finalUrl: ENDPOINT,
      release: async () => {
        releases.push(attemptId);
      },
      refreshTimeout: undefined,
    };
  });
  return { releases, attemptsMade: () => index };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("provider outbound concurrency budget", () => {
  beforeEach(() => {
    resetProviderOutboundBudget();
    guardedFetchMock.mockReset();
  });

  afterEach(() => {
    resetProviderOutboundBudget();
    guardedFetchMock.mockReset();
  });

  describe("quota identity", () => {
    it("normalizes endpoint identity and treats default ports as equal", () => {
      expect(normalizeProviderEndpoint("HTTPS://API.DeepSeek.com:443/v1/")).toBe(
        "https://api.deepseek.com",
      );
      expect(normalizeProviderEndpoint("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080");
      expect(normalizeProviderEndpoint("not a url")).toBe("unparsed-endpoint");
      expect(normalizeProviderEndpoint(undefined)).toBe("unparsed-endpoint");
    });

    it("shares one group across model names on the same endpoint and credential", () => {
      const requestConfig = { auth: { configured: false, mode: "provider-default" } } as never;
      const flash = resolveProviderOutboundQuotaGroup({
        model: makeModel({ id: "deepseek-v4-flash" }),
        requestConfig,
      });
      const pro = resolveProviderOutboundQuotaGroup({
        model: makeModel({ id: "deepseek-v4-pro" }),
        requestConfig,
      });
      expect(flash.groupId).toBe(pro.groupId);
    });

    it("separates different credentials on the same endpoint and different endpoints", () => {
      const base = makeModel({ token: "sk-account-one-000000000000" });
      const other = makeModel({ token: "sk-account-two-000000000000" });
      const first = resolveProviderOutboundQuotaGroup({
        model: base,
        requestConfig: { auth: { configured: true, mode: "authorization-bearer", headerName: "Authorization", value: "sk-account-one-000000000000" } } as never,
      });
      const second = resolveProviderOutboundQuotaGroup({
        model: other,
        requestConfig: { auth: { configured: true, mode: "authorization-bearer", headerName: "Authorization", value: "sk-account-two-000000000000" } } as never,
      });
      expect(first.groupId).not.toBe(second.groupId);

      const differentEndpoint = resolveProviderOutboundQuotaGroup({
        model: makeModel({ baseUrl: "https://api.siliconflow.cn/v1" }),
        requestConfig: { auth: { configured: false, mode: "provider-default" } } as never,
      });
      expect(differentEndpoint.groupId).not.toBe(first.groupId);
    });

    it("never puts the raw credential into the group id", () => {
      const secret = "sk-super-secret-value-000000000000";
      const group = resolveProviderOutboundQuotaGroup({
        model: makeModel({ token: secret }),
        requestConfig: { auth: { configured: true, mode: "authorization-bearer", headerName: "Authorization", value: secret } } as never,
      });
      expect(group.groupId).not.toContain(secret);
      expect(group.account).not.toContain(secret);
      expect(group.account).toMatch(/^authorization-bearer:authorization:[a-f0-9]{16}$/u);
    });
  });

  describe("configuration surface", () => {
    it("is inert until an operator configures a limit", () => {
      expect(readProviderOutboundBudgetConfigFromEnv({})).toBeUndefined();
      expect(readProviderOutboundBudgetConfigFromEnv({ [PROVIDER_OUTBOUND_ENV.maxConcurrent]: "nope" })).toBeUndefined();
      expect(
        readProviderOutboundBudgetConfigFromEnv({
          [PROVIDER_OUTBOUND_ENV.maxConcurrent]: "3",
          [PROVIDER_OUTBOUND_ENV.maxQueue]: "5",
          [PROVIDER_OUTBOUND_ENV.queueTimeoutMs]: "1500",
          [PROVIDER_OUTBOUND_ENV.quotaGroupAliases]: "a=b, c=d ,broken",
        }),
      ).toEqual({
        limits: { maxConcurrent: 3, maxQueue: 5, queueTimeoutMs: 1500 },
        quotaGroupAliases: { a: "b", c: "d" },
      });
    });

    it("keeps the coverage table honest about what is not gated", () => {
      const chat = PROVIDER_OUTBOUND_COVERAGE.find((entry) => entry.surface.includes("chat"));
      const embeddings = PROVIDER_OUTBOUND_COVERAGE.find((entry) =>
        entry.surface.includes("embedding"),
      );
      expect(chat?.covered).toBe(true);
      expect(embeddings?.covered).toBe(false);
      expect(PROVIDER_OUTBOUND_COVERAGE.some((entry) => entry.covered === false)).toBe(true);
    });
  });

  describe("guarded transport boundary", () => {
    it("sends nothing while ungated and shares one slot when a limit is configured", async () => {
      const bodyA = createOpenBody();
      const bodyB = createOpenBody();
      const { attemptsMade } = stubAttempts([{ response: bodyA.response }, { response: bodyB.response }]);
      const flashFetch = guardedFetchFor(makeModel({ id: "deepseek-v4-flash" }));
      const proFetch = guardedFetchFor(makeModel({ id: "deepseek-v4-pro" }));

      // Ungated: both requests go out concurrently and no gate is allocated.
      const ungatedA = await flashFetch(ENDPOINT, REQUEST_INIT);
      const ungatedB = await proFetch(ENDPOINT, REQUEST_INIT);
      expect(attemptsMade()).toBe(2);
      expect(providerOutboundBudgetStats()).toHaveLength(0);
      await ungatedA.body?.cancel();
      await ungatedB.body?.cancel();

      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 5_000 } });

      const bodyC = createOpenBody();
      const bodyD = createOpenBody();
      const gatedAttempts = stubAttempts([{ response: bodyC.response }, { response: bodyD.response }]);
      const responseC = await flashFetch(ENDPOINT, REQUEST_INIT);
      expect(gatedAttempts.attemptsMade()).toBe(1);
      expect(providerOutboundBudgetStats()[0]).toMatchObject({
        active: 1,
        queued: 0,
        maxConcurrent: 1,
        peakActive: 1,
      });

      const pendingD = proFetch(ENDPOINT, REQUEST_INIT);
      await tick();
      expect(gatedAttempts.attemptsMade()).toBe(1);
      expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 1, queued: 1, peakQueued: 1 });

      await responseC.body?.cancel();
      const responseD = await pendingD;
      expect(gatedAttempts.attemptsMade()).toBe(2);
      expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 1, queued: 0, peakActive: 1 });

      await responseD.body?.cancel();
      await vi.waitFor(() => {
        expect(providerOutboundBudgetStats()[0]).toMatchObject({
          active: 0,
          queued: 0,
          admitted: 2,
          completed: 2,
          rejectedOverloaded: 0,
        });
      });
    });

    it("rejects an over-capacity request without sending it to the provider", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 5_000 } });
      const bodyA = createOpenBody();
      const bodyB = createOpenBody();
      const { attemptsMade } = stubAttempts([{ response: bodyA.response }, { response: bodyB.response }]);
      const guardedFetch = guardedFetchFor(makeModel());

      const responseA = await guardedFetch(ENDPOINT, REQUEST_INIT);
      const pendingB = guardedFetch(ENDPOINT, REQUEST_INIT);
      await tick();

      const rejection = await guardedFetch(ENDPOINT, REQUEST_INIT).catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(ProviderOutboundOverloadedError);
      expect(rejection).toMatchObject({
        code: "E_PROVIDER_OUTBOUND_OVERLOADED",
        reason: "overloaded",
        maxConcurrent: 1,
        maxQueue: 1,
      });
      // The refused request never reached the transport, and it is classified as an overload
      // for the existing failover classifier (message carries the "overloaded" keyword).
      expect(attemptsMade()).toBe(1);
      expect((rejection as Error).message).toContain("overloaded");
      expect(providerOutboundBudgetStats()[0].rejectedOverloaded).toBe(1);

      await responseA.body?.cancel();
      const responseB = await pendingB;
      await responseB.body?.cancel();
      expect(attemptsMade()).toBe(2);
    });

    it("releases only when the guarded request is confirmed finished", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 5_000 } });
      const body = createOpenBody();
      const { releases } = stubAttempts([{ response: body.response }]);
      const guardedFetch = guardedFetchFor(makeModel());

      const response = await guardedFetch(ENDPOINT, REQUEST_INIT);
      // Reading nothing and waiting does not release: there is no timer-based false release.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(releases).toEqual([]);
      expect(providerOutboundBudgetStats()[0].active).toBe(1);
      expect(body.wasCanceled()).toBe(false);

      await response.body?.cancel();
      await vi.waitFor(() => {
        expect(releases).toEqual(["attempt-1"]);
        expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 0, completed: 1 });
      });
    });

    it("releases the slot when the transport fails and re-admits the retry", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 5_000 } });
      const guardedFetch = guardedFetchFor(makeModel());

      guardedFetchMock.mockRejectedValueOnce(new Error("network down"));
      await expect(guardedFetch(ENDPOINT, REQUEST_INIT)).rejects.toThrow("network down");
      expect(providerOutboundBudgetStats()[0]).toMatchObject({
        active: 0,
        completed: 1,
        admitted: 1,
      });

      const body = createOpenBody();
      stubAttempts([{ response: body.response }]);
      const response = await guardedFetch(ENDPOINT, REQUEST_INIT);
      expect(response.status).toBe(200);
      expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 1, admitted: 2 });
      await response.body?.cancel();
      await vi.waitFor(() => expect(providerOutboundBudgetStats()[0].active).toBe(0));
    });

    it("does not block a different account or a different endpoint", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 2_000 } });
      const bodies = [createOpenBody(), createOpenBody(), createOpenBody(), createOpenBody()];
      const { attemptsMade } = stubAttempts(bodies.map((body) => ({ response: body.response })));

      const firstAccount = guardedFetchFor(makeModel({ token: "sk-account-one-000000000000" }));
      const secondAccount = guardedFetchFor(makeModel({ token: "sk-account-two-000000000000" }));
      const otherEndpoint = guardedFetchFor(makeModel({ baseUrl: "https://api.siliconflow.cn/v1" }));

      const first = await firstAccount(ENDPOINT, REQUEST_INIT);
      // Same endpoint, different credential: independent budget.
      const second = await secondAccount(ENDPOINT, REQUEST_INIT);
      // Different endpoint, same credential shape: independent budget.
      const third = await otherEndpoint(ENDPOINT, REQUEST_INIT);
      expect(attemptsMade()).toBe(3);

      // A second request inside the saturated first group is still refused.
      const saturated = await firstAccount(ENDPOINT, REQUEST_INIT).catch((error: unknown) => error);
      expect(saturated).toBeInstanceOf(ProviderOutboundOverloadedError);
      expect(providerOutboundBudgetStats()).toHaveLength(3);

      await first.body?.cancel();
      await second.body?.cancel();
      await third.body?.cancel();
    });

    it("maps two derived groups onto one quota group through an explicit alias", async () => {
      const primary = resolveProviderOutboundQuotaGroup({
        model: makeModel({ baseUrl: "https://api.deepseek.com/v1" }),
        requestConfig: { auth: { configured: false, mode: "provider-default" } } as never,
      });
      const secondary = resolveProviderOutboundQuotaGroup({
        model: makeModel({ baseUrl: "https://api.siliconflow.cn/v1" }),
        requestConfig: { auth: { configured: false, mode: "provider-default" } } as never,
      });
      expect(primary.groupId).not.toBe(secondary.groupId);

      configureProviderOutboundBudget({
        limits: { maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 2_000 },
        quotaGroupAliases: { [secondary.groupId]: primary.groupId },
      });
      const bodies = [createOpenBody(), createOpenBody()];
      stubAttempts(bodies.map((body) => ({ response: body.response })));

      const heldGroup = await acquireProviderOutboundSlot({ group: primary });
      expect(heldGroup.ok).toBe(true);

      const aliased = await acquireProviderOutboundSlot({ group: secondary });
      expect(aliased.ok).toBe(false);
      if (!aliased.ok) {
        expect(aliased.reason).toBe("overloaded");
        expect(aliased.groupId).toBe(primary.groupId);
      }
      expect(providerOutboundBudgetStats()).toHaveLength(1);

      if (heldGroup.ok) {
        heldGroup.slot.release();
      }
      const afterRelease = await acquireProviderOutboundSlot({ group: secondary });
      expect(afterRelease.ok).toBe(true);
      if (afterRelease.ok) {
        afterRelease.slot.release();
      }
    });

    it("leaves no slot behind when a queued caller is aborted", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 4, queueTimeoutMs: 5_000 } });
      const body = createOpenBody();
      const { attemptsMade } = stubAttempts([{ response: body.response }]);
      const group = resolveProviderOutboundQuotaGroup({
        model: makeModel(),
        requestConfig: { auth: { configured: false, mode: "provider-default" } } as never,
      });

      const held = await acquireProviderOutboundSlot({ group });
      expect(held.ok).toBe(true);

      const controller = new AbortController();
      const pending = acquireProviderOutboundSlot({ group, signal: controller.signal });
      await tick();
      controller.abort();
      const aborted = await pending;
      expect(aborted.ok).toBe(false);
      if (!aborted.ok) {
        expect(aborted.reason).toBe("aborted");
      }

      if (held.ok) {
        held.slot.release();
      }
      await vi.waitFor(() => {
        expect(providerOutboundBudgetStats()[0]).toMatchObject({
          active: 0,
          queued: 0,
          admitted: 1,
          completed: 1,
          rejectedAborted: 1,
          doubleRelease: 0,
        });
      });
      expect(attemptsMade()).toBe(0);
    });
  });

  describe("logical request budget", () => {
    it("records a physical provider attempt inside an ambient logical request", async () => {
      const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 1 });
      const { response } = createOpenBody();
      guardedFetchMock.mockResolvedValueOnce({ response });
      const guardedFetch = guardedFetchFor(makeModel());
      await runWithRequestAttemptBudget(budget, async () => {
        await guardedFetch(ENDPOINT, REQUEST_INIT);
      });
      expect(budget.snapshot()).toMatchObject({
        used: 1,
        remaining: 0,
        attempts: [{ physicalAttempt: 1, layer: "provider-transport" }],
      });
    });

    it("fails closed before sending when the ambient budget is already exhausted", async () => {
      const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 1 });
      budget.recordAttempt({ layer: "sdk", outcome: "failure" });
      const guardedFetch = guardedFetchFor(makeModel());
      await expect(
        runWithRequestAttemptBudget(budget, async () => {
          await guardedFetch(ENDPOINT, REQUEST_INIT);
        }),
      ).rejects.toThrow("request attempt budget exhausted");
      expect(guardedFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("shutdown and fairness", () => {
    it("rejects queued waiters on shutdown and leaves no slot behind", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 4, queueTimeoutMs: 30_000 } });
      const group = resolveProviderOutboundQuotaGroup({
        model: makeModel(),
        requestConfig: { auth: { configured: false, mode: "provider-default" } } as never,
      });
      const held = await acquireProviderOutboundSlot({ group });
      expect(held.ok).toBe(true);
      const queued = acquireProviderOutboundSlot({ group });
      await tick();

      closeProviderOutboundBudget();
      const outcome = await queued;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe("aborted");
      }
      // The holder's own lease stays accounted for; nothing was handed out after close.
      expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 1, queued: 0, closed: true });
      if (held.ok) {
        held.slot.release();
      }
      expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 0, completed: 1, doubleRelease: 0 });
      const afterClose = await acquireProviderOutboundSlot({ group });
      expect(afterClose.ok).toBe(false);
    });

    it("does not starve a waiter when the holder keeps running", async () => {
      configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 5_000 } });
      const group = resolveProviderOutboundQuotaGroup({
        model: makeModel(),
        requestConfig: { auth: { configured: false, mode: "provider-default" } } as never,
      });
      const background = await acquireProviderOutboundSlot({ group });
      const foreground = acquireProviderOutboundSlot({ group });
      await tick();
      if (background.ok) {
        background.slot.release();
      }
      const foregroundOutcome = await foreground;
      expect(foregroundOutcome.ok).toBe(true);
      if (foregroundOutcome.ok) {
        foregroundOutcome.slot.release();
      }
      expect(providerOutboundBudgetStats()[0]).toMatchObject({
        active: 0,
        queued: 0,
        admitted: 2,
        completed: 2,
        rejectedQueueTimeout: 0,
      });
    });
  });
});
