---
id: outbound-protocol-payload-consistency
title: Outbound Protocol Payload Consistency
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
pathPatterns:
  - openclaw_runtime/src/agents/upstream-protocol-capabilities.ts
  - openclaw_runtime/src/agents/provider-api-families.ts
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/anthropic-transport-stream.ts
  - openclaw_runtime/src/agents/anthropic-payload-policy.ts
  - openclaw_runtime/src/agents/openai-responses-payload-policy.ts
  - openclaw_runtime/src/agents/provider-attribution.ts
  - openclaw_runtime/src/agents/provider-transport-stream.ts
  - openclaw_runtime/src/agents/system-prompt-cache-boundary.ts
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/upstream-protocol-cache-probe.test.ts
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/upstream-protocol-capabilities.test.ts
---

Every supported upstream protocol must be handled by one shared capability decision, not
by per-transport copies of the same endpoint knowledge. Endpoint classification,
cache-field support, retention/TTL generation mapping, and reasoning-replay portability
resolve once and are consumed by each protocol adapter. Two enumerations of the same
endpoint classes are a defect even while they agree.

An api id is not one string. The managed transport rewrites a public id to its in-tree
spelling (`openai-responses` -> `openclaw-openai-responses-transport`) before it builds a
payload, while the provider wrapper above it still sees the public id, so a decision keyed
on one spelling silently becomes a different decision on the managed path. Every
classification lists both spellings, and the probe asserts the two halves of one route
resolve identically.

An outbound payload must never contain internal bookkeeping. Prompt-cache boundary
markers, snapshot digests, trace ids used only for local correlation, and any other
in-band sentinel are stripped structurally before the payload leaves the process. A
marker that only some protocol paths strip is a leak, because the un-stripped path both
ships the marker upstream and perturbs the provider's prefix hash. New protocol paths
inherit the guarantee by construction; they do not rely on remembering a strip call.

A comment or doc that claims a boundary owns a behaviour is part of the contract. If the
code does not implement the claim, the claim is wrong and must be corrected in the same
change set that touches either side.

Reasoning state is owned by the provider that produced it. Portability is decided from
the origin of the state plus the target's declared capability, never from the shape of
the target's own signature parser. A foreign-family reasoning block that no adapter can
translate is dropped deliberately by the projection layer, and the drop is recorded, so
that the guarantee does not silently depend on a transport's block mapper discarding
whatever it does not recognize.

Cache-routing fields are only emitted when the resolved endpoint capability allows them.
Unknown model generations fail closed and emit nothing rather than guessing a field
shape, because a wrong field is a provider 400 and a missing field is only a lost
optimization.

Verification uses payload-level probes with a stubbed transport; no real credential,
paid provider request or human data is required.
