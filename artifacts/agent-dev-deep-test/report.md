# Agent Dev Deep Test

Generated: 2026-11-17T05:36:04.162Z

Result: pass

Decision: needs-full-gate - Daily-loop fast-path evidence passed; run the listed full gates before PR/release review.

Total elapsed: 75882ms

Modes: build=reused, unit=full, typecheck=cached, e2e=smoke

Build reuse reason: all required build artifacts are newer than relevant Agent Dev sources

## Decision

- Daily loop ready: yes
- Release ready: no
- Budget status: watch
- Full gate complete: no

Required full gates:

- `pnpm run build:vite`
- `pnpm run typecheck`
- `pnpm test:e2e:agent-dev-quality`

Trend: regressed; same-mode delta 37457ms; sample count 10.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 30s | `pnpm run typecheck:cached` | Fingerprint-cached node/web TypeScript safety for repeated Agent Dev diagnosis |
| pass | contract | no | 2s | `pnpm contract:check` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 1s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 5s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 13s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | yes | 0s | `reuse existing build` | Verified reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 20s | `pnpm run test:e2e:agent-dev-quality:smoke` | Smoke Agent Dev Settings > Developer Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. typecheck: 30297ms
2. playwright-agent-dev: 20033ms
3. vitest-agent-dev: 13271ms
4. harness-agent-dev: 4564ms
5. contract: 2205ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| watch | typecheck | no | 30297ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| watch | playwright-agent-dev | no | 20033ms | 15000ms | 25000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| watch | vitest-agent-dev | no | 13271ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| watch | harness-agent-dev | no | 4564ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| watch | contract | no | 2205ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| watch | i18n | no | 1203ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | comms-replay | no | 1360ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | comms-compare | no | 1054ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench | no | 868ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | workbench-refresh | no | 729ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |
| ok | e2e-build | yes | 1ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 54895ms | 4 | 1 | typecheck |
| fast-pr | 17547ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 3143ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 169ms | pass |
| `pnpm run typecheck:node` | 0ms | pass |
| `pnpm run typecheck:web` | 0ms | pass |
| `pnpm run typecheck:test` | 0ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|


Playwright test durations:

| Duration | Test |
|---:|---|
| 15400ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |

## Optimization Recommendations

- typecheck exceeded its target by 5297ms; Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.
- playwright-agent-dev exceeded its target by 5033ms; Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
- vitest-agent-dev exceeded its target by 3271ms; Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.
- Build reuse skipped e2e-build after verifying dist and dist-electron artifacts are fresh enough for the selected Playwright loop.
- cached typecheck mode is reported separately from the default full gate; run pnpm run typecheck before review or release if this was a local-only loop.
- Smoke E2E mode covers the Workbench record path only; run the full Agent Dev quality E2E before review or release.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.
- Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.
