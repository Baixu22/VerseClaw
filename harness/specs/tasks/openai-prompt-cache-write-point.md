---
lifecycleStatus: active
id: openai-prompt-cache-write-point
title: Emit OpenAI prompt-cache routing fields at the outbound write point
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: The runtime derives a prompt cache key and a cache-retention intent per session, threads them through StreamOptions, and then emits neither field on the OpenAI-family wire. Add the missing write point so OpenAI-family requests can influence cache routing and retention, gated by the existing endpoint capability decisions.
touchedAreas:
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/openai-prompt-cache-payload.ts
  - openclaw_runtime/src/agents/openai-responses-payload-policy.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-retention.ts
  - openclaw_runtime/src/agents/upstream-protocol-cache-probe.test.ts
  - openclaw_runtime/scripts/ts-max-loc-baseline.json
expectedUserBehavior:
  - A webchat session on an OpenAI-family model sends a stable prompt_cache_key so related requests are routed to the same cache.
  - Asking for long cache retention produces a real retention/ttl field on models that support it, instead of being silently ignored.
  - Endpoints known to reject these fields keep receiving payloads without them; the strip path and its opt-out flag keep working.
requiredProfiles:
  - fast
requiredRules:
  - provider-outbound-concurrency-budget
  - runtime-efficiency-observability-boundary
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/upstream-protocol-cache-probe.test.ts
acceptance:
  - The OpenAI Responses and Chat Completions transports emit prompt_cache_key when StreamOptions.promptCacheKey is set and the resolved endpoint capability allows it.
  - cacheRetention "long" maps to prompt_cache_retention "24h" on routes known to accept it, honoring the documented `supportsLongCacheRetention` default of true; "short" and "none" never emit the field.
  - An explicit cacheRetention on an OpenAI-family lane survives resolveCacheRetention, so the intent reaches the transport instead of being dropped runner-side.
  - compat.supportsPromptCacheKey === false still forces stripping, and proxy-like endpoints keep the existing default strip behavior for an unset compat, while an explicit `true` opt-in covers forwarding proxies.
  - The GAP(G1) and GAP(G2) probes in src/agents/upstream-protocol-cache-probe.test.ts are updated in the same change set to assert the emitted fields, with a comment naming this spec.
  - No new outbound request is issued per turn; the fields ride on the existing request.
docs:
  required: false
---

## Background

Measured by the tracked regression probe
`openclaw_runtime/src/agents/upstream-protocol-cache-probe.test.ts` (the `PROBE A`
suite, whose `GAP(G1)` / `GAP(G2)` cases document the current behaviour):

- `gateway/server-methods/chat.ts:505` derives a per-session `promptCacheKey` and
  `cron/isolated-agent/run-executor.ts:64` derives one for isolated cron runs.
- `embedded-agent-runner/stream-resolution.ts:329` merges it into stream options.
- `embedded-agent-runner/extra-params.ts:517` resolves `cacheRetention` and forwards it.
- The OpenAI Responses payload assembled in `openai-transport-stream.ts` is
  `{model, input, stream, max_output_tokens}`: the key and the retention intent are
  dropped on the floor. `prompt_cache_key` only ever appears as a `delete` target in
  `openai-responses-payload-policy.ts:385`.
- A second drop happens one layer up: `resolveCacheRetention` returns `undefined` for
  every OpenAI-family lane unless `compat.supportsPromptCacheKey === true`, so even an
  explicitly configured `cacheRetention` never reached the transport (the same failure
  mode as issue #81281 for completions backends).

Live cache regression baselines already show the consequence: Anthropic lanes hold
0.982–0.996 hit rate under a hard floor, while every OpenAI lane is `warnOnly` at
0.891–0.966 (`live-cache-regression-baseline.ts`).

## Scope

- Add the write point(s) in the OpenAI transport payload assembly, for both the
  Responses and the Chat Completions paths, behind one shared module so the four
  builders cannot drift apart.
- Let an explicit `cacheRetention` on OpenAI-family lanes through the runner-side
  eligibility gate; endpoint accept/reject stays a transport concern.
- Route the decision through the existing capability resolution
  (`resolveProviderRequestCapabilities` / `resolveOpenAIResponsesPayloadPolicy`)
  instead of adding a second, parallel endpoint classifier.
- Keep the existing strip switch (`compat.supportsPromptCacheKey`) authoritative.
- Update the two `GAP(G1)` / `GAP(G2)` characterization probes.

## Out of scope

- Changing the OpenAI lane floors in `live-cache-regression-baseline.ts` to hard
  gates. That requires live observations first and is tracked separately.
- Choosing a new `promptCacheKey` derivation strategy (session-level vs prefix-level);
  see the granularity item in the research doc.
- Implementing provider-side cache accounting or pricing changes.

## Risks

- `prompt_cache_key` is rejected by some OpenAI-compatible proxies. The existing
  strip path must remain the default for proxy-like endpoints.
- GPT-5.6-and-later models use `prompt_cache_options` while earlier models use
  `prompt_cache_retention`; emitting the wrong one is a 400. The mapping must be
  model-generation aware, and unknown generations must fail closed (emit nothing).
