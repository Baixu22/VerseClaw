# Runtime Resource Governance P0C

Status: implemented and locally verified on 2026-10-14 (agent-driven).

Issue: #213 Work Package C.

## Problem closed

The system exposed shed state, but no background worker actually consumed it. Work Package C adds a bounded background-work gate with high/low watermarks, minimum dwell, real defer/resume behavior and visible counters.

## Changes

- Added `BackgroundWorkGate` with:
  - foreground/background priority admission;
  - queue-depth, tree-RSS and tree-CPU high/low watermarks;
  - minimum dwell and anti-flip-flop transitions;
  - deferred/resume counters, pending work, last defer reason and transition count.
- Efficiency orchestrator now updates the gate from the efficiency sample, Resource Envelope totals and the existing window/power shed signal.
- Resource tracker heartbeat is routed through the gate as a real background consumer: it is deferred while shed is active and runs after resume.
- Efficiency host-api now exposes the real background-work state; Settings renders deferred/resume evidence instead of policy-only state.
- Gate timer is unref'd and stopped with efficiency sampling.

## Scope boundary

This closes Work Package C only. The Work Package D pressure/benchmark gate and additional provider/MCP/plugin prewarm consumers remain open. Foreground user work is never gated.

## Verification

- `pnpm exec vitest run tests/unit/background-work-gate.test.ts tests/unit/resource-tracker.test.ts tests/unit/efficiency-sampling-panel.test.tsx tests/unit/runtime-efficiency-api.test.ts tests/unit/runtime-efficiency-power-policy.test.ts` -> 5 files / 39 tests passed.
- `pnpm run typecheck` -> success, 0 errors in node/web/test projects.
- `pnpm i18n:lint` -> passed.
- `pnpm contract:check` -> passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0c-20261014.md` -> Spec is valid.

All evidence is agent-generated. No real-human evidence is claimed.