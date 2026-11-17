# Agent Dev Deep Test

Generated: 2026-11-17T16:11:28.615Z

Result: pass

Decision: needs-full-gate - Daily-loop fast-path evidence passed; run the listed full gates before PR/release review.

Total elapsed: 63317ms

Modes: build=reused, unit=full, typecheck=cached, e2e=full

Build reuse reason: all required build artifacts are newer than relevant Agent Dev sources

## Decision

- Daily loop ready: yes
- Release ready: no
- Budget status: watch
- Full gate complete: no

Required full gates:

- `pnpm run build:vite`
- `pnpm run typecheck`

Trend: improved; same-mode delta -41981ms; sample count 5.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 10s | `pnpm run typecheck:cached` | Fingerprint-cached node/web TypeScript safety for repeated Agent Dev diagnosis |
| pass | contract | no | 2s | `pnpm contract:check` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 1s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 3s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 10s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 2s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | yes | 0s | `reuse existing build` | Verified reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 34s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. playwright-agent-dev: 33714ms
2. vitest-agent-dev: 9953ms
3. typecheck: 9526ms
4. harness-agent-dev: 3385ms
5. contract: 1549ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| watch | playwright-agent-dev | no | 33714ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| watch | contract | no | 1549ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| watch | harness-agent-dev | no | 3385ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| watch | i18n | no | 1015ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | vitest-agent-dev | no | 9953ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| ok | typecheck | no | 9526ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| ok | comms-replay | no | 1516ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | workbench-refresh | no | 1005ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |
| ok | comms-compare | no | 829ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench | no | 625ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | e2e-build | yes | 1ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 46626ms | 4 | 1 | playwright-agent-dev |
| fast-pr | 13142ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 3350ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 100ms | pass |
| `pnpm run typecheck:node` | 0ms | pass |
| `pnpm run typecheck:web` | 0ms | pass |
| `pnpm run typecheck:test` | 0ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|


Playwright test durations:

| Duration | Test |
|---:|---|
| 17600ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |
| 17600ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 8900ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |
| 8400ms | tests\e2e\agent-dev-quality.spec.ts:60:7 › agent dev quality gates › captures a stable visual artifact for a seeded scenario |

## Optimization Recommendations

- playwright-agent-dev exceeded its target by 8714ms; Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
- contract exceeded its target by 549ms; Keep contract scanning text-based and bounded to host-api/service sources.
- harness-agent-dev exceeded its target by 385ms; Keep the shared scenario baseline separate from task-specific changed-path ownership checks.
- Build reuse skipped e2e-build after verifying dist and dist-electron artifacts are fresh enough for the selected Playwright loop.
- cached typecheck mode is reported separately from the default full gate; run pnpm run typecheck before review or release if this was a local-only loop.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.
- Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
