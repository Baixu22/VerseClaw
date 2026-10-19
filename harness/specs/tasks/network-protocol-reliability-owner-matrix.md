---
lifecycleStatus: active
id: network-protocol-reliability-owner-matrix
title: Network, protocol and error reliability owner matrix
scenario: gateway-backend-communication
task_forest:
  - TF-0437
  - TF-0443
taskType: runtime-bridge
intent: Freeze one owner for each network/protocol/error reliability component before implementing retry budgets, gateway client convergence, provider circuit breakers, stream recovery and deadlines. This task also removes the junction-sensitive naive entrypoint check from scripts that can silently no-op.
touchedAreas:
  - docs/dev/network-protocol-reliability/owner-matrix.md
  - docs/dev/network-protocol-reliability/current-gaps.md
  - harness/specs/tasks/network-protocol-reliability-owner-matrix.md
  - harness/specs/tasks/end-to-end-deadline-v1.md
  - harness/specs/tasks/gateway-client-single-owner-v1.md
  - harness/specs/tasks/network-reliability-fault-injection-v1.md
  - harness/specs/tasks/network-retry-budget-v1.md
  - harness/specs/tasks/provider-endpoint-circuit-breaker-v1.md
  - harness/specs/tasks/stream-failure-recovery-v1.md
  - shared/network-protocol-reliability-owners.json
  - tests/unit/network-protocol-owner-matrix.test.ts
  - scripts/**
expectedUserBehavior:
  - 组件职责在实现前已冻结为单一 owner，评审能看到未接线与重叠项的真实处置。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - error-governance-boundary
  - provider-error-retry-boundaries
  - comms-regression
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/network-protocol-owner-matrix.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/network-protocol-reliability-owner-matrix.md
acceptance:
  - The owner matrix covers Gateway client, RateCircuitBreaker and CircuitBreaker, retryAsync/agent auto-retry/model fallback, provider outbound budget, GatewayRpcBackpressure, host timeouts, OTel attempt observation and entrypoint detection.
  - Every unconnected component has a source path and a named downstream NET node; no placeholder "future integration" statement is accepted.
  - Every overlapping component has exactly one disposition: retain, merge, delete or explicit one-way adapter.
  - Every script using the naive main-entrypoint comparison is replaced with the realpath-safe helper and a junction regression proves it cannot exit zero with empty stdout.
  - A static guard rejects a new parallel owner for the same declared component.
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/owner-matrix.md
    - docs/dev/network-protocol-reliability/current-gaps.md
---

# Scope

This task is the gate for the NET-A..G sequence. It does not implement provider circuit breaking, Gateway convergence or stream recovery; it freezes ownership and removes the proven fail-open entrypoint check.

# Ownership contract

The machine-readable owner registry is `shared/network-protocol-reliability-owners.json`. It is intentionally narrow: the guard only scans the files declared there, plus the script entrypoint surface. It does not attempt a fuzzy whole-repository duplicate detector.

The entrypoint surface is every `.mjs`, `.js`, `.ts`, or `.cjs` file under `scripts/`. Each such file that performs a main-entrypoint comparison must import `isMainEntrypoint` from `scripts/lib/entrypoint.mjs`. Direct comparisons between `process.argv[1]` and `import.meta.url` are rejected, including `pathToFileURL` variants.

# Acceptance evidence

- `owner-matrix.md` and `current-gaps.md` are read from disk and checked against the registry.
- The unit test exercises the registry negative fixture: adding a second authority for a declared component fails.
- The junction regression runs a script through a junction whose target and entrypoint spellings differ; it must execute and produce non-empty stdout with exit code 0.
- `pnpm run typecheck` and `pnpm harness validate --spec harness/specs/tasks/network-protocol-reliability-owner-matrix.md` are rerun for the final candidate.
- Evidence is written under `artifacts/network-protocol-reliability/net-root/` with `driven_by: agent`; no human or live-provider evidence is claimed.
