---
id: p2-issue-fixes-batch9-20261010
title: P2 issue batch 9 - receipt decision reasons and transcript call identity
lifecycleStatus: active
taskType: engineering-acceptance
intent: Close the remaining context-observation P2 gaps by persisting bounded per-candidate decision reasons in ContextReceipt content and by adding a deterministic transcript-entry to producing-model-call correlation that survives restart without entering provider bytes.
touchedAreas:
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/state/**
  - harness/specs/**
  - docs/**
  - docs/README.md
expectedUserBehavior:
  - A persisted ContextReceipt can explain whether each bounded candidate was applied, truncated, budget-dropped, duplicate, flag-off, killed or skipped without storing raw payload.
  - Assistant and tool-result transcript entries carry an optional model-call reference that joins to the matching receipt call identity after restart.
  - A model call that produces no transcript entry is recorded explicitly as producedEntryId null in an ignored custom entry.
  - When observation is off, transcript content, ordering, provider bytes and replay semantics remain unchanged.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - raw prompt, candidate text, memory payload, tool output, credentials or cookies in receipt or transcript correlation metadata
  - a second loss-tracking database or a parallel turn/model-call ledger
  - timestamp-only inference for transcript-to-model-call attribution
  - provider prompt mutation or a default feature-flag change
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/model-call-observations.test.ts src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/rc03-entry-transitions.acceptance.test.ts
  - pnpm --dir openclaw_runtime run db:kysely:check
  - pnpm --dir openclaw_runtime run check:deprecated-api-usage
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch9-20261010.md
acceptance:
  - Issue #111 - ContextReceipt content includes a bounded candidate decisions projection with ref/source/channel/disposition/reason/requested/applied fields and an explicit complete flag.
  - Issue #111 - candidate decisions participate in receipt content digest and idempotency conflict checks; old receipt rows remain readable with candidate_decisions_json null.
  - Issue #112 - assistant and tool-result session entries persist a bounded modelCall reference containing session/run/provider/adapter/model, attemptIndex, modelCallIndex, optional wireAttemptIndex and correlationDigest.
  - Issue #112 - unproduced calls are explicitly persisted as ignored custom entries with producedEntryId null; parallel sessions do not share in-process correlation state.
  - Observation remains additive: no raw payload enters receipt/session correlation metadata and no provider prompt bytes change when observation is disabled.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch9-20261010.md
---

# P2 issue batch 9

This batch closes the two remaining context-observation P2 gaps: bounded
per-candidate receipt decisions (#111) and deterministic transcript-entry to
producing-model-call correlation (#112). The work is observational and
payload-free; it does not change provider bytes, feature flags, product locks,
retry semantics, or model authorization.