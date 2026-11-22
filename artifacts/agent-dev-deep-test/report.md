# Agent Dev Deep Test

Generated: 2026-11-22T18:44:45.461Z

Result: pass

Decision: blocked - vitest-agent-dev, typecheck, contract exceeded hard performance limits.

Total elapsed: 207951ms

Modes: build=reused, unit=full, typecheck=full, e2e=full

Build reuse reason: all required build artifacts are newer than relevant Agent Dev sources

## Decision

- Daily loop ready: no
- Release ready: no
- Budget status: limit
- Full gate complete: no

Required full gates:

- `pnpm run build:vite`

Trend: improved; same-mode delta -102013ms; sample count 2.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 68s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |
| pass | contract | no | 17s | `node scripts/contract-check.mjs` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 1s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 2s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 90s | `C:\Users\27933\AppData\Roaming\nvm\v24.22.1\node.exe node_modules/vitest/vitest.mjs run --config vitest.agent-dev.node.config.ts tests/unit/agent-dev-api.test.ts tests/unit/agent-dev-regularization.test.ts tests/unit/agent-dev-scenario-composer.test.ts tests/unit/agent-dev-schemas.test.ts tests/unit/contract-check.test.ts tests/unit/i18n-lint.test.ts tests/unit/host-api-facade.test.ts --maxWorkers=1 --no-file-parallelism` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | yes | 0s | `reuse existing build` | Verified reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 27s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. vitest-agent-dev: 89508ms
2. typecheck: 67982ms
3. playwright-agent-dev: 27308ms
4. contract: 16971ms
5. harness-agent-dev: 1959ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| limit | vitest-agent-dev | no | 89508ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| limit | typecheck | no | 67982ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| limit | contract | no | 16971ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| watch | playwright-agent-dev | no | 27308ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| ok | harness-agent-dev | no | 1959ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | i18n | no | 970ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | comms-replay | no | 841ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | comms-compare | no | 820ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench-refresh | no | 703ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |
| ok | workbench | no | 696ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | e2e-build | yes | 1ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 97250ms | 4 | 1 | typecheck |
| fast-pr | 108145ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 2364ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 61ms | pass |
| `pnpm run typecheck:node` | 18818ms | pass |
| `pnpm run typecheck:web` | 18207ms | pass |
| `pnpm run typecheck:test` | 48200ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|


Playwright test durations:

| Duration | Test |
|---:|---|
| 14600ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 14500ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |
| 9200ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |
| 8800ms | tests\e2e\agent-dev-quality.spec.ts:60:7 › agent dev quality gates › captures a stable visual artifact for a seeded scenario |

## Optimization Recommendations

- vitest-agent-dev exceeded its hard limit by 68508ms; Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.
- typecheck exceeded its hard limit by 22982ms; Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.
- contract exceeded its hard limit by 13971ms; Keep contract scanning text-based and bounded to host-api/service sources.
- playwright-agent-dev exceeded its target by 2308ms; Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
- Build reuse skipped e2e-build after verifying dist and dist-electron artifacts are fresh enough for the selected Playwright loop.
- Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.
