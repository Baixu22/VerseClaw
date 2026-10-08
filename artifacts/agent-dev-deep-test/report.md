# Agent Dev Deep Test

Generated: 2026-10-08T12:07:25.112Z

Result: pass

Decision: daily-loop-ok - All selected Agent Dev gates passed within hard limits.

Total elapsed: 74616ms

Modes: build=fresh, unit=full, typecheck=full, e2e=full

Build reuse reason: fresh build mode always runs pnpm run build:vite

## Decision

- Daily loop ready: yes
- Release ready: yes
- Budget status: watch
- Full gate complete: yes

Required full gates:

- None.

Trend: improved; same-mode delta -26406ms; sample count 20.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 16s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |
| pass | contract | no | 0s | `pnpm contract:check` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 0s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 1s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 4s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 0s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 0s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | no | 33s | `pnpm run build:vite` | Reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 17s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 0s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. e2e-build: 33386ms
2. playwright-agent-dev: 17442ms
3. typecheck: 15842ms
4. vitest-agent-dev: 3900ms
5. harness-agent-dev: 1317ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| watch | e2e-build | no | 33386ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |
| ok | playwright-agent-dev | no | 17442ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| ok | typecheck | no | 15842ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| ok | vitest-agent-dev | no | 3900ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| ok | harness-agent-dev | no | 1317ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | i18n | no | 607ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | comms-replay | no | 477ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | contract | no | 462ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| ok | comms-compare | no | 413ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench | no | 387ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | workbench-refresh | no | 371ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 67987ms | 4 | 0 | e2e-build |
| fast-pr | 5356ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 1261ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 41ms | pass |
| `pnpm run typecheck:node` | 10606ms | pass |
| `pnpm run typecheck:web` | 5527ms | pass |
| `pnpm run typecheck:test` | 11761ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|
| `dist/assets/editor-DzMeIm3m.js` | 3750.05 kB |
| `dist/assets/GeneratedFilesPanel-D1JRZopT.js` | 2376.99 kB |
| `dist-electron/main/index-BvI0jiun.js` | 1873.48 kB |
| `dist/assets/index-vcVXJr2g.js` | 1406.24 kB |
| `dist/assets/emacs-lisp-CXvaQtF9.js` | 779.88 kB |
| `dist/assets/cpp-UfJy6YNI.js` | 626.08 kB |
| `dist/assets/wasm-CG6Dc4jp.js` | 622.34 kB |
| `dist/assets/App-Cv1DuNyN.js` | 609.95 kB |

Playwright test durations:

| Duration | Test |
|---:|---|
| 8800ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 8300ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |
| 5700ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |
| 5300ms | tests\e2e\agent-dev-quality.spec.ts:60:7 › agent dev quality gates › captures a stable visual artifact for a seeded scenario |

## Optimization Recommendations

- e2e-build exceeded its target by 8386ms; Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build.
- Vite/Electron build is the dominant E2E setup cost; use pnpm agent-dev:deep-test:reuse after a fresh build for repeated local loops.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
