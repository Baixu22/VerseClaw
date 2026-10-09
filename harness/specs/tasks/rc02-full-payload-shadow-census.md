---
id: rc02-full-payload-shadow-census
title: RC-02 Full-Payload Shadow Census
taskType: engineering-acceptance
# Pinned to the commit this increment started from: the shared branch diverged
# from origin/main long ago, so the default diff base would report the whole
# branch (and every unrelated workstream) as changed.
diffBase: 9545d6415d2ad3756c02956d705594af7bfe884d
intent: Establish ShadowContextReceipt/v0 before provider projection and ShadowWireReceipt/v0 at the guarded request-body boundary after every provider-specific finalizer for every source-runtime model call in the automated entry matrix; write bounded evidence through the RC-01-approved ReceiptStore (typed append-only runtime_receipts in openclaw-state SQLite); record no raw payload by default; achieve owner-classification coverage 100% and zero-byte parity; the npm fallback reports explicit capability degradation and never counts as receipt coverage.
ownedPaths:
  - openclaw_runtime/package.json
  - openclaw_runtime/pnpm-lock.yaml
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/receipt-store.test.ts
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/agents/shadow-census.test.ts
  - openclaw_runtime/src/agents/rc02-shadow-census.acceptance.test.ts
  - openclaw_runtime/src/agents/rc02-entry-matrix.acceptance.test.ts
  - openclaw_runtime/src/agents/anthropic-transport-stream.ts
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/provider-transport-stream.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution.ts
  - openclaw_runtime/src/plugin-sdk/provider-transport-runtime.ts
  - openclaw_runtime/extensions/amazon-bedrock/register.sync.runtime.ts
  - openclaw_runtime/extensions/amazon-bedrock/stream.runtime.ts
  - openclaw_runtime/extensions/anthropic-vertex/api.ts
  - openclaw_runtime/extensions/anthropic-vertex/stream-runtime.ts
  - openclaw_runtime/extensions/anthropic-vertex/stream-runtime.test-fixture.ts
  - openclaw_runtime/extensions/google/transport-stream.ts
  - openclaw_runtime/src/infra/node-sqlite.ts
  - openclaw_runtime/src/plugin-sdk/facade-runtime.ts
  - openclaw_runtime/src/context-engine/dcs-receipts.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/context-engine/rc03-seal.test.ts
  - openclaw_runtime/test/vitest/vitest.pattern-file.ts
  - harness/specs/tasks/rc02-full-payload-shadow-census.md
  - artifacts/runtime-authority-convergence/rc-02/**
  - .gitignore
  - scripts/rc02-shadow-census-report.mjs
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
  - openclaw_runtime/src/agents/rc02-inbound-entry.acceptance.test.ts
  - openclaw_runtime/src/agents/rc02-cron-entry.acceptance.test.ts
  - openclaw_runtime/src/agents/rc02-cli-entry.acceptance.test.ts
touchedAreas:
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/state/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/provider-runtime/**
  - openclaw_runtime/src/llm/**
  - tests/unit/**
  - harness/specs/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - artifacts/runtime-authority-convergence/rc-02/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - Every source-runtime model call in the automated entry matrix produces a ShadowContextReceipt/v0 (logical bundle digest, refs, selected/omitted decisions, budget, policy digest, call identity) and a ShadowWireReceipt/v0 (final request-body digest after provider-specific finalizers, provider/adapter identity, registered transform IDs, runtimeMode=source, transport-attempt identity).
  - The npm fallback exposes runtimeMode=npm plus explicit capability degradation and never emits complete-receipt or readiness claims.
  - Raw prompt, tool output, credentials, cookies, and environment values are not persisted by default.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - changing payload bytes, ordering, tools, retries, approvals, or delivery during shadow instrumentation
  - persisting raw prompt, tool output, credentials, cookies, or environment values by default
  - using onPayload as the final wire seal when later provider-specific finalizers exist
  - letting the npm fallback emit complete-receipt or readiness claims or count toward receipt coverage
  - promoting diagnostic replay/reducer/resume paths to lifecycle or effect authority
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
  - adding a second persistent authority, service, protocol, or telemetry store
featureFlags:
  - Shadow receipt emission is behind a feature flag default-off; kill switch restores the legacy path with zero behavior change.
rollback:
  - Disable the RC-02 feature flag to restore the legacy provider path byte-for-byte.
  - No migration rollback is required because the runtime_receipts table is append-only and bounded; on-conflict idempotency prevents duplicates.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/shadow-census.test.ts src/agents/rc02-shadow-census.acceptance.test.ts src/agents/rc02-entry-matrix.acceptance.test.ts src/agents/rc02-inbound-entry.acceptance.test.ts src/agents/rc02-cron-entry.acceptance.test.ts src/agents/rc02-cli-entry.acceptance.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc02-full-payload-shadow-census.md
acceptance:
  - The automated entry matrix (desktop chat, Cron, one channel conformance fixture, CLI/compact, embedded attempt, context engine, provider payload hook, provider transport) yields both receipts for every source-runtime model call; owner-classification coverage is 100% and unknown is zero.
  - ShadowContextReceipt/v0 is generated before provider projection; ShadowWireReceipt/v0 is generated at the guarded request-body boundary after every provider-specific finalizer.
  - Zero-byte parity holds: observer installation does not mutate the payload object or final serialized bytes for deterministic fixtures; volatile transport fields are excluded only by a named normalization registered before the comparison.
  - The runtime_receipts table (typed, append-only, via ReceiptStore) persists bounded digest/ref/call-index/version/policy-digest records; same idempotency_key with identical content is idempotent, different content conflicts.
  - No raw payload is recorded by default; npm fallback reports degraded and contributes zero receipt coverage.
  - Shadow write failure never changes send behavior but fails the RC-02 acceptance run.
  - An RC-02 independent Verifier accepts the census using the RC-00-approved infrastructure.
  - No product lock, runtime behavior, or live/readiness claim changes.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-02 Full-Payload Shadow Census

RC-02 instruments every source-runtime model call with dual shadow receipts — a logical
`ShadowContextReceipt/v0` before provider projection and a `ShadowWireReceipt/v0` at the guarded
request-body boundary after every provider-specific finalizer — and persists bounded evidence
through the RC-01-approved `ReceiptStore` (`runtime_receipts` in openclaw-state SQLite). It is a
zero-behavior-change census: no payload byte, ordering, tool, retry, approval, or delivery change
is allowed, and shadow write failure must never alter send behavior but must fail RC-02
acceptance. The npm fallback reports explicit degradation and contributes no receipt coverage.
