---
id: rc01r-receipt-owner-proof
title: RC-01R Receipt Owner Persistence Proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete the existing receipt-owner proof for TF-0029 using real SQLite failures, process restarts and concurrent writers, and repair the reproduced cross-kind idempotency violation in the existing ReceiptStore.
ownedPaths:
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/receipt-store.test.ts
  - openclaw_runtime/src/agents/rc02-shadow-census.acceptance.test.ts
  - harness/specs/tasks/rc01r-receipt-owner-proof.md
  - harness/specs/rules/runtime-authority-convergence-boundary.md
  - docs/dev/unified-agent-system/runtime-convergence/RC01-RECEIPT-OWNER-PROOF.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/receipt-store.test.ts
  - openclaw_runtime/src/agents/rc02-shadow-census.acceptance.test.ts
  - harness/specs/tasks/rc01r-receipt-owner-proof.md
  - harness/specs/rules/runtime-authority-convergence-boundary.md
  - docs/dev/unified-agent-system/runtime-convergence/RC01-RECEIPT-OWNER-PROOF.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - A repeated receipt key succeeds only when kind, version, identity, call indexes and content match the persisted receipt.
  - Changing receipt kind under an existing key returns content-conflict and preserves the original row, including across process restarts.
  - Existing receipt digests and schema remain readable without migration; creation time remains first-write metadata.
  - A failed SQLite write propagates from ReceiptStore to its existing shadow caller, which records failed evidence without changing payload bytes or send behavior.
  - No new receipt owner, default, provider request, network call, replay permission or product readiness is introduced.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - changing stored receipt digests, database schema or historical receipt rows
  - accepting cross-kind or cross-version writes as identical-content
  - treating a second object over a cached connection as process-restart evidence
  - using a creatable missing directory as failed-write evidence
  - changing runtime payload bytes, delivery, retry, approval, replay authority or product locks
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Revert the receipt identity comparison and its proof tests; no schema or stored-data rollback is required.
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts receipt-store.test.ts shadow-census.test.ts rc02-shadow-census.acceptance.test.ts --passWithNoTests=false
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/rc01r-receipt-owner-proof.md
acceptance:
  - Executed counter-tests reproduce cross-kind acceptance before the fix and reject it afterward while retaining the first receipt.
  - A separate Node process reads an old receipt committed by a process that has exited; no implicit retention policy removes it.
  - Concurrent Node writers sharing a SQLite file produce one inserted receipt and only identical-content duplicates or content-conflicts under one key.
  - An unusable database path causes a real write failure; existing shadow-census tests prove failure reporting and unchanged send bytes.
  - Existing receipt lookup, privacy validation, explicit retention, index identity and same-kind idempotency tests pass.
  - Source and stored digest formats, schema, accepted owner and product locks remain unchanged.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/RC01-RECEIPT-OWNER-PROOF.md
    - docs/dev/Sustained-Development-Playbook.md
---

This is a bounded repair within TF-0029's receipt-owner proof. A real SQLite probe
reproduced a context receipt being returned as an identical wire receipt under the
same idempotency key. The user's standing instruction authorizes fixing discovered
defects directly. This exception to the earlier inventory-only scope does not start
RC-02, select another owner, or replace independent engineering acceptance.

Reuse the existing receipt, shadow-census and state database implementation. Keep
the stored content digest stable and compare the persisted type/version alongside
it. Proof uses disposable databases only and does not access a production state store.

The agents Vitest config scopes discovery to `src/agents`; its CLI filters above
are relative to that directory. Keep `--passWithNoTests=false` so a path mismatch
cannot be reported as passing proof. The full embedded-runner case also requires
current bundled provider build artifacts; a missing artifact is a failed gate.
