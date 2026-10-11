---
id: p1-154-outbound-concurrency-budget-20261011
title: Shared outbound model concurrency budget (issue #154 second half)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Bound how many physical provider requests one runtime process keeps in flight per endpoint+account, without adding a second scheduler, without a frozen default limit, and without falsely releasing a slot that an upper-layer timeout abandoned.
expectedUserBehavior:
  - A burst of agent/subagent/cron model calls against the same provider endpoint and credential cannot exceed the configured in-flight limit, and a refused call never reaches the provider.
  - Two model names on the same endpoint and credential share the budget; a different credential or a different endpoint is unaffected.
  - Cancelling a queued call, failing a transport call, ending or cancelling a stream, and shutting the budget down all release the slot exactly once; a still-alive request is never released by a timer.
touchedAreas:
  - openclaw_runtime/src/infra/bounded-concurrency.ts
  - openclaw_runtime/src/infra/bounded-concurrency.test.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.test.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - harness/specs/rules/provider-outbound-concurrency-budget.md
  - docs/dev/p1-154-outbound-concurrency-budget-20261011.md
  - harness/specs/tasks/p1-154-outbound-concurrency-budget-20261011.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredRules:
  - provider-outbound-concurrency-budget
  - runtime-feature-leaf-consumers
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts src/infra/bounded-concurrency.test.ts
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/provider-outbound-budget.test.ts src/agents/stage1-request-envelope.test.ts src/agents/rc02-entry-matrix.acceptance.test.ts src/agents/openai-transport-stream.test.ts src/agents/anthropic-transport-stream.test.ts
  - node --import tsx ../ClawX-work/p1-154-outbound-budget-20261011/bounded-load.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-154-outbound-concurrency-budget-20261011.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - A bounded concurrency gate with an explicit queue contract exists (admit, overload refusal before waiting, queued-wait deadline, abort, FIFO hand-off, counted double release, close) and its counters are exposed for diagnosis.
  - The budget is acquired at the real outbound boundary (buildGuardedModelFetch) before the local provider sidecar starts and before the physical request, and the slot is bound to the guarded request's own release path so stream end, cancel, error and dispatcher release each release it exactly once.
  - Group identity is the normalized endpoint origin plus a truncated SHA-256 account discriminator computed in process memory; the raw credential never appears in a group id, log line or evidence file, and an explicit alias mapping can merge derived groups.
  - Nothing is limited by default; the environment surface (OPENCLAW_PROVIDER_OUTBOUND_MAX_CONCURRENT / MAX_QUEUE / QUEUE_TIMEOUT_MS / QUOTA_ALIASES) or configureProviderOutboundBudget() opts in, and invalid values are ignored rather than guessed.
  - Raw bounded-load evidence lands on disk (per-request samples, configuration matrix, peak active/queued, rejection counts by reason) and is labelled stub verification, with the uncovered surfaces listed instead of a global claim.
  - Evidence is agent-driven only: no real credential, no paid provider call, no real-OS claim.
docs:
  required: true
  paths:
    - docs/dev/p1-154-outbound-concurrency-budget-20261011.md
---

# Shared outbound model concurrency budget

Issue #154 has two halves. The first half (bounded lane admission in
`process/command-queue.ts`) landed earlier. This change implements the second
half: a shared concurrency budget for **physical outbound provider requests**.

The problem the lanes do not solve: lanes count agent turns, not requests. A
single turn can issue a main model call, a compaction/auxiliary call and SDK
retries; subagents and cron runs add more. The gateway already bounds inbound
admission (`http-endpoint-budget.ts`), so the remaining unbounded surface is
outbound.

The change reuses the existing transport choke point (`buildGuardedModelFetch`)
and the existing guarded-request release path; it does not add a scheduler
service, a Redis/rate-bucket layer, or a second approval plane. Concurrency
control is opt-in, because the issue forbids freezing an example concurrency
number as a product default.

`PROVIDER_OUTBOUND_COVERAGE` records what is and is not gated: chat, subagent,
cron and compaction/auxiliary model calls are covered; embedding adapters, media
providers and local sidecar startup are not.
