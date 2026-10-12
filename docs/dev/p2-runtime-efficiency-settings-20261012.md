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
| `node node_modules/@playwright/test/cli.js test tests/e2e/settings-efficiency-sampling.spec.ts` | 1 passed (x3) |

### Electron E2E

`tests/e2e/settings-efficiency-sampling.spec.ts` covers the switch and the
readout in a real Electron boot: the Developer switch is unlocked, the toggle is
flipped off and on, each state is read back through
`hostApi.efficiency.getState`, and the fail-closed `not sampled` readout is
asserted before the first 5s sample.

**Result: 1 passed** (run three times on 2026-10-12, exit 0 each time). Log:
`D:/ClawX-work/p2-161-efficiency-settings-20261012/16-e2e-final-after-acl-fix.log`.

The spec initially could not run because `vite build` failed with
`[vite:esbuild-transpile] remove ...: Access is denied`. The root cause was
isolated on the authoring host and is **not** a repository or change defect: the
pnpm store copy of `@esbuild/win32-x64@0.27.4`'s `esbuild.exe` carried a Windows
**Low mandatory integrity label** (SACL). The esbuild service process therefore
inherited Low IL and could not unlink the transform temp file that Node created
at Medium IL. Replacing the labelled binary with a byte-identical clean copy
(`esbuild.exe` SHA-256 `39EE9D16...E337A7`, matching the registry artefact) made
the unmodified tree build and pass E2E. `node_modules/.../esbuild/lib/main.js`
is byte-identical to the pristine 0.27.4 package (SHA-256
`578F8144805EC3681CB318F0AAD0C8F6EDE19A78BC8CE75F85B1B31D2B35C05A`), so no
esbuild source was patched to obtain this result.

GitHub Actions E2E still cannot substitute for local evidence: every job fails to
start because of an account billing/spending limit.

Executed renderer coverage of the same interaction also exists in
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
