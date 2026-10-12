# Windows Runtime Efficiency Observability (P0)

Task spec: `harness/specs/tasks/windows-runtime-efficiency-observability-v1.md`
Rule: `harness/specs/rules/runtime-efficiency-observability-boundary.md`
Evidence: `artifacts/runtime-efficiency/report.json`
Validator: `node scripts/validate-runtime-efficiency.mjs`

## Why this exists

`pnpm agent-dev:audit` scores 94/100 (`pass`), but its six dimensions —
gate-integrity, evidence-completeness, coverage-breadth, performance-discipline,
docs-runbook, maintainability — all measure the **Agent Dev toolchain**. None of
them observe the product runtime. A passing audit therefore says nothing about
whether the app burns CPU or memory on a Windows laptop.

Static inspection found the product had **no runtime efficiency measurement at
all**:

- `electron/utils/telemetry.ts` emits only `app_installed` and `app_opened`.
  No performance events.
- No `psutil` / `Get-Counter` / `GetProcessMemoryInfo` sampling anywhere.
- `deep-test` reports build and CI gate durations, never product CPU or memory.

Without measurement, rendering and concurrency optimizations can only be argued,
never proven. This is the P0 that unblocks them.

## What landed

### `electron/services/efficiency-sampler.ts`

Bounded, dependency-free sampler using Node builtins only.

- CPU percent is derived from **real cumulative `process.cpuUsage()` deltas**
  divided by a **real wall-clock delta** — never a constant or estimate.
- Records RSS, heap used, system free/total memory, and logical core count.
- Hard cap on retained samples (`maxSamples`, default 720 = 1h at 5s cadence),
  evicting oldest-first.
- The interval timer is `unref()`'d, so sampling never holds the process open.
- `stop()` clears the timer; `start()` is idempotent.
- All clock and counter readers are injectable, so the tests are deterministic.

### `electron/services/efficiency-power-policy.ts`

Pure, deterministic shed policy. No Electron imports, so the decision table is
unit testable without booting the app.

Inputs: `windowHidden`, `powerSaver`, `displaySleep`.
Reason precedence: `window-hidden` > `display-sleep` > `power-saver`.

- Emits an explicit transition only when the effective `(shedding, reason)` pair
  changes, with a monotonic `transitionCount` and `lastTransitionAt`.
- Keeps `activeReasons` fresh even when the effective state is unchanged, so
  diagnostics never report a stale reason set.
- Shedding only ever removes *background* work. There is intentionally no rule
  that gates user-initiated work.

### `electron/services/efficiency-orchestrator.ts`

The only Electron-aware piece. Wires the two pure modules to real events.

- `powerMonitor` for battery / suspend / unlock-screen, guarded by try/catch
  because it is unavailable in some headless and E2E environments.
- Per-window `hide` / `show` / `minimize` / `restore` listeners, torn down on
  close so no stale listener survives.
- Wired into `electron/main/index.ts`: started inside `app.whenReady()`, stopped
  inside `app.on('will-quit')` so quit never waits on the timer.

### `scripts/validate-runtime-efficiency.mjs`

Pure Node, no dependencies, so it runs in a bare checkout before `pnpm install`.

**Fails closed by design.** A zero-sample report, or coverage below the minimum,
is a failure — an unmeasured run is never reported as a healthy one.

## Verification status

All four required gates were executed in this checkout after `pnpm install`:

| Gate | Command | Result |
|---|---|---|
| Spec structure | `node harness/src/cli.mjs validate --spec <spec> --no-diff` | `Spec is valid`, exit 0 |
| Unit tests | `pnpm exec vitest run tests/unit/runtime-efficiency-sampler.test.ts tests/unit/runtime-efficiency-power-policy.test.ts` | 2 files, **18/18 passed**, exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0, errorCount 0, 25.8s (node + web + tests) |
| Evidence | `node scripts/validate-runtime-efficiency.mjs` | `self-validation passed`, exit 0 |

Evidence probe, real numbers:

```
[runtime-efficiency] OK: wrote ...\artifacts\runtime-efficiency\report.json
  samples=4 coverageMs=1578 avgCpu=22.34% peakRss=40MB
[runtime-efficiency] OK: self-validation passed
```

### Fail-closed is demonstrated, not just asserted

The validator has two profiles. The default `full` profile self-validates; the
`--quick` profile deliberately uses a short window and is **expected to fail**,
because a short coverage window must never read as healthy:

```
$ node scripts/validate-runtime-efficiency.mjs --quick --out .../quick-probe.json
  samples=3 coverageMs=687 avgCpu=22.74% peakRss=58MB
  FAIL: coverageMs 687 < required 1000        # exit 1, by design
```

`--validate-only` re-checks a stored artifact without re-probing, which is the
form used as a gate in the spec and the rule.

### Corrections made during verification

Three real defects were found and fixed by running the gates, not by review:

1. `powerMonitor` has no `on-battery-power` event. The correct cross-platform
   signal is `speed-limit-change`, which carries the OS-advertised CPU limit in
   percent. The listener now treats any limit below 100% as a power-saver state,
   which is stricter than inferring from battery presence.
2. A test expectation was wrong, not the policy: clearing `windowHidden` while
   `powerSaver` is still true is a genuine transition to `power-saver`, not to a
   fully unshed state. The test now asserts the real transition sequence.
3. `typecheck:node` caught an unused parameter and an `import type` misuse.

## Note on this checkout's path

The Windows checkout used for this run was reached through a **directory junction**, so
the same working tree had two path spellings (a link path and its target). They are one
working tree, not two checkouts; this record therefore cites repository-relative paths
only.

## What this does not do

- It does not change `app.disableHardwareAcceleration()`. The heavy
  visualizations (`AgentTraceGraph.tsx`, ClawGraph) are **SVG**, not WebGL, so
  enabling GPU compositing would not address the actual bottleneck. Rendering
  strategy is a separate decision that should consume these measurements.
- It does not add subagent fan-out quotas. `electron/services/resource-leases.ts`
  implements a FIFO `workspaceExec` lease (capacity 2, 30s timeout); it is wired
  into terminal execution by issue #162 (see
  `docs/dev/p1-terminal-exec-lease-20261012.md`). Search / writer / subtree
  leases do not exist and subagent spawn remains uncovered, owned by issue #167.
- It claims no performance improvement. Per the boundary rule, that requires a
  stored before/after artifact pair from agent-driven runs.

## Next

1. Install dependencies so the sampler and policy suites and `typecheck` can run.
2. Raise the probe coverage window so the default run self-validates, or keep
   fail-closed and require an explicit longer window.
3. Expose the summary over `host-api` so the renderer can display it.
4. Use the measurements to decide the rendering work, then record a before/after
   pair.