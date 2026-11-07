# Agent Dev Deep Test

Generated: 2026-11-06T17:33:09.342Z

Result: fail

Decision: blocked - playwright-agent-dev failed; inspect stdoutTail/stderrTail before relying on this run.

Total elapsed: 563719ms

Modes: build=fresh, unit=full, typecheck=full, e2e=full

Build reuse reason: fresh build mode always runs pnpm run build:vite

## Decision

- Daily loop ready: no
- Release ready: no
- Budget status: limit
- Full gate complete: yes

Required full gates:

- None.

Trend: regressed; same-mode delta 64105ms; sample count 4.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 154s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |
| pass | contract | no | 4s | `pnpm contract:check` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 0s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 2s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 167s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 1s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | no | 174s | `pnpm run build:vite` | Reusable Vite/Electron production build for no-build Playwright loops |
| fail | playwright-agent-dev | no | 58s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 1s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. e2e-build: 174314ms
2. vitest-agent-dev: 167195ms
3. typecheck: 154206ms
4. playwright-agent-dev: 58417ms
5. contract: 4033ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| limit | vitest-agent-dev | no | 167195ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| limit | e2e-build | no | 174314ms | 25000ms | 58000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |
| limit | typecheck | no | 154206ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| limit | playwright-agent-dev | no | 58417ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| limit | contract | no | 4033ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| watch | i18n | no | 1062ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | harness-agent-dev | no | 1858ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | workbench-refresh | no | 835ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |
| ok | comms-replay | no | 597ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | comms-compare | no | 563ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | workbench | no | 477ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 388795ms | 4 | 0 | e2e-build |
| fast-pr | 172767ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 1995ms | 3 | 0 | workbench-refresh |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 501ms | pass |
| `pnpm run typecheck:node` | 135392ms | pass |
| `pnpm run typecheck:web` | 28921ms | pass |
| `pnpm run typecheck:test` | 137740ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|
| `dist/assets/editor-DTdeSYen.js` | 3750.05 kB |
| `dist-electron/main/index-Dpso_r0N.js` | 2066.07 kB |
| `dist/assets/GeneratedFilesPanel-B3iocuyx.js` | 1542.05 kB |
| `dist/assets/emacs-lisp-CXvaQtF9.js` | 779.88 kB |
| `dist/assets/App-n1nbPYWY.js` | 668.22 kB |
| `dist/assets/cpp-UfJy6YNI.js` | 626.08 kB |
| `dist/assets/wasm-CG6Dc4jp.js` | 622.34 kB |
| `dist/assets/index-CX1Bf67A.js` | 551.1 kB |

Playwright test durations:

| Duration | Test |
|---:|---|
| 13000ms | tests\e2e\agent-dev-quality.spec.ts:24:7 › agent dev quality gates › renders assistant-ui welcome suggestions with aligned card styling |
| 12400ms | tests\e2e\agent-dev-quality.spec.ts:8:7 › agent dev quality gates › produces an accessibility report for a seeded scenario |

## Optimization Recommendations

- vitest-agent-dev exceeded its hard limit by 146195ms; Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.
- e2e-build exceeded its hard limit by 116314ms; Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build.
- typecheck exceeded its hard limit by 109206ms; Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.
- playwright-agent-dev exceeded its hard limit by 18417ms; Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.
- contract exceeded its hard limit by 1033ms; Keep contract scanning text-based and bounded to host-api/service sources.
- i18n exceeded its target by 62ms; Keep literal namespace scans bounded to source and locale directories.
- Vite/Electron build is the dominant E2E setup cost; use pnpm agent-dev:deep-test:reuse after a fresh build for repeated local loops.
- Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
