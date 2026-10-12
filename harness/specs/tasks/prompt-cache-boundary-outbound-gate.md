---
lifecycleStatus: active
id: prompt-cache-boundary-outbound-gate
title: Make the system-prompt cache boundary structural and fail closed on outbound leakage
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: The prompt-cache boundary is an in-band sentinel string stripped by a handful of scattered call sites. It currently reaches the OpenAI wire. Replace the convention with a structural boundary in the payload builders and add a fail-closed gate so any protocol path that leaks the marker fails instead of silently shipping it and perturbing the cache prefix.
touchedAreas:
  - openclaw_runtime/src/agents/system-prompt-cache-boundary.ts
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/anthropic-transport-stream.ts
  - openclaw_runtime/src/agents/provider-transport-stream.ts
  - openclaw_runtime/src/agents/upstream-protocol-cache-probe.test.ts
  - openclaw_runtime/scripts/ts-max-loc-baseline.json
expectedUserBehavior:
  - No upstream provider receives the internal cache-boundary marker.
  - System-prompt additions from hooks still land in the uncached suffix, so an injected reminder does not invalidate the cached prefix.
requiredProfiles:
  - fast
requiredRules:
  - provider-outbound-concurrency-budget
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/upstream-protocol-cache-probe.test.ts
acceptance:
  - Every protocol path that forwards a system prompt either splits it structurally or strips the marker before the payload leaves the process.
  - A fail-closed check asserts that a built outbound payload for each supported protocol contains no boundary marker. A leak fails the check rather than being reported as a warning.
  - The OpenAI Responses probe asserting the current leak is inverted in the same change set, with a comment naming this spec.
  - Hook-injected system-prompt additions continue to land after the boundary.
  - The comment in provider-transport-stream.ts describing cache-boundary stripping matches what the code actually does, or is removed.
docs:
  required: false
---

## Background

Measured by the tracked regression probe
`openclaw_runtime/src/agents/upstream-protocol-cache-probe.test.ts` (the `PROBE C`
suite, whose `GAP(G4)` cases document the current behaviour):

- `applyAnthropicPayloadPolicyToParams` splitting the boundary into a cached stable
  prefix and an uncached dynamic suffix.
- The real OpenClaw-managed OpenAI transport, reached through the production factory
  `createBoundaryAwareStreamFnForModel`, forwarding a boundary-bearing system prompt.

The marker is written on the normal path (`system-prompt.ts:1286`,
`ensureSystemPromptCacheBoundary` in `run/attempt.ts:4035`). The only strippers in the
runtime are the Anthropic payload policy, the CLI-argument path, the provider-owned and
Codex stream branches in `stream-resolution.ts`, and the Google cache-creation digest.
None of them is on the OpenAI transport path, and the doc comment in
`provider-transport-stream.ts` claiming otherwise is inaccurate.

## Scope

- Give payload builders a structured projection of the boundary for the protocols whose
  bytes the runtime owns: the OpenAI transports rewrite the system prompt through
  `joinSystemPromptWithoutCacheBoundary` (stable prefix + dynamic suffix, marker
  dropped), and the Anthropic policy keeps consuming the marker into `cache_control`.
- Add the fail-closed outbound gate (`enforceNoOutboundCacheBoundary`) at every outbound
  boundary the runtime owns — after `onPayload` hooks, so it sees the final bytes:
  `finalizeOpenAIProviderParams` (all four OpenAI-family builders) and the Anthropic
  Messages payload builder. Scrub what can be scrubbed, then throw
  `OutboundCacheBoundaryLeakError` if anything survives.
- For plugin-owned protocols the runtime does not build the bytes, so it strips at the
  hand-over in `createProviderOwnedTransportStreamFn` (google / google-vertex /
  bedrock-converse-stream; none of them is Anthropic-format, so nothing there needs the
  marker). Keeping the marker available for Anthropic-family consumers is why the strips
  in `embedded-agent-runner/stream-resolution.ts` are left where they are.
- Keep Anthropic cache-control placement behaviour unchanged.

## Out of scope

- Changing where in the system prompt the boundary sits, or what the stable prefix contains.
- Enabling prompt caching for providers that do not support it.
- Removing the marker text format; existing stored prompts must keep working.

## Risks

- The marker is stripped today by several call sites; removing those before the
  structural path is complete would change cache behaviour on Anthropic. Land the
  structural path first, then delete the redundant strips with evidence (still open:
  the strips in `stream-resolution.ts` for the anthropic-vertex and Codex branches).
- The gate throws instead of warning, so a future builder that introduces a marker into
  a position the scrubber skips (object keys, `Map`/`Set`, class instances) turns into a
  failed request rather than a silently degraded cache. That is the intended trade:
  the probe pins both the scrubbed and the throwing branch.
- Concurrency-budget and outbound-payload rules apply to this path; the gate must not
  add a second outbound request.
