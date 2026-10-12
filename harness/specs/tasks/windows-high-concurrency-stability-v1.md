---
lifecycleStatus: archived
id: windows-high-concurrency-stability-v1
title: Windows high-concurrency stability orchestration v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Historical Windows concurrency design; executable checks cover only the current Main terminal.run workspaceExec admission lease, not a general runtime resource scheduler.
touchedAreas:
  - docs/dev/p1-terminal-exec-lease-20261012/acceptance.json
  - docs/dev/p1-terminal-exec-lease-20261012/SHA256SUMS
  - harness/specs/tasks/p1-terminal-exec-lease-20261012.md
  - harness/specs/tasks/stress-test-windows-concurrency-v1.md
  - docs/dev/p1-terminal-exec-lease-20261012.md
  - docs/dev/windows-runtime-efficiency-observability.md
  - scripts/repository-artifacts.json
  - .gitignore
  - harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - electron/services/terminal-api.ts
  - electron/services/resource-leases.ts
  - shared/host-api/contract.ts
  - tests/unit/resource-leases.test.ts
  - tests/unit/terminal-api.test.ts
expectedUserBehavior:
  - Main terminal.run admission is bounded per real workspace path; other resource kinds are not implemented by this lease manager.
  - Both normal and approved terminal.run paths wait before Gateway exec RPC attempts and return structured admission-timeout diagnostics.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - pnpm exec vitest run tests/unit/resource-leases.test.ts tests/unit/terminal-api.test.ts tests/unit/workspace-permissions.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/agent-steering-team-bundle.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The Main workspaceExec lease has capacity 2, per-key FIFO, bounded acquisition, finally release, and queuedMs metadata.
  - Existing Windows workspace paths resolve through realpath and case/slash variants share one lease key.
  - terminal.run acquires the lease before normal and approved Gateway exec RPC attempts.
  - Lease timeout leaves no pending effect and reports leaseKind, leaseKey and timeoutMs.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
---

This task does not introduce Docker/SSH isolation or new UI surfaces. It keeps policy-light as the default control-plane sandbox and prioritizes stability over maximum throughput.

## Current implementation boundary (2026-10-12, issue #162)

This archived design is not proof of runtime-wide concurrency control. The active
repair is `p1-terminal-exec-lease-20261012`. Only Main `terminal.run` RPC admission
uses `electron/services/resource-leases.ts`; it is not an OS-process limit and
does not govern interactive `terminal.open`, agent exec tools or cross-process work.
The deleted runtime `ResourceLeaseManager` is not a current source dependency.

The original workspaceSearch/workspaceWriter/subtreeMutation/fileMutation leases,
parent-realpath fallback for missing targets, and long-running-terminal deduplication
are outside this repair. Search and mutation budgets remain unimplemented (#167);
their old acceptance statements are design history, not verified capability claims.
