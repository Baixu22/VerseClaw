# Agent Dev Deep Test

Generated: 2026-11-13T09:13:48.548Z

Result: pass

Decision: daily-loop-ok - All selected Agent Dev gates passed within hard limits.

Total elapsed: 119570ms

Modes: build=fresh, unit=full, typecheck=full, e2e=full

Build reuse reason: fresh build mode always runs pnpm run build:vite

## Decision

- Daily loop ready: yes
- Release ready: yes
- Budget status: watch
- Full gate complete: yes

Required full gates:

- None.

Trend: improved; same-mode delta -131907ms; sample count 7.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 26s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |
| pass | contract | no | 2s | `node scripts/contract-check.mjs` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 1s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 2s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 13s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | no | 54s | `pnpm run build:vite` | Reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 20s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. e2e-build: 53963ms
2. typecheck: 25578ms
3. playwright-agent-dev: 20158ms
4. vitest-agent-dev: 12925ms
5. contract: 2185ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| watch | e2e-build | no | 53963ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |
| watch | vitest-agent-dev | no | 12925ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| watch | contract | no | 2185ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| watch | typecheck | no | 25578ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| ok | playwright-agent-dev | no | 20158ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| ok | harness-agent-dev | no | 1614ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | i18n | no | 732ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | comms-replay | no | 667ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | comms-compare | no | 611ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench | no | 589ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | workbench-refresh | no | 534ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 101313ms | 4 | 0 | e2e-build |
| fast-pr | 16431ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 1812ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 86ms | pass |
| `pnpm run typecheck:node` | 8475ms | pass |
| `pnpm run typecheck:web` | 4181ms | pass |
| `pnpm run typecheck:test` | 16473ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|
| `dist/assets/editor-CONRKkre.js` | 3750.05 kB |
| `dist-electron/main/index-CVzytNKG.js` | 2438.24 kB |
| `dist/assets/GeneratedFilesPanel-2kes45Km.js` | 1726.23 kB |
| `dist/assets/emacs-lisp-CXvaQtF9.js` | 779.88 kB |
| `dist/assets/App-DQPeAFyj.js` | 705.4 kB |
| `dist/assets/cpp-UfJy6YNI.js` | 626.08 kB |
| `dist/assets/wasm-CG6Dc4jp.js` | 622.34 kB |
| `dist/assets/index-Bv-312-X.js` | 567.78 kB |

Playwright test durations:

| Duration | Test |
|---:|---|
| 8900ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 8900ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |
| 8300ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |
| 7200ms | tests\e2e\agent-dev-quality.spec.ts:60:7 › agent dev quality gates › captures a stable visual artifact for a seeded scenario |

## Optimization Recommendations

- e2e-build exceeded its target by 28963ms; Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build.
- vitest-agent-dev exceeded its target by 2925ms; Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.
- contract exceeded its target by 1185ms; Keep contract scanning text-based and bounded to host-api/service sources.
- Vite/Electron build is the dominant E2E setup cost; use pnpm agent-dev:deep-test:reuse after a fresh build for repeated local loops.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.

driven_by: agent · actor: codex-g8-ui-01a1d351 · realHumanEvidence: false
