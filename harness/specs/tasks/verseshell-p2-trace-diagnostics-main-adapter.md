---
lifecycleStatus: archived
id: verseshell-p2-trace-diagnostics-main-adapter
title: VerseShell P2-03 Main Host Trace Diagnostics Adapter
taskType: runtime-contract
intent: Add the first Main-process adapter slice for TF-0066 after the signed diagnostics contract is available.
touchedAreas:
  - harness/specs/tasks/verseshell-p2-trace-diagnostics-main-adapter.md
  - electron/services/host-trace-diagnostics.ts
  - tests/unit/host-trace-diagnostics.test.ts
  - electron/services/terminal-api.ts
  - tests/unit/terminal-api.test.ts
expectedUserBehavior:
  - Only the ClawX Main process creates and holds the host-only signing secret.
  - A signed trace envelope is issued only after a terminal permission approval has been consumed.
  - Failed approved terminal executions produce a bounded diagnostic summary in a Main-owned in-memory sink.
  - The sink stores only the signed envelope and safe summary; it never stores command, prompt, stdout, stderr, approval token, credential, or secret.
requiredProfiles:
  - fast
requiredRules:
  - contract-first-boundary
  - runtime-lineage-boundary
  - runtime-authority-convergence-boundary
  - verseshell-foundation-p0-boundary
forbiddenPatterns:
  - Exposing the signing secret, envelope authority, or raw failure evidence to the renderer, runtime, model, or support consumer.
  - Issuing an envelope before approval binding or from model-visible payload.
  - Copying command, prompt, output, stderr, credential, approval token, or arbitrary error text into the sink.
  - Wiring the sink into UI, support bundle, receipt store, OTLP, diagnostic-events, or any runtime adapter.
  - Changing feature flags, default-on, liveReady, productApproved, canary, approval, native fallback, retry, or rollback behavior.
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Remove the Main diagnostics service, its focused test, and the terminal-api integration; no data migration or persisted state exists.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p2-trace-diagnostics-main-adapter.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p2-trace-diagnostics-main-adapter.md --no-diff
  - pnpm exec vitest run tests/unit/host-trace-diagnostics.test.ts tests/unit/terminal-api.test.ts --maxWorkers=1
  - pnpm run typecheck:node
  - git diff --check
acceptance:
  - The Main service owns a process-local HMAC secret of at least 32 bytes and never returns it.
  - Envelope lineage is derived only from the consumed host approval and host-generated trace identifiers.
  - Only failed approved terminal executions are recorded.
  - The bounded sink keeps at most 200 records and drops the oldest record first.
  - Focused tests prove redaction, approval binding, failure classification, bounded retention, and terminal integration.
  - This slice does not claim TF-0066 complete and does not modify UI, support bundle, receipt store, runtime adapter, or product locks.
docs:
  required: false
  notes:
    - The adapter slice is internal Main-process behavior with no user-visible flow change.
---

# VerseShell P2-03 Main Host Trace Diagnostics Adapter

This slice continues TF-0066 after the signed diagnostics contract. It adds the
first production-reachable Main adapter boundary without widening the renderer,
receipt, support, or runtime surface.

## Ownership

The Main process owns:

1. A process-local HMAC secret.
2. Host-generated trace and span identifiers.
3. Approval-bound request lineage.
4. A bounded in-memory diagnostic sink.

The renderer, OpenClaw runtime, model, and support consumers do not receive the
secret or the envelope authority.

## Binding

The adapter records only after `consumeApprovedPermissionApproval` succeeds for
a terminal execution. The approval ID becomes the request ID; the run ID and
request hash are the only approval fields used for lineage. Raw command and
output remain in their existing owners and are never copied into diagnostics.

## Sink

The sink is Main-owned, in-memory, and capped at 200 records. Each record is the
signed envelope plus the safe summary produced by the existing diagnostics
contract. When the cap is reached the oldest record is dropped.

## Non-goals

- No UI, support bundle, receipt store, OTLP, or runtime adapter wiring.
- No persisted diagnostics or migration.
- No feature flag, default value, retry, fallback, approval, or rollout change.
