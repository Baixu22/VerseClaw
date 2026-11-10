# Agent Dev Deep Test

Generated: 2026-11-10T19:00:43.310Z

Result: pass

Decision: needs-full-gate - Daily-loop fast-path evidence passed; run the listed full gates before PR/release review.

Total elapsed: 76431ms

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

Trend: improved; same-mode delta -71948ms; sample count 3.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 35s | `pnpm run typecheck:cached` | Fingerprint-cached node/web TypeScript safety for repeated Agent Dev diagnosis |
| pass | contract | no | 2s | `pnpm contract:check` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 1s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 3s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 7s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | yes | 0s | `reuse existing build` | Verified reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 23s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. typecheck: 35092ms
2. playwright-agent-dev: 23429ms
3. vitest-agent-dev: 7312ms
4. harness-agent-dev: 3040ms
5. contract: 1771ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| watch | typecheck | no | 35092ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| watch | contract | no | 1771ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| watch | i18n | no | 1451ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| watch | harness-agent-dev | no | 3040ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | playwright-agent-dev | no | 23429ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| ok | vitest-agent-dev | no | 7312ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| ok | comms-replay | no | 1209ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | comms-compare | no | 1123ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench | no | 983ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | workbench-refresh | no | 925ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |
| ok | e2e-build | yes | 1ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 61562ms | 4 | 1 | typecheck |
| fast-pr | 11517ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 3257ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 87ms | pass |
| `pnpm run typecheck:node` | 19748ms | pass |
| `pnpm run typecheck:web` | 9157ms | pass |
| `pnpm run typecheck:test` | 28304ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|


Playwright test durations:

| Duration | Test |
|---:|---|
| 11600ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 11500ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |
| 7700ms | tests\e2e\agent-dev-quality.spec.ts:60:7 › agent dev quality gates › captures a stable visual artifact for a seeded scenario |
| 7700ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |

## Optimization Recommendations

- typecheck exceeded its target by 10092ms; Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.
- contract exceeded its target by 771ms; Keep contract scanning text-based and bounded to host-api/service sources.
- i18n exceeded its target by 451ms; Keep literal namespace scans bounded to source and locale directories.
- Build reuse skipped e2e-build after verifying dist and dist-electron artifacts are fresh enough for the selected Playwright loop.
- cached typecheck mode is reported separately from the default full gate; run pnpm run typecheck before review or release if this was a local-only loop.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.
- Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.
