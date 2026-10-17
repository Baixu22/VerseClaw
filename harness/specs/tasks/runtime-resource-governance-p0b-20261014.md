---
lifecycleStatus: active
id: runtime-resource-governance-p0b-20261014
title: Runtime Resource Governance P0B - shadow Resource Envelope and process-tree sampling
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close issue #213 Work Package B by adding a shadow workspace Resource Envelope across Main and Gateway, wiring existing Main/runtime leases into it, and recording fail-closed process-tree CPU, RSS, process-count, queue-depth and queue-wait evidence without changing foreground admission.
touchedAreas:
  - openclaw_runtime/src/resources/resource-envelope.ts
  - openclaw_runtime/src/resources/resource-envelope-snapshot-store.ts
  - openclaw_runtime/src/process/process-tree-sampler.ts
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/agents/resource-leases.test.ts
  - electron/services/resource-leases.ts
  - electron/services/resource-envelope.ts
  - electron/services/resource-envelope-api.ts
  - packages/versebrowser/src/engine/service.ts
  - electron/services/mcp-api.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/gateway/process-launcher.ts
  - electron/main/ipc-handlers.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/resource-envelope.test.ts
  - tests/unit/resource-envelope-api.test.ts
  - tests/unit/process-tree-sampler.test.ts
  - tests/unit/resource-leases.test.ts
  - harness/specs/tasks/runtime-resource-governance-p0b-20261014.md
  - docs/dev/runtime-resource-governance-p0b-20261014.md
expectedUserBehavior:
  - Main terminal and runtime workspace leases appear in one shadow Resource Envelope with owner, priority, queue depth and queue wait.
  - The same workspace can aggregate Main and Gateway totals, so two independent leases cannot hide their combined slot count.
  - Browser sessions, configured MCP servers and provider runtime syncs write shadow envelope entries with explicit owner and priority.
  - Process-tree sampling reports tree CPU, tree RSS, process count and source, while empty/unknown discovery fails closed instead of fabricating a healthy zero.
  - Shadow mode records over-limit candidates but always permits work; foreground behavior and all existing lease capacities remain unchanged.
  - Gateway snapshots are written through an unref'd, minimum-5s background cadence and are best-effort; a missing or malformed snapshot is reported as unavailable.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - runtime-efficiency-observability-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-resource-governance-p0b-20261014.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0b-20261014.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0b-20261014.md
  - pnpm exec vitest run tests/unit/resource-envelope.test.ts tests/unit/process-tree-sampler.test.ts tests/unit/resource-leases.test.ts tests/unit/runtime-efficiency-api.test.ts
  - pnpm exec vitest run --config vitest.config.ts src/agents/resource-leases.test.ts src/process/os-containment.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - A typed ResourceEnvelope records workspace, kind, priority, owner, active slots, queue depth, queue wait, process count, tree RSS, tree CPU, PIDs and hard limits.
  - Shadow evaluation records exceeded dimensions and always returns allow=true.
  - Main and Gateway snapshots merge into one report whose totals sum adjacent leases instead of hiding them.
  - Process-tree sampling returns real Windows CIM or Linux /proc values on supported platforms; empty discovery returns status=empty and discovery failure returns status=unknown with null metrics.
  - Main terminal leases and runtime workspace leases update the shadow envelope on queue, acquire, release and timeout.
  - Browser session open/close, MCP server sync and provider runtime sync/removal update the same shadow ledger.
  - Existing Main and runtime lease tests remain green and no foreground admission path changes.
docs:
  required: true
  paths:
    - docs/dev/runtime-resource-governance-p0b-20261014.md
---

# Runtime Resource Governance P0B

This task closes issue #213 Work Package B. It adds the shadow accounting and process-tree measurement foundation described by the issue; it does not enable control-mode shedding or Work Packages C-D.

## Scope

- Define the shared Resource Envelope dimensions, limits, exceeded candidates and merge rules.
- Persist/read per-owner snapshots for cross-process aggregation.
- Sample real process-tree CPU, RSS and process count with fail-closed empty/unknown states.
- Wire Main terminal leases and Gateway runtime leases into the shadow ledger.
- Expose the aggregated snapshot through the host-api read surface without a UI change.

## Out of scope

- Control-mode admission, background deferral, watermark hysteresis and shed consumers (Work Package C).
- End-to-end pressure benchmarks and release gates (Work Package D).
- Replacing existing owner-specific lease cleanup or changing lease capacities/defaults.