---
id: rc03-dcs-seal-dual-receipts
title: RC-03 DCS Seal And Dual Receipts
taskType: engineering-acceptance
# Pinned to the TF-0030 close commit RC-03R started from; the shared branch
# diverged from origin/main long ago.
diffBase: 32597a2d0
intent: Establish an attempt-scoped CompilePlan, a model-call-scoped immutable ContextBundle, ContextReceipt/v1, and WireReceipt/v1; register every pre-seal semantic producer and post-seal non-semantic transport transform; move COMPASS SSP and ContextEngine message replacement under a registered pre-seal producer; keep ContextCandidate incremental and structured items atomic; use the single contextEngine slot and the RC-01/RC-02-approved ReceiptStore; ensure tool loop, retry, provider fallback, compact, fork, and handoff each produce correlated receipts; a kill switch restores the legacy path; unknown semantic mutation is zero.
ownedPaths:
  - openclaw_runtime/src/context-engine/compile-plan.ts
  - openclaw_runtime/src/context-engine/context-bundle.ts
  - openclaw_runtime/src/context-engine/dcs-receipts.ts
  - openclaw_runtime/src/context-engine/seal-registry.ts
  - openclaw_runtime/src/context-engine/rc03-producers.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/context-engine/rc03-seal.test.ts
  - openclaw_runtime/src/context-engine/rc03-seal-wiring.test.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/context-candidate.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/compass-handler.ts
  - openclaw_runtime/src/agents/anthropic-transport-stream.ts
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - harness/specs/tasks/rc03-dcs-seal-dual-receipts.md
  - artifacts/runtime-authority-convergence/rc-03/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
  # Agent Dev evidence refreshed so the acceptance audit gate sees it inside
  # its 24h freshness window.
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-workbench/**
touchedAreas:
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/state/**
  - openclaw_runtime/src/auto-reply/reply/**
  - tests/unit/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-03/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change when the RC-03 seal is off.
  - Every semantic prompt addition (COMPASS SSP, ContextEngine message replacement, and all others) is a registered pre-seal producer; none remains a direct provider-bound bypass after cutover.
  - Per model call, one immutable ContextBundle is sealed; after sealing only registered non-semantic transport transforms run.
  - Tool loop, retry, provider fallback, compact, fork, and handoff each produce correlated ContextReceipt/v1 and WireReceipt/v1.
  - A kill switch restores the legacy path with zero behavior change.
  - Unknown semantic mutation is zero; product locks stay false.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - introducing ContextUnit, a Planner service, a synchronous Mem, or an unreviewed receipt store
  - a semantic mutation that is not registered as a pre-seal producer
  - changing payload bytes, ordering, tools, retries, approvals, or delivery during instrumentation
  - recording raw prompt, tool output, credentials, cookies, or environment values by default
  - promoting diagnostic replay/reducer/resume paths to lifecycle or effect authority
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The RC-03 seal is behind a feature flag default-off; a kill switch restores the legacy provider path byte-for-byte.
rollback:
  - Disable the RC-03 feature flag / kill switch to restore the legacy path.
  - No migration rollback is required because the runtime_receipts table is append-only and idempotent.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/rc03-entry-transitions.acceptance.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/shadow-census.test.ts src/agents/rc02-shadow-census.acceptance.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc03-dcs-seal-dual-receipts.md
acceptance:
  - One stable CompilePlan per attempt; a policy-only change within the same provider attempt increments planRevision; a provider capability change or fallback creates a new attempt (attemptIndex += 1, planRevision/modelCallIndex/wireAttemptIndex reset).
  - One immutable ContextBundle per model call; tool results create the next bundle without synchronously rerunning Mem.
  - Semantic transforms occur before bundle sealing; after sealing only registered non-semantic transport transforms run.
  - COMPASS SSP and ContextEngine message replacement are registered pre-seal producers; no provider-bound bypass remains.
  - Tool loop, retry, provider fallback, compact, fork, and handoff each produce correlated ContextReceipt/v1 + WireReceipt/v1 through the RC-01/RC-02 ReceiptStore.
  - Kill switch restores the legacy path with zero behavior change; unknown semantic mutation is zero.
  - Product locks remain false; an RC-03 independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-03 DCS Seal And Dual Receipts

RC-03 formalizes the DCS context authority: an attempt-scoped CompilePlan, a model-call-scoped
immutable ContextBundle, ContextReceipt/v1 and WireReceipt/v1 persisted through the approved
ReceiptStore, and a seal registry that forces every semantic producer before the bundle seal and
every non-semantic transport transform after it. COMPASS SSP and ContextEngine message replacement
move under registered pre-seal producers. Tool loop, retry, provider fallback, compact, fork, and
handoff each produce correlated receipts. A kill switch restores the legacy path byte-for-byte.
