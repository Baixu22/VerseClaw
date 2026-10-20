---
lifecycleStatus: active
id: resource-fabric-p2-admission
title: P2 ResourceFabric unified admission for TF-0408
type: task
intent: Replace the workspace exec lease manager and chat.history backpressure queue with one Main-owned ResourceFabric account path using adaptive limits, QoS queues, priority boost and DRF-lite accounting, while retaining the shadow resource-envelope ledger.
scenario: gateway-backend-communication
taskType: runtime-bridge
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - gateway-backend-communication
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - electron/services/resource-fabric.ts
  - electron/services/resource-leases.ts
  - electron/services/terminal-api.ts
  - electron/services/gateway-api.ts
  - electron/services/resource-fabric.ts
  - electron/main/ipc-handlers.ts
  - shared/types/resources.ts
  - shared/resources/adaptive-limit.ts
  - shared/resources/priority-queue.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - tests/unit/resource-fabric-workspace-exec.test.ts
  - tests/unit/resource-fabric-chat-history.test.ts
  - tests/unit/resource-leases.test.ts
  - tests/unit/gateway-rpc-backpressure.test.ts
  - tests/unit/resource-fabric-invariants.test.ts
  - tests/unit/resource-fabric-pressure.test.ts
  - tests/unit/resource-fabric-primitives.test.ts
  - tests/unit/terminal-api.test.ts
  - harness/specs/tasks/resource-fabric-p2-admission.md
  - harness/specs/fixtures/tf0408-resource-fabric/**
expectedUserBehavior:
  - Terminal commands and chat history remain usable while the Main process bounds their real resource usage.
  - A long or bursty workload waits in a QoS-aware queue instead of spawning unbounded workspace exec processes or distinct history RPCs.
  - Resource-envelope diagnostics expose fairness and limit transitions for later audit.
requiredTests:
  - tests/unit/resource-fabric-workspace-exec.test.ts
  - tests/unit/resource-fabric-chat-history.test.ts
  - tests/unit/resource-fabric-invariants.test.ts
  - tests/unit/resource-fabric-pressure.test.ts
  - tests/unit/resource-fabric-primitives.test.ts
  - tests/unit/terminal-api.test.ts
acceptance:
  - Workspace exec and chat.history both acquire/release through one ResourceFabric implementation; the legacy lease/backpressure state is removed.
  - Workspace exec and chat.history limits are Gradient2 adaptive with min 1 / max 4, and no caller owns a hardcoded capacity constant.
  - Every limit adjustment updates the resource-envelope entry and retains a bounded replayable limit history.
  - I1 (interactive never rejected by limit), I2 (active <= current limit), and I3 (DRF-lite two-times fairness bound) each have an independent test.
  - A 20 concurrent exec plus 20 history pressure run has zero timeouts and records its limit trace.
docs:
  required: false
---

# TF-0408 P2 ResourceFabric Admission

## Objective

Make the Main process own one cooperative admission path for the two hotspots
already identified by the Resource Fabric plan: workspace exec process slots and
distinct `chat.history` RPCs. The old lease/backpressure implementations must not
remain as parallel schedulers.

## Scope

- One `ResourceFabric` with per-resource Account objects.
- QoS classes `interactive`, `background`, `opportunistic`, priority boost and
  opportunistic aging from the P0 primitives.
- Gradient2 adaptive limits: initial 2, min 1, max 4 for workspace exec and
  chat.history.
- DRF-lite accounting across tenants; the fabric exposes fairness diagnostics.
- `workspaceExec` keeps per-workspace isolation; `chat.history` keeps global
  distinct-request admission and in-flight duplicate coalescing.
- Limit transitions update `resource-envelope` entries with bounded
  `limitHistory`.

## Acceptance

- `pnpm exec vitest run tests/unit/resource-fabric-workspace-exec.test.ts tests/unit/resource-fabric-chat-history.test.ts tests/unit/resource-fabric-invariants.test.ts tests/unit/resource-fabric-pressure.test.ts tests/unit/resource-fabric-primitives.test.ts tests/unit/terminal-api.test.ts` passes.
- `pnpm run typecheck:node`, `typecheck:web`, `typecheck:test` pass.
- `pnpm run contract:check`, `pnpm harness validate --spec harness/specs/tasks/resource-fabric-p2-admission.md` and `pnpm repo:artifacts:check` pass.
- The pressure report records 20 exec + 20 history, zero timeouts, fairness and
  at least one replayable limit transition.