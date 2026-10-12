# Settings toggle and host-api surface for runtime efficiency sampling (issue #161)

- Date: 2026-10-12
- Issue: #161
- driven_by: agent
- actor: codex
- Base: `origin/main = 0f39d3ac9`
- Spec: `harness/specs/tasks/p2-runtime-efficiency-settings-20261012.md`

## Problem

The Main-process measurement core landed earlier
(`docs/dev/windows-runtime-efficiency-observability.md`): a sampler over real OS
counters, a shed policy, an orchestrator, and a fail-closed validator. But the
sampler state lived **only inside the Main process**:

- no Settings switch, so the user could not see or stop sampling;
- no `shared/host-api/contract.ts` / `src/lib/host-api.ts` read method;
- no renderer surface.

## What landed

- **Contract** — `shared/host-api/contract.ts` gains an `efficiency` module
  (`getState`, `setEnabled`) plus `RuntimeEfficiencyState` /
  `RuntimeEfficiencySummary` / `RuntimeEfficiencySample` /
  `RuntimeEfficiencyShedState`.
- **Main** — `electron/services/efficiency-api.ts` reads the orchestrator
  (latest sample, bounded rolling summary, shed state) and persists the toggle.
  `electron/main/index.ts` starts sampling only when the persisted
  `efficiencySamplingEnabled` setting is not `false`, so an opt-out survives a
  restart. `electron/utils/store.ts` adds the setting (default `true`, which is
  the pre-existing always-on behaviour, now user-settable).
- **Renderer** — `src/lib/host-api.ts` exposes `efficiency.getState` /
  `efficiency.setEnabled`; `src/components/settings/EfficiencySamplingPanel.tsx`
  renders the switch and readout inside Settings > Developer.
- **i18n** — `shared/i18n/locales/{en,zh,ja,ru}/settings.json` carry the new
  strings under `developer.efficiencySampling`.

## Fail-closed readout

The sampler returns a zeroed summary before its first sample. The host API
collapses that to `summary: null` with `measured: false`, so the panel shows an
explicit "not sampled" state. An unmeasured runtime is never rendered as a
healthy zero — this is the same boundary the
`runtime-efficiency-observability-boundary` rule requires of reports.

## Verification

| Gate | Result |
|---|---|
| `pnpm exec vitest run tests/unit/runtime-efficiency-api.test.ts` | 3 passed |
| `pnpm exec vitest run tests/unit/efficiency-sampling-panel.test.tsx` | 3 passed |
| `pnpm run typecheck:node` | exit 0 |
| `pnpm run typecheck:web` | exit 0 |
| `pnpm run typecheck:test` | exit 0 |
| `pnpm contract:check` | passed |
| `pnpm run i18n:lint` | passed |
| `pnpm run comms:replay` + `comms:compare` | exit 0 (all PASS) |
| `harness validate` (this spec + the archived concurrency specs) | valid |

### Electron E2E

`tests/e2e/settings-efficiency-sampling.spec.ts` covers the switch and the
readout. **It could not be executed in this environment**: `vite build` fails
with a reproducible esbuild temp-file error
(`[vite:esbuild-transpile] remove ...: Access is denied`). The identical failure
reproduces on a clean checkout of merged `origin/main` with no #161 code, so it
is an environment/toolchain defect, not this change. GitHub Actions cannot run
it either — every job fails to start because of an account billing/spending
limit.

Executed renderer coverage of the same interaction is provided instead by
`tests/unit/efficiency-sampling-panel.test.tsx` (jsdom): fail-closed readout,
measured readout, and the toggle persisting through `host-api`.

## Boundary

- No performance optimization and no improvement claim; a stored before/after
  artifact pair is still required for that.
- Sampling stays local; nothing is uploaded.
- No frozen product default changes: `efficiencySamplingEnabled` defaults to
  `true` and only the user can turn it off.
- Subagent fan-out quotas are untouched; the terminal exec lease remains the
  owner of that surface.
