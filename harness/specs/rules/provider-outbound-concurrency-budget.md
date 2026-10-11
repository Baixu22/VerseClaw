---
id: provider-outbound-concurrency-budget
title: Provider Outbound Concurrency Budget Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
pathPatterns:
  - openclaw_runtime/src/infra/bounded-concurrency.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
---

Outbound model requests are admitted through a shared, bounded concurrency
budget keyed by the normalized endpoint origin plus a non-exportable account
discriminator. A quota group is never keyed by the raw credential, and the
discriminator must never be logged, persisted or written into evidence. Two
model names on the same endpoint and credential share one budget; different
credentials or different endpoints must not block each other. Operators may map
several derived groups onto one canonical group explicitly.

Admission happens before the local provider sidecar starts and before any bytes
are sent, so a refused request never enters the expensive path. Refusal is typed
(`overloaded`, `queue-timeout`, `aborted`) and the message must keep the
`overloaded` keyword so the existing failover classifier applies provider
overload semantics instead of an unknown error. A retry re-enters admission; it
never inherits the previous slot.

A slot is released only where the physical request is confirmed finished: stream
end, stream cancel, transport error, or dispatcher release. An upper-layer
timeout must not release a request that is still alive, and there is no
time-based release of a held slot. Leases are released once; a double release is
counted as a diagnostic instead of silently freeing a second slot.

A slot covers one physical request and nothing else. It must not be held while a
turn waits for tool work, a subagent, or a queued lane, so a parent turn waiting
on children can never hold the leaf budget its children need. Keeping the hold
that narrow is what prevents nested-wait starvation; widening it (for example, to
"one slot per agent turn") requires re-arguing that invariant, not just a call
site change.

Do not add a default concurrency limit. With nothing configured the boundary must
stay a single map lookup and let the request through. Do not claim a "global"
budget: the covered surfaces (chat, subagent, cron, compaction/auxiliary model
calls) and the uncovered ones (embedding adapters, media providers, local
sidecar startup) stay listed in `PROVIDER_OUTBOUND_COVERAGE`.

Verification uses provider stubs, an injected clock and an in-process load
harness; no real credential, paid provider request or human data is required.
