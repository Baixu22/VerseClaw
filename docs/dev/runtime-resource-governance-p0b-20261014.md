# Runtime Resource Governance P0B

Status: implemented and locally verified on 2026-10-14 (agent-driven).

Issue: #213 Work Package B.

## Problem closed

Main terminal leases and Gateway runtime leases had independent capacities, while the efficiency sampler only read the Main process itself. There was no single shadow view that explained per-workspace active slots, queue depth/wait, process-tree CPU/RSS/process count, owner and over-limit candidates, and no cross-process total.

## Changes

- Added a typed `ResourceEnvelope` schema and ledger with:
  - resource kind, priority, owner, workspace key;
  - active slots, queue depth, queue wait;
  - process count, tree RSS, tree CPU, PIDs;
  - memory/CPU/process/slot/queue hard limits;
  - shadow admission that records exceeded dimensions but always permits;
  - cross-owner snapshot merging for Main + Gateway totals.
- Added a process-tree sampler:
  - Windows through `Get-CimInstance Win32_Process`;
  - Linux through `/proc`;
  - unsupported/failed discovery returns `unknown` with null metrics;
  - empty roots return `empty`, not a fake healthy zero;
  - CPU percent is computed from real cumulative CPU-time deltas.
- Wired Main terminal leases and Gateway runtime workspace leases into the shadow ledger on queue, acquire, release and timeout.
- Added a bounded, unref'd, minimum-5s Gateway snapshot write cadence; malformed/missing snapshots fail closed to a warning.
- Exposed the aggregated snapshot through the `resourceEnvelope.getState` host-api read surface. No UI was added and no admission path changed.

## Scope boundary

This change intentionally does not implement control-mode shedding, watermark hysteresis, foreground/background deferral, or the Work Package D stress matrix. Those remain open under #213.

## Verification

- `pnpm exec vitest run tests/unit/resource-envelope.test.ts tests/unit/process-tree-sampler.test.ts tests/unit/resource-leases.test.ts tests/unit/resource-envelope-api.test.ts tests/unit/runtime-efficiency-api.test.ts` -> 5 files / 20 tests passed.
- `pnpm exec vitest run --config vitest.config.ts src/agents/resource-leases.test.ts src/process/os-containment.test.ts` -> 2 files / 9 tests passed.
- `pnpm run typecheck` -> success, 0 errors in node/web/test projects.
- `pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0b-20261014.md` -> Spec is valid.
- `pnpm contract:check` -> Contract check passed.
- `pnpm run comms:replay` -> wrote `artifacts/comms/current-metrics.json`.
- `pnpm run comms:compare` -> PASS; all comms thresholds within budget.

All evidence is agent-generated. No real-human evidence is claimed.