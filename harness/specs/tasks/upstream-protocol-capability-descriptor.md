---
lifecycleStatus: active
id: upstream-protocol-capability-descriptor
title: Resolve upstream protocol capabilities once, so every cache decision agrees per route
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Endpoint and api classification already existed in three independent copies (provider-attribution, the Responses payload policy, and the cache-retention gate), and the copies disagreed for the api spellings the managed transport rewrites. Measured consequence: prompt_cache_retention was emitted onto routes whose strip policy deletes it. Replace the copies with one descriptor that classifies the protocol kind for every spelling and resolves the cache-field allowances for a route.
touchedAreas:
  - openclaw_runtime/src/agents/upstream-protocol-capabilities.ts
  - openclaw_runtime/src/agents/upstream-protocol-capabilities.test.ts
  - openclaw_runtime/src/agents/provider-attribution.ts
  - openclaw_runtime/src/agents/openai-responses-payload-policy.ts
  - openclaw_runtime/src/agents/openai-prompt-cache-payload.ts
  - openclaw_runtime/src/agents/provider-api-families.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-retention.ts
  - harness/specs/rules/outbound-protocol-payload-consistency.md
expectedUserBehavior:
  - A session on a managed-transport model caches identically to the same model on the direct route; support is not decided by which api spelling the model happens to carry.
  - A provider that rejects the cache fields never receives one, even when another compat flag asks for a longer lifetime.
requiredProfiles:
  - fast
requiredRules:
  - outbound-protocol-payload-consistency
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/upstream-protocol-capabilities.test.ts
acceptance:
  - One module owns the protocol-kind classification (Responses, Chat Completions, Anthropic messages, Google generateContent) and classifies the public api id and the in-tree transport alias identically.
  - The prompt-cache field precedence (routing key, retention, fail-closed explicit-mode shape, strip) is computed by that module; the emit point and the strip point consume one value and cannot disagree for a route.
  - An explicit `compat.supportsPromptCacheKey: false` refuses both cache fields on every spelling, including the alias lanes and including when `supportsLongCacheRetention` is set, because the strip policy deletes both fields.
  - An explicit `supportsPromptCacheKey: true` still recovers caching on a proxy-like route, and an explicit `supportsLongCacheRetention: true` still allows the retention field without the routing key.
  - The Responses store and service-tier facts and the GPT parallel-tool-call predicate resolve from the same classification, so a route does not change behaviour when the transport rewrites its api id.
  - The new probe is a payload-level test with no network, no credential and no paid provider request.
docs:
  required: false
---

## Background

The runtime already had one capability resolver (`resolveProviderRequestCapabilities`) and
one payload policy (`resolveOpenAIResponsesPayloadPolicy`), but the api-id knowledge inside
them was duplicated:

- `provider-attribution.ts` had `OPENAI_RESPONSES_APIS` with three public ids;
- `openai-responses-payload-policy.ts` had a different set with four, adding
  `openclaw-openai-responses-transport`;
- `embedded-agent-runner/prompt-cache-retention.ts` had a third list
  (`OPENAI_FAMILY_CACHE_APIS`) for the retention gate;
- `provider-api-families.ts` had a fourth (`GPT_PARALLEL_TOOL_CALLS_APIS`, public ids
  only).

The aliases are not a cosmetic difference. `provider-transport-stream.ts`
(`SIMPLE_TRANSPORT_API_ALIAS` → `prepareTransportAwareSimpleModel`) rewrites the model api
to the in-tree transport id before the managed transport builds the payload, while the
provider wrapper still sees the public id. So the two halves of one cache decision were
computed from different strings for the same session.

Measured divergence before this change (native OpenAI endpoint,
`compat.supportsPromptCacheKey: false`, `cacheRetention: "long"`):

| route | capability record strip | payload policy strip | emitted fields |
| --- | --- | --- | --- |
| `openai-responses` | true | true | `{}` |
| `openclaw-openai-responses-transport` | false | true | `{prompt_cache_retention: "24h"}` |
| `openclaw-azure-openai-responses-transport` | false | false | `{prompt_cache_retention: "24h"}` |

Row 2 is the contradiction the rule forbids: `applyOpenAIResponsesPayloadPolicy` deletes
both fields on the `onPayload` hook, and the write point then re-adds the retention field
after it, so an operator-declared refusal shipped a field anyway. Row 3 shows the same
class of problem from the other side: neither copy recognized the Azure alias, so the lane
got a different store/service-tier policy than its own public spelling.

## Scope

- Add `upstream-protocol-capabilities.ts`: protocol-kind classification for every spelling
  plus `resolveUpstreamPromptCacheFields`, which owns the cache-field precedence.
- Make the four enumerations above consume it; delete the copies.
- Keep the endpoint-class resolvers as they are: the descriptor takes
  `usesKnownNativeOpenAIEndpoint` / `usesExplicitProxyLikeEndpoint` as inputs rather than
  re-deriving them, so the manifest-driven resolver stays the endpoint authority.
- Widen the api-id sets to the alias spellings, which is what makes the lanes agree; the
  Responses store / service-tier facts and the parallel-tool-call predicate then follow the
  same classification.
- Fix the precedence so an explicit `supportsPromptCacheKey: false` refuses both fields.

## Out of scope

- Unifying the endpoint-class resolver itself: `openai-responses-payload-policy.ts` keeps
  its bundled host table while `provider-attribution.ts` keeps the manifest-driven one. That
  merge changes behaviour for every provider route, not only cache routes, and needs its own
  change set.
- Model-generation-gated `prompt_cache_options` (GPT-5.6+ explicit mode). The descriptor
  reports `allowsExplicitModeOptions: false` in one place so the write point fails closed
  until a generation signal exists.
- Anthropic breakpoint allocation and Google explicit-cache break-even (tracked as the
  remaining P1/P2 items).
- Per-stream-shape behaviour lists (tool-call argument repair, incomplete-turn retry guard).
  They name api ids but are not protocol classifications and intentionally cover subsets;
  the new probe's source guard excludes them by construction.

## Risks

- Widening the api-id sets changes store/service-tier decisions for the alias lanes to match
  their public spellings. That is the intent, and the probe pins the agreement, but it is a
  wire-visible change for Azure in-tree routes.
- The descriptor now owns a precedence rule that used to be two copies. Any future compat
  flag must be added here rather than at a call site, or the two halves can drift again.
- The probe's source-level guard only covers set literals that enumerate the base
  `openai-responses` id; a future copy that omits the base id would not be caught.
