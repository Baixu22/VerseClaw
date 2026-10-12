/**
 * Upstream protocol adaptation probe — cache payload and prompt-cache-boundary evidence.
 *
 * These are **characterization probes**, not feature tests. They record what the
 * transport/policy code actually sends for each upstream protocol, so the
 * protocol-layer gaps found during the cache survey are measured rather than inferred.
 *
 * Unnamed invariants here assert *current* behaviour on purpose. When a probe is
 * implemented, update the corresponding `GAP(...)` assertion in the same change set —
 * that update is the evidence the change landed. The `PROBE A` suite was flipped that
 * way by `harness/specs/tasks/openai-prompt-cache-write-point.md`, which added the
 * OpenAI-family `prompt_cache_key` / `prompt_cache_retention` write point.
 *
 * No network is used: `fetch` is stubbed and the captured request body is the exact
 * JSON the provider SDK would have sent; `options.onPayload` is not a valid
 * observation point for the Responses transports, which invoke it before the final
 * payload finalization.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model } from "../llm/types.js";
import {
  applyAnthropicPayloadPolicyToParams,
  resolveAnthropicPayloadPolicy,
} from "./anthropic-payload-policy.js";
import {
  createOpenAICompletionsTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
} from "./openai-transport-stream.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";
import { createBoundaryAwareStreamFnForModel } from "./provider-transport-stream.js";
import {
  OutboundCacheBoundaryLeakError,
  SYSTEM_PROMPT_CACHE_BOUNDARY,
  enforceNoOutboundCacheBoundary,
  prependSystemPromptAdditionAfterCacheBoundary,
  stripSystemPromptCacheBoundary,
} from "./system-prompt-cache-boundary.js";
import { createOpenAIResponsesContextManagementWrapper } from "../llm/providers/stream-wrappers/openai.js";
import { resolveCacheRetention } from "./embedded-agent-runner/prompt-cache-retention.js";
import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import type { StreamFn } from "./runtime/index.js";

vi.mock("../plugins/provider-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProviderStreamFn: vi.fn(),
}));

const FIXTURE_API_KEY = "fixture-key";
const FIXTURE_CACHE_KEY = "openclaw-webchat-fixture-digest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(resolveProviderStreamFn).mockReset();
});


type ProbeModelOverrides = {
  api?: string;
  baseUrl?: string;
  provider?: string;
  compat?: Record<string, unknown>;
};

function makeModel(overrides: ProbeModelOverrides = {}): Model {
  return attachModelProviderRequestTransport(
    {
      id: "fixture-model",
      name: "fixture-model",
      provider: overrides.provider ?? "openai",
      api: overrides.api ?? "openai-responses",
      baseUrl: overrides.baseUrl ?? "https://api.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 1024,
      ...(overrides.compat ? { compat: overrides.compat } : {}),
    } as Model,
    { allowPrivateNetwork: true },
  );
}

function makeContext(systemPrompt?: string) {
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: [{ role: "user" as const, content: "synthetic probe", timestamp: 1 }],
  };
}

/**
 * Calls a stream fn and captures the JSON body the provider SDK actually sends.
 *
 * The observation point is the stubbed `fetch`, not `options.onPayload`: the
 * Responses transports invoke `onPayload` before the final payload finalization, so a
 * callback-based capture cannot see fields added at the outbound boundary.
 */
async function captureOutboundPayload(params: {
  streamFn: ReturnType<typeof createOpenAIResponsesTransportStreamFn>;
  model: Model;
  context: ReturnType<typeof makeContext>;
  options?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      let text: string | undefined;
      if (typeof init?.body === "string") {
        text = init.body;
      } else if (typeof Request !== "undefined" && input instanceof Request) {
        try {
          text = await input.clone().text();
        } catch {
          text = undefined;
        }
      }
      if (text) {
        try {
          bodies.push(JSON.parse(text) as Record<string, unknown>);
        } catch {
          // non-JSON body: not a provider payload
        }
      }
      return new Response('data: {"type":"response.completed","response":{"id":"fixture"}}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );

  const stream = await params.streamFn(params.model, params.context, {
    apiKey: FIXTURE_API_KEY,
    maxTokens: 64,
    ...params.options,
  });
  try {
    for await (const _event of stream as AsyncIterable<unknown>) {
      // drain
    }
  } catch {
    // transport failure after the request body is built is irrelevant to this probe
  }

  expect(bodies.length).toBeGreaterThan(0);
  return bodies[0]!;
}

describe("PROBE A: OpenAI Responses outbound cache payload", () => {
  it("emits prompt_cache_key for a known native OpenAI endpoint", async () => {
    const base = createOpenAIResponsesTransportStreamFn();
    // Production composes the payload-policy wrapper in front of the transport.
    const streamFn = createOpenAIResponsesContextManagementWrapper(base, {});

    const payload = await captureOutboundPayload({
      streamFn,
      model: makeModel(),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY },
    });

    expect(payload.model).toBe("fixture-model");
    expect(payload.stream).toBe(true);
    // The derived routing key now reaches the wire, so related requests can share a cache.
    expect(payload.prompt_cache_key).toBe(FIXTURE_CACHE_KEY);
    // Retention stays unset without an explicit endpoint opt-in (fail closed).
    expect(payload.prompt_cache_retention).toBeUndefined();
    expect(payload.prompt_cache_options).toBeUndefined();
  });

  it("emits the long-retention field on a trusted endpoint, and for a declared proxy opt-in", async () => {
    const streamFn = createOpenAIResponsesContextManagementWrapper(
      createOpenAIResponsesTransportStreamFn(),
      {},
    );

    // compat unset: documented default (true) applies to a known native route.
    const nativePayload = await captureOutboundPayload({
      streamFn,
      model: makeModel(),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY, cacheRetention: "long" },
    });
    expect(nativePayload.prompt_cache_key).toBe(FIXTURE_CACHE_KEY);
    expect(nativePayload.prompt_cache_retention).toBe("24h");

    // A proxy whose operator declares retention support gets the field too.
    const optedInPayload = await captureOutboundPayload({
      streamFn,
      model: makeModel({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        compat: { supportsPromptCacheKey: true, supportsLongCacheRetention: true },
      }),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY, cacheRetention: "long" },
    });
    expect(optedInPayload.prompt_cache_retention).toBe("24h");
  });

  it("an explicit refusal still suppresses the lifetime field on a native endpoint", async () => {
    const streamFn = createOpenAIResponsesContextManagementWrapper(
      createOpenAIResponsesTransportStreamFn(),
      {},
    );

    const payload = await captureOutboundPayload({
      streamFn,
      model: makeModel({ compat: { supportsLongCacheRetention: false } }),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY, cacheRetention: "long" },
    });

    expect(payload.prompt_cache_key).toBe(FIXTURE_CACHE_KEY);
    expect(payload.prompt_cache_retention).toBeUndefined();
  });

  it("the retention intent survives the runner-side eligibility gate for OpenAI lanes", () => {
    // Before this write point the gate dropped an explicit cacheRetention for every
    // OpenAI-family lane, so no downstream transport could ever emit the field.
    expect(
      resolveCacheRetention(
        { cacheRetention: "long" },
        "openai",
        "openai-responses",
        "gpt-5.1",
        false,
      ),
    ).toBe("long");
    expect(
      resolveCacheRetention({ cacheRetention: "long" }, "openai", "openai-completions", undefined, false),
    ).toBe("long");
    // No explicit intent, no invented retention.
    expect(resolveCacheRetention({}, "openai", "openai-responses", "gpt-5.1", false)).toBeUndefined();
    // Anthropic lanes are unchanged.
    expect(resolveCacheRetention({}, "anthropic", "anthropic-messages", "claude-sonnet-4", false)).toBe(
      "short",
    );
    expect(
      resolveCacheRetention({ cacheRetention: "long" }, "anthropic", "anthropic-messages", undefined, false),
    ).toBe("long");
  });

  it("never emits the lifetime field for a short or absent retention request", async () => {
    const streamFn = createOpenAIResponsesContextManagementWrapper(
      createOpenAIResponsesTransportStreamFn(),
      {},
    );

    for (const cacheRetention of ["short", "none", undefined] as const) {
      const payload = await captureOutboundPayload({
        streamFn,
        model: makeModel({ compat: { supportsLongCacheRetention: true } }),
        context: makeContext(),
        options: { promptCacheKey: FIXTURE_CACHE_KEY, ...(cacheRetention ? { cacheRetention } : {}) },
      });
      expect(payload.prompt_cache_retention, `cacheRetention=${cacheRetention}`).toBeUndefined();
    }
  });

  it("fails closed on proxy-like endpoints and on an explicit refusal", async () => {
    const streamFn = createOpenAIResponsesContextManagementWrapper(
      createOpenAIResponsesTransportStreamFn(),
      {},
    );

    // Unknown OpenAI-compatible endpoint: no key, so a proxy that rejects the field
    // keeps working.
    const proxyPayload = await captureOutboundPayload({
      streamFn,
      model: makeModel({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY, cacheRetention: "long" },
    });
    expect(proxyPayload).not.toHaveProperty("prompt_cache_key");
    expect(proxyPayload).not.toHaveProperty("prompt_cache_retention");
    expect(proxyPayload).not.toHaveProperty("prompt_cache_options");

    // Explicit refusal wins even on a native endpoint.
    const refusedPayload = await captureOutboundPayload({
      streamFn,
      model: makeModel({ compat: { supportsPromptCacheKey: false } }),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY },
    });
    expect(refusedPayload).not.toHaveProperty("prompt_cache_key");
  });

  it("an explicit opt-in covers OpenAI-compatible proxies that forward the field", async () => {
    const streamFn = createOpenAIResponsesContextManagementWrapper(
      createOpenAIResponsesTransportStreamFn(),
      {},
    );

    const payload = await captureOutboundPayload({
      streamFn,
      model: makeModel({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        compat: { supportsPromptCacheKey: true },
      }),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY },
    });

    expect(payload.prompt_cache_key).toBe(FIXTURE_CACHE_KEY);
  });

  it("Chat Completions transport emits the same fields through the shared write point", async () => {
    const payload = await captureOutboundPayload({
      streamFn: createOpenAICompletionsTransportStreamFn(),
      model: makeModel({ api: "openai-completions" }),
      context: makeContext(),
      options: { promptCacheKey: FIXTURE_CACHE_KEY },
    });

    expect(payload.model).toBe("fixture-model");
    expect(payload.prompt_cache_key).toBe(FIXTURE_CACHE_KEY);
  });
});

describe("PROBE C: prompt-cache boundary leakage", () => {
  it("no boundary marker reaches the OpenAI request body (structural projection)", async () => {
    const systemPrompt = `stable system prefix${SYSTEM_PROMPT_CACHE_BOUNDARY}dynamic suffix`;

    const payload = await captureOutboundPayload({
      streamFn: createOpenAIResponsesTransportStreamFn(),
      model: makeModel(),
      context: makeContext(systemPrompt),
      options: { promptCacheKey: FIXTURE_CACHE_KEY },
    });

    const serialized = JSON.stringify(payload);
    // Inverted by harness/specs/tasks/prompt-cache-boundary-outbound-gate.md: the marker
    // used to reach this wire, which perturbed the provider cache prefix. The transport
    // now projects the boundary away while keeping the stable prefix byte-identical, so
    // the same prefix keeps hitting the cache across turns.
    expect(serialized).not.toContain("OPENCLAW_CACHE_BOUNDARY");
    const systemText = (payload.input as Array<{ content?: Array<{ text?: string }> }>)[0]?.content?.[0]
      ?.text;
    expect(systemText).toBe("stable system prefix\n\ndynamic suffix");
  });

  it("the production transport factory ships no marker for the OpenAI family", async () => {
    // `createBoundaryAwareStreamFnForModel` is the factory the embedded runner calls
    // (embedded-agent-runner/stream-resolution.ts), i.e. the real path for a boundary
    // bearing system prompt. Inverted by
    // harness/specs/tasks/prompt-cache-boundary-outbound-gate.md.
    const streamFn = createBoundaryAwareStreamFnForModel(makeModel());
    expect(streamFn, "factory must resolve for openai-responses").toBeDefined();

    const payload = await captureOutboundPayload({
      streamFn: streamFn!,
      model: makeModel(),
      context: makeContext(`stable prefix${SYSTEM_PROMPT_CACHE_BOUNDARY}dynamic suffix`),
      options: { promptCacheKey: FIXTURE_CACHE_KEY },
    });

    expect(JSON.stringify(payload)).not.toContain("OPENCLAW_CACHE_BOUNDARY");
  });

  it("hook-added system-prompt text stays after the boundary, and the cached prefix is unchanged", async () => {
    // expectedUserBehavior: an injected reminder must not invalidate the cached prefix.
    const basePrompt = `stable prefix${SYSTEM_PROMPT_CACHE_BOUNDARY}`;
    const withAddition = prependSystemPromptAdditionAfterCacheBoundary({
      systemPrompt: basePrompt,
      systemPromptAddition: "hook reminder for this turn",
    });

    const base = await captureOutboundPayload({
      streamFn: createOpenAIResponsesTransportStreamFn(),
      model: makeModel(),
      context: makeContext(basePrompt),
    });
    const added = await captureOutboundPayload({
      streamFn: createOpenAIResponsesTransportStreamFn(),
      model: makeModel(),
      context: makeContext(withAddition),
    });

    const textOf = (payload: Record<string, unknown>): string =>
      (payload.input as Array<{ content?: Array<{ text?: string }> }>)[0]?.content?.[0]?.text ?? "";

    expect(textOf(base)).toBe("stable prefix");
    // The dynamic addition is appended, so the stable prefix stays a prefix (cacheable)
    // and the addition itself is what the provider sees as new.
    expect(textOf(added)).toBe("stable prefix\n\nhook reminder for this turn");
    expect(textOf(added).startsWith(textOf(base))).toBe(true);
  });

  it("provider-owned protocols are handed a boundary-free system prompt (google/bedrock)", async () => {
    // google-generative-ai / google-vertex / bedrock-converse-stream are plugin-owned:
    // the runtime does not build their payload bytes and so cannot gate them after the
    // fact. It can still avoid handing over an internal marker, and that hand-over is
    // what this case pins (harness/specs/tasks/prompt-cache-boundary-outbound-gate.md).
    const seen: Array<{ systemPrompt?: string }> = [];
    const fakeProviderTransport = (async (_model: unknown, context: { systemPrompt?: string }) => {
      seen.push(context);
      return { markerHandedOver: true } as never;
    }) as unknown as StreamFn;
    vi.mocked(resolveProviderStreamFn).mockReturnValue(fakeProviderTransport);

    const streamFn = createBoundaryAwareStreamFnForModel(makeModel({ api: "google-generative-ai" }));
    expect(streamFn, "factory must resolve for google-generative-ai").toBeDefined();

    await streamFn!(
      makeModel({ api: "google-generative-ai" }),
      makeContext(`stable prefix${SYSTEM_PROMPT_CACHE_BOUNDARY}dynamic suffix`) as never,
      {} as never,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.systemPrompt).toBe("stable prefix\n\ndynamic suffix");
  });

  it("the outbound gate fails closed instead of shipping a marker it cannot scrub", async () => {
    // The gate scrubs every string in the payload graph and then verifies. A marker in a
    // position the scrubber cannot repair (here: an object key, which is not payload
    // text) must throw rather than leave the process.
    const doctored = { model: "fixture-model", [SYSTEM_PROMPT_CACHE_BOUNDARY]: "marker as a key" };

    expect(() => enforceNoOutboundCacheBoundary(doctored, "probe")).toThrow(
      OutboundCacheBoundaryLeakError,
    );
    // And the scrubbable case is repaired silently, reported by count.
    expect(
      enforceNoOutboundCacheBoundary(
        { instructions: `a${SYSTEM_PROMPT_CACHE_BOUNDARY}b` },
        "probe",
      ),
    ).toBe(1);
  });

  it("foreign reasoning blocks are dropped by the OpenAI transport block mapping", async () => {
    // Measured counterpart to the projection probe B: the replay pipeline keeps a
    // foreign-family thinking block in the internal message, and the transport's
    // block mapper is what actually removes it. Both halves are asserted so the
    // drop is attributed to the right layer.
    const messages = [
      { role: "user" as const, content: "q", timestamp: 1 },
      {
        role: "assistant" as const,
        timestamp: 2,
        content: [
          {
            type: "thinking",
            thinking: "foreign reasoning",
            thinkingSignature: "foreign-anthropic-signature",
          },
          { type: "text", text: "answer" },
        ],
      },
      { role: "user" as const, content: "next", timestamp: 3 },
    ];

    const responsesPayload = await captureOutboundPayload({
      streamFn: createOpenAIResponsesTransportStreamFn(),
      model: makeModel(),
      context: { messages } as never,
    });
    const chatPayload = await captureOutboundPayload({
      streamFn: createOpenAICompletionsTransportStreamFn(),
      model: makeModel({ api: "openai-completions" }),
      context: { messages } as never,
    });

    for (const payload of [responsesPayload, chatPayload]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("foreign-anthropic-signature");
      expect(serialized).not.toContain("foreign reasoning");
      // The portable sibling survives in both protocols.
      expect(serialized).toContain("answer");
    }
  });

  it("Anthropic policy splits the boundary and never emits the sentinel", () => {
    const policy = resolveAnthropicPayloadPolicy({
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      enableCacheControl: true,
      cacheRetention: "short",
    });
    expect(policy.cacheControl).toEqual({ type: "ephemeral" });

    const payload: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: `stable system prefix${SYSTEM_PROMPT_CACHE_BOUNDARY}dynamic suffix`,
        },
      ],
      messages: [{ role: "user", content: "synthetic probe" }],
    };

    applyAnthropicPayloadPolicyToParams(payload, policy);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("OPENCLAW_CACHE_BOUNDARY");

    const system = payload.system as Array<Record<string, unknown>>;
    // Stable prefix keeps the cache marker, dynamic suffix is emitted uncached.
    expect(system).toHaveLength(2);
    expect(system[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(system[1]).not.toHaveProperty("cache_control");
    expect(system[0]!.text).toBe("stable system prefix");
    expect(system[1]!.text).toBe("dynamic suffix");
  });

  it("helper strips every boundary occurrence when one prompt carries several", () => {
    const text = `a${SYSTEM_PROMPT_CACHE_BOUNDARY}b${SYSTEM_PROMPT_CACHE_BOUNDARY}c`;
    expect(stripSystemPromptCacheBoundary(text)).not.toContain("OPENCLAW_CACHE_BOUNDARY");
  });
});
