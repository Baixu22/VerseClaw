/**
 * Upstream protocol capability descriptor probe.
 *
 * Pins the invariant from harness/specs/rules/outbound-protocol-payload-consistency.md:
 * one shared capability decision per route, so the emit point and the strip point cannot
 * disagree. The routes are exercised through the real resolvers
 * (`resolveProviderRequestCapabilities`, `resolveOpenAIResponsesPayloadPolicy`,
 * `resolveOpenAIPromptCachePayloadFields`), not through the descriptor alone, because the
 * defect this covers was two call sites computing the same fact differently.
 *
 * No network, no credentials: every assertion is about the decided payload fields.
 *
 * Spec: harness/specs/tasks/upstream-protocol-capability-descriptor.md
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model } from "../llm/types.js";
import { resolveOpenAIPromptCachePayloadFields } from "./openai-prompt-cache-payload.js";
import { supportsGptParallelToolCallsPayload } from "./provider-api-families.js";
import { resolveOpenAIResponsesPayloadPolicy } from "./openai-responses-payload-policy.js";
import { resolveProviderRequestCapabilities } from "./provider-attribution.js";
import {
  isOpenAIFamilyApi,
  isOpenAIResponsesApi,
  OPENAI_RESPONSES_API_IDS,
  resolveUpstreamPromptCacheFields,
  resolveUpstreamProtocolKind,
} from "./upstream-protocol-capabilities.js";

const NATIVE_OPENAI_BASE_URL = "https://api.openai.com/v1";
const PROXY_BASE_URL = "https://llm-gateway.internal.example/v1";

/** Public api id and the in-tree transport id `prepareTransportAwareSimpleModel` rewrites it to. */
const RESPONSES_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["openai-responses", "openclaw-openai-responses-transport"],
  ["azure-openai-responses", "openclaw-azure-openai-responses-transport"],
  // No alias: the Codex lane keeps its public id.
  ["openai-chatgpt-responses", "openai-chatgpt-responses"],
] as const;

const COMPLETIONS_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["openai-completions", "openclaw-openai-completions-transport"],
] as const;

function makeModel(api: string, overrides: { baseUrl?: string; compat?: unknown; provider?: string } = {}): Model {
  return {
    provider: overrides.provider ?? "openai",
    api,
    id: "gpt-5.1",
    baseUrl: overrides.baseUrl ?? NATIVE_OPENAI_BASE_URL,
    compat: overrides.compat,
  } as unknown as Model;
}

function decide(api: string, compat: unknown, baseUrl: string) {
  const model = makeModel(api, { baseUrl, compat });
  const capabilities = resolveProviderRequestCapabilities({
    provider: model.provider,
    api,
    baseUrl,
    capability: "llm",
    transport: "stream",
    compat,
  });
  const policy = resolveOpenAIResponsesPayloadPolicy(model, { enablePromptCacheStripping: true });
  const emitted = resolveOpenAIPromptCachePayloadFields({
    model,
    options: { promptCacheKey: "session-digest", cacheRetention: "long" } as never,
  });
  return { capabilities, policy, emitted };
}

describe("protocol kind is spelled once", () => {
  it("classifies every public api id and its in-tree transport alias identically", () => {
    for (const [publicApi, aliasApi] of [...RESPONSES_ROUTES, ...COMPLETIONS_ROUTES]) {
      const expected = publicApi === "openai-completions" ? "openai-completions" : "openai-responses";
      expect(resolveUpstreamProtocolKind(publicApi), publicApi).toBe(expected);
      expect(resolveUpstreamProtocolKind(aliasApi), aliasApi).toBe(expected);
    }
    expect(resolveUpstreamProtocolKind("anthropic-messages")).toBe("anthropic-messages");
    expect(resolveUpstreamProtocolKind("google-generative-ai")).toBe("google-generative-ai");
    expect(resolveUpstreamProtocolKind("bedrock-converse-stream")).toBe("unknown");
    expect(resolveUpstreamProtocolKind(undefined)).toBe("unknown");
  });

  it("keeps the api ids that need classification in the descriptor, not in a second set", () => {
    const agentsDir = fileURLToPath(new URL(".", import.meta.url));
    const OPENAI_IDS = [
      "openai-responses",
      "openai-completions",
      "openai-chatgpt-responses",
      "azure-openai-responses",
      "openclaw-openai-responses-transport",
      "openclaw-openai-completions-transport",
      "openclaw-azure-openai-responses-transport",
    ];
    // Two legitimate neighbours are excluded on purpose:
    //   - a cross-protocol behavior list ("these turn shapes need the retry guard") also
    //     names anthropic and bedrock, so FOREIGN_IDS excludes it;
    //   - a per-stream-shape list ("these Responses variants need tool-call repair") is a
    //     deliberate subset that does not name the base `openai-responses` id, so the
    //     TARGET_ID requirement excludes it.
    const TARGET_ID = "openai-responses";
    const FOREIGN_IDS = [
      "anthropic-messages",
      "google-generative-ai",
      "google-vertex",
      "bedrock-converse-stream",
    ];
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          visit(path);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        if (entry.name === "upstream-protocol-capabilities.ts") continue;
        if (entry.name === "provider-transport-stream.ts") continue; // owns the alias map
        const source = readFileSync(path, "utf8");
        for (const literal of source.match(/new Set\(\[[\s\S]*?\]\)/g) ?? []) {
          const openaiHits = OPENAI_IDS.filter((id) => literal.includes(`"${id}"`)).length;
          const foreignHit = FOREIGN_IDS.some((id) => literal.includes(`"${id}"`));
          const enumeratesTheProtocol = literal.includes(`"${TARGET_ID}"`);
          if (openaiHits >= 2 && enumeratesTheProtocol && !foreignHit) {
            offenders.push(`${entry.name}: ${literal.replace(/\s+/g, " ").slice(0, 80)}`);
          }
        }
      }
    };
    visit(agentsDir);
    expect(offenders).toEqual([]);
  });

  it("keeps the GPT payload predicate on the descriptor instead of a public-id list", () => {
    for (const [publicApi, aliasApi] of [...RESPONSES_ROUTES, ...COMPLETIONS_ROUTES]) {
      expect(supportsGptParallelToolCallsPayload(publicApi), publicApi).toBe(true);
      expect(supportsGptParallelToolCallsPayload(aliasApi), aliasApi).toBe(true);
    }
    expect(supportsGptParallelToolCallsPayload("anthropic-messages")).toBe(false);
    expect(supportsGptParallelToolCallsPayload("bedrock-converse-stream")).toBe(false);
  });

  it("keeps the public and alias spelling cache-eligible together", () => {
    for (const [publicApi, aliasApi] of [...RESPONSES_ROUTES, ...COMPLETIONS_ROUTES]) {
      expect(isOpenAIFamilyApi(publicApi), publicApi).toBe(true);
      expect(isOpenAIFamilyApi(aliasApi), aliasApi).toBe(true);
    }
    expect(isOpenAIFamilyApi("google-generative-ai")).toBe(false);
    expect(isOpenAIFamilyApi("anthropic-messages")).toBe(false);
    for (const api of OPENAI_RESPONSES_API_IDS) {
      expect(isOpenAIResponsesApi(api), api).toBe(true);
    }
  });
});

describe("emit and strip cannot disagree on the same route", () => {
  const compatMatrix: Array<[string, unknown]> = [
    ["no compat", undefined],
    ["routing key opt-in", { supportsPromptCacheKey: true }],
    ["routing key refusal", { supportsPromptCacheKey: false }],
    ["refusal plus long retention opt-in", { supportsPromptCacheKey: false, supportsLongCacheRetention: true }],
    ["long retention opt-in", { supportsLongCacheRetention: true }],
    ["long retention refusal", { supportsLongCacheRetention: false }],
  ];

  it("agrees for every api spelling and endpoint class", () => {
    for (const [publicApi, aliasApi] of RESPONSES_ROUTES) {
      for (const api of [publicApi, aliasApi]) {
        for (const baseUrl of [NATIVE_OPENAI_BASE_URL, PROXY_BASE_URL]) {
          for (const [label, compat] of compatMatrix) {
            const { capabilities, policy, emitted } = decide(api, compat, baseUrl);
            const route = `${api} @ ${new URL(baseUrl).hostname} [${label}]`;
            // The strip decision is one value, observed through both call sites.
            expect(policy.shouldStripPromptCache, route).toBe(
              capabilities.shouldStripResponsesPromptCache,
            );
            expect(capabilities.promptCacheFields.stripResponsesCacheFields, route).toBe(
              policy.shouldStripPromptCache,
            );
            if (compat && (compat as { supportsPromptCacheKey?: boolean }).supportsPromptCacheKey === false) {
              // An explicit route-level refusal emits nothing, whatever else is set.
              expect(emitted, route).toEqual({});
              continue;
            }
            // A strip route never receives the routing key, and it receives the retention
            // field only when the operator explicitly opted that field in.
            if (emitted.prompt_cache_key !== undefined) {
              expect(policy.shouldStripPromptCache, route).toBe(false);
            }
            const optedRetentionIn =
              (compat as { supportsLongCacheRetention?: boolean } | undefined)?.supportsLongCacheRetention === true;
            if (emitted.prompt_cache_retention !== undefined && !optedRetentionIn) {
              expect(policy.shouldStripPromptCache, route).toBe(false);
            }
          }
        }
      }
    }
  });

  it("agrees for the completions lane, where nothing is ever stripped", () => {
    for (const [publicApi, aliasApi] of COMPLETIONS_ROUTES) {
      for (const api of [publicApi, aliasApi]) {
        for (const [label, compat] of compatMatrix) {
          const { capabilities, policy, emitted } = decide(api, compat, PROXY_BASE_URL);
          const route = `${api} [${label}]`;
          expect(policy.shouldStripPromptCache, route).toBe(false);
          expect(capabilities.shouldStripResponsesPromptCache, route).toBe(false);
          if (compat === undefined) {
            // Third-party completions providers are default-false: no fields, no strip.
            expect(emitted, route).toEqual({});
          }
        }
      }
    }
  });

  it("refuses both cache fields when the operator declared the route rejects them (#48155)", () => {
    // The regression this descriptor fixes: the in-tree alias spelling used to resolve
    // "not a Responses api" in the capability record while the strip policy resolved the
    // opposite, so `prompt_cache_retention` was emitted onto a strip target.
    for (const [publicApi, aliasApi] of RESPONSES_ROUTES) {
      for (const api of [publicApi, aliasApi]) {
        const { capabilities, policy, emitted } = decide(
          api,
          { supportsPromptCacheKey: false, supportsLongCacheRetention: true },
          NATIVE_OPENAI_BASE_URL,
        );
        expect(policy.shouldStripPromptCache, api).toBe(true);
        expect(capabilities.shouldStripResponsesPromptCache, api).toBe(true);
        expect(emitted, api).toEqual({});
      }
    }
  });

  it("still recovers caching for a proxy the operator opted in", () => {
    for (const [publicApi, aliasApi] of [...RESPONSES_ROUTES, ...COMPLETIONS_ROUTES]) {
      for (const api of [publicApi, aliasApi]) {
        const { capabilities, emitted } = decide(
          api,
          { supportsPromptCacheKey: true, supportsLongCacheRetention: true },
          PROXY_BASE_URL,
        );
        expect(capabilities.shouldStripResponsesPromptCache, api).toBe(false);
        expect(emitted, api).toEqual({
          prompt_cache_key: "session-digest",
          prompt_cache_retention: "24h",
        });
      }
    }
  });

  it("honours a retention-only opt-in without emitting the routing key", () => {
    for (const [publicApi, aliasApi] of RESPONSES_ROUTES) {
      for (const api of [publicApi, aliasApi]) {
        const { capabilities, emitted } = decide(
          api,
          { supportsLongCacheRetention: true },
          PROXY_BASE_URL,
        );
        expect(capabilities.promptCacheFields.allowsRoutingKey, api).toBe(false);
        expect(capabilities.promptCacheFields.allowsRetention, api).toBe(true);
        expect(emitted, api).toEqual({ prompt_cache_retention: "24h" });
      }
    }
  });

  it("fails closed for an unknown protocol and for the explicit-mode field shape", () => {
    const unknown = resolveUpstreamPromptCacheFields({
      api: "bedrock-converse-stream",
      compat: undefined,
      usesKnownNativeOpenAIEndpoint: false,
      usesExplicitProxyLikeEndpoint: false,
    });
    expect(unknown).toEqual({
      allowsRoutingKey: false,
      allowsRetention: false,
      allowsExplicitModeOptions: false,
      stripResponsesCacheFields: false,
    });

    // Native route, no compat: the fields are emitted, but never the GPT-5.6+ shape.
    const native = decide("openai-responses", undefined, NATIVE_OPENAI_BASE_URL);
    expect(native.emitted).toEqual({
      prompt_cache_key: "session-digest",
      prompt_cache_retention: "24h",
    });
    expect(native.capabilities.promptCacheFields.allowsExplicitModeOptions).toBe(false);
  });
});

describe("store and service-tier facts follow the same classification", () => {
  it("reports the same Responses store/tier facts for both spellings of a route", () => {
    for (const [publicApi, aliasApi] of RESPONSES_ROUTES) {
      const provider = publicApi === "azure-openai-responses" ? "azure-openai" : "openai";
      const baseUrl = publicApi === "azure-openai-responses"
        ? "https://openclaw-resource.openai.azure.com/openai/v1"
        : NATIVE_OPENAI_BASE_URL;
      const publicFacts = decide(publicApi, undefined, baseUrl);
      const aliasFacts = decide(aliasApi, undefined, baseUrl);
      const route = `${publicApi} vs ${aliasApi}`;
      expect(aliasFacts.policy.explicitStore, route).toBe(publicFacts.policy.explicitStore);
      expect(aliasFacts.policy.allowsServiceTier, route).toBe(publicFacts.policy.allowsServiceTier);
      expect(aliasFacts.capabilities.supportsResponsesStoreField, route).toBe(
        publicFacts.capabilities.supportsResponsesStoreField,
      );
      expect(publicFacts.capabilities.supportsResponsesStoreField, publicApi).toBe(true);
      expect(provider).toBeTruthy();
    }
  });
});
