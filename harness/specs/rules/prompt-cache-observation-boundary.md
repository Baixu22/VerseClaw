---
id: prompt-cache-observation-boundary
title: Prompt-cache observations remain bounded metadata, not decisions
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts
  - electron/services/usage-api.ts
  - electron/gateway/event-dispatch.ts
requiredTests:
  - tests/unit/prompt-cache-observability.test.ts
  - tests/unit/prompt-cache-observation-ledger.test.ts
---

Use the existing agent event bus, Main-owned ledger and typed usage host API.
Do not add a parallel store, raw transcript/secret persistence, keepalive, TTL
refresh or automatic model/tool/prompt policy changes for cache observation.
Only bounded identifiers, finite token counters and closed change codes cross
this diagnostic boundary; do not retain arbitrary producer detail strings.

Observed breaks and confirmed action decisions are different record variants.
Never manufacture a continued/cancelled decision, hit rate or cost from a drop.
Missing usage is not a healthy sample. Replay must not duplicate ledger rows,
and shared observed/confirmed writes must not overwrite one another.

Observation may drive a separate, explicit opt-in scheduling policy (for example
deferring non-urgent compaction while the TTL marker is hot) only when the policy
is reversible, records a stable reason, and does not alter model/tool/prompt
content. Observation must not silently enable such a policy.

Keep the ledger capped at 200, scoped by session ownership and generation.
Consume diagnostic agent streams in Main; existing UI confirmation semantics
remain unchanged. Explicit opt-out wins over trace/debug. Verification with
scripted events is agent-driven simulation, not live-provider performance proof.
