# Agent Dev Deep Test

Generated: 2026-11-15T02:22:07.275Z

Result: fail

Decision: blocked - typecheck failed; inspect stdoutTail/stderrTail before relying on this run.

Total elapsed: 50605ms

Modes: build=reused, unit=full, typecheck=full, e2e=full

Build reuse reason: all required build artifacts are newer than relevant Agent Dev sources

## Decision

- Daily loop ready: no
- Release ready: no
- Budget status: limit
- Full gate complete: no

Required full gates:

- `pnpm run build:vite`

Trend: improved; same-mode delta -55947ms; sample count 5.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| fail | typecheck | no | 50s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |

## Bottlenecks

1. typecheck: 50438ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| limit | typecheck | no | 50438ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 50438ms | 1 | 0 | typecheck |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 145ms | pass |
| `pnpm run typecheck:node` | 31401ms | fail |
| `pnpm run typecheck:web` | 28969ms | pass |
| `pnpm run typecheck:test` | 40447ms | fail |

Largest build assets:

| Asset | Size |
|---|---:|
| - | - |

Playwright test durations:

| Duration | Test |
|---:|---|
| - | - |

## Optimization Recommendations

- typecheck exceeded its hard limit by 5438ms; Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.
- Build reuse skipped e2e-build after verifying dist and dist-electron artifacts are fresh enough for the selected Playwright loop.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
