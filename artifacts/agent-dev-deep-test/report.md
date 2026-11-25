# Agent Dev Deep Test

Generated: 2026-11-25T09:59:15.064Z

Result: pass

Decision: blocked - e2e-build, typecheck, contract, i18n exceeded hard performance limits.

Total elapsed: 190044ms

Modes: build=fresh, unit=full, typecheck=full, e2e=full

Build reuse reason: fresh build mode always runs pnpm run build:vite

## Decision

- Daily loop ready: no
- Release ready: no
- Budget status: limit
- Full gate complete: yes

Required full gates:

- None.

Trend: regressed; same-mode delta 10229ms; sample count 9.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 48s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |
| pass | contract | no | 4s | `node scripts/contract-check.mjs` | Host-api contract/facade/service drift |
| pass | i18n | no | 4s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 1s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 7s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 20s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | no | 75s | `pnpm run build:vite` | Reusable Vite/Electron production build for no-build Playwright loops |
| pass | playwright-agent-dev | no | 29s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. e2e-build: 75012ms
2. typecheck: 47738ms
3. playwright-agent-dev: 29221ms
4. vitest-agent-dev: 19727ms
5. harness-agent-dev: 6968ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| limit | e2e-build | no | 75012ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |
| limit | typecheck | no | 47738ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| limit | contract | no | 4092ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| limit | i18n | no | 3704ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| watch | vitest-agent-dev | no | 19727ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| watch | playwright-agent-dev | no | 29221ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| watch | harness-agent-dev | no | 6968ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | comms-replay | no | 955ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | workbench | no | 950ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | comms-compare | no | 849ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench-refresh | no | 698ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 158939ms | 4 | 0 | e2e-build |
| fast-pr | 28473ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 2502ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/build-versebrowser.mjs` | 8368ms | pass |
| `node scripts/generate-ext-bridge.mjs` | 61ms | pass |
| `pnpm run typecheck:node` | 13152ms | pass |
| `pnpm run typecheck:web` | 8256ms | pass |
| `pnpm run typecheck:test` | 23710ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|
| `dist/assets/editor-Cb0GynxW.js` | 3750.05 kB |
| `dist-electron/main/index-BpECB6_p.js` | 2441 kB |
| `dist/assets/GeneratedFilesPanel-94hN1L4D.js` | 1726.23 kB |
| `dist/assets/emacs-lisp-CXvaQtF9.js` | 779.88 kB |
| `dist/assets/App-BYQShiNa.js` | 705.4 kB |
| `dist/assets/cpp-UfJy6YNI.js` | 626.08 kB |
| `dist/assets/wasm-CG6Dc4jp.js` | 622.34 kB |
| `dist/assets/index-BzsqBvSA.js` | 567.78 kB |

Playwright test durations:

| Duration | Test |
|---:|---|
| 14300ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |
| 14300ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 10300ms | tests\e2e\agent-dev-quality.spec.ts:74:7 › agent dev quality gates › loads the in-app Agent Dev Workbench through host-api and records a scenario |
| 9800ms | tests\e2e\agent-dev-quality.spec.ts:60:7 › agent dev quality gates › captures a stable visual artifact for a seeded scenario |

## Optimization Recommendations

- e2e-build exceeded its hard limit by 17012ms; Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build.
- typecheck exceeded its hard limit by 2738ms; Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.
- contract exceeded its hard limit by 1092ms; Keep contract scanning text-based and bounded to host-api/service sources.
- i18n exceeded its hard limit by 704ms; Keep literal namespace scans bounded to source and locale directories.
- vitest-agent-dev exceeded its target by 9727ms; Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.
- playwright-agent-dev exceeded its target by 4221ms; Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
- harness-agent-dev exceeded its target by 3968ms; Keep the shared scenario baseline separate from task-specific changed-path ownership checks.
- Vite/Electron build is the dominant E2E setup cost; use pnpm agent-dev:deep-test:reuse after a fresh build for repeated local loops.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
- Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.
