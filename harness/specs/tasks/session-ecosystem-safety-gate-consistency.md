---
lifecycleStatus: archived
id: session-ecosystem-safety-gate-consistency
title: Session ecosystem safety gates and delete retry consistency
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the TF-0080 gaps where production lifecycle mutations can bypass admission or delete journaling, and make unknown/partial retries fail closed without duplicate local effects.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-safety-gate-consistency.md
  - openclaw_runtime/src/sessions/session-admission-registry.ts
  - openclaw_runtime/src/sessions/session-admission-registry.test.ts
  - openclaw_runtime/src/sessions/session-delete-operation-id.ts
  - openclaw_runtime/src/sessions/session-delete-operation-id.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/session-delete-operation-journal.ts
  - openclaw_runtime/src/gateway/session-delete-operation-journal.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.runtime.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/auto-reply/reply/session-hooks.ts
  - openclaw_runtime/src/auto-reply/reply/session-hooks.test.ts
  - openclaw_runtime/src/plugins/hook-types.ts
  - openclaw_runtime/src/agents/openclaw-tools.subagents.sessions-spawn.test-harness.ts
  - openclaw_runtime/src/gateway/session-transcript-files.fs.ts
  - openclaw_runtime/src/agents/subagent-session-cleanup.ts
  - openclaw_runtime/src/agents/subagent-registry-lifecycle.ts
  - openclaw_runtime/src/config/sessions/artifacts.ts
  - openclaw_runtime/src/cron/isolated-agent/delivery-dispatch.ts
  - electron/services/session-delete-gate.ts
  - electron/services/sessions-api.ts
  - electron/services/terminal-api.ts
  - electron/utils/atomic-write.ts
  - electron/utils/session-files.ts
  - src/stores/chat.ts
  - src/stores/chat.ts
  - tests/unit/runtime-lifecycle-governance.test.ts
  - tests/unit/session-delete-gate.test.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/terminal-session-manager.test.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - artifacts/session-ecosystem-safety-gate-consistency/report.json
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Reset, delete, and stop fence the current session generation before queue, process, child, goal, or terminal side effects can enter.
  - Production side-effect callers cannot silently downgrade to a no-op admission permit; required lifecycle paths have no compatibility no-op.
  - Every sessions.delete caller supplies a stable operationId and receives content-sensitive journal idempotency.
  - Nested archive-plan changes alter the manifest digest; generation and operation-id conflicts fail closed.
  - RPC timeout/socket drop never sweeps local artifacts or releases the Electron mirror gate.
  - Runtime committed receipts, partial retries, and local mirror recovery do not duplicate archive, terminal close, or finalization effects.
  - A successful RPC with deleted=false is not treated as a safe local delete completion.
  - Hook delivery carries the delete operationId; journaled local effects remain the retry authority and plugin hooks keep their existing fail-open policy.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-safety-gate-consistency.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-safety-gate-consistency.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts src/sessions/session-admission-registry.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/sessions/session-delete-operation-id.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts src/gateway/session-delete-operation-journal.test.ts src/gateway/session-ecosystem-production-reachability.test.ts
  - pnpm exec vitest run tests/unit/session-delete-gate.test.ts tests/unit/r0-2-sessions-delete-fail.test.ts tests/unit/runtime-lifecycle-governance.test.ts tests/unit/terminal-api.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
  - git diff --check
acceptance:
  - Required production admission callers acquire a real permit with the environment unset, and a 100-iteration fence race admits zero stale side effects.
  - Required admission callers always use the real registry; there is no production no-op flag path.
  - A delete operation with operationId persists intent and store_committed state with the same SQLite transaction as cache_entries deletion.
  - Manifest digest canonicalization is recursive and distinguishes archive-plan, generation, transcript, and operation changes.
  - intent, store_committed, partial_committed, and runtime_committed retries obey the documented state machine and generation conflict rules.
  - Unknown RPC, non-ok RPC, and deleted=false preserve the mirror gate and perform zero local sweep/terminal-close effects.
  - A committed retry runs each local mirror effect at most once, requires a matching non-empty sessionId, and clears the gate only after all required effects succeed.
  - Gate read-modify-write updates are protected by an atomic file lock/write; same-session delete requests coalesce and terminal-open admission fails closed while the critical section is occupied.
  - Delete lifecycle hook payloads carry the stable operationId and finalization checkpoints are written after awaited dispatch; hook handlers remain fail-open by the existing plugin contract.
  - No Goal-wake/durable-helper implementation or product lock is changed.
docs:
  required: true
  files:
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Session ecosystem safety gates and delete retry consistency

This is the single TF-0080 implementation slice. It repairs production reachability and
fail-closed retry semantics only. Goal-wake, durable-helper, universal resource ledgers, and
product approval remain out of scope.

## Scope

- Add an explicit required admission path for every existing production side-effect caller.
- Keep the legacy feature flag as an opt-in/kill-switch compatibility surface, but never let a
  required lifecycle mutation use its no-op behavior.
- Make delete journaling activate from a caller-supplied operationId and preserve the flag-gated
  probe for compatibility.
- Replace shallow manifest hashing with recursive deterministic canonicalization.
- Persist enough Electron mirror progress to resume committed work without duplicate effects.

## Failure matrix

The focused matrix must cover, at minimum:

| Case | Required result |
| --- | --- |
| 100 concurrent permit/fence attempts | zero stale admissions after fence |
| operationId + env unset | journal intent/store commit are present |
| same operationId + nested archive change | digest conflict |
| generation mismatch | invalid request, no mutation |
| timeout/socket drop | no sweep, no terminal close, gate retained |
| ok + deleted=false | no local cleanup, gate retained |
| runtime_committed retry | saved receipt, each mirror effect once |
| partial_committed retry | finalizer resumes without duplicate archive/close |

## Non-goals

- No Goal-wake or durable-helper changes.
- No renderer-facing lifecycle API.
- No agent-wide kill fallback, universal resource ledger, or product approval change.
