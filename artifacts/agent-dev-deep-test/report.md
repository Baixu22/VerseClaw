# Agent Dev Deep Test

Generated: 2026-09-14T10:58:57.099Z

Result: fail

Decision: blocked - playwright-agent-dev failed; inspect stdoutTail/stderrTail before relying on this run.

Total elapsed: 83125ms

Modes: build=fresh, unit=full, typecheck=full, e2e=full

Build reuse reason: fresh build mode always runs pnpm run build:vite

## Decision

- Daily loop ready: no
- Release ready: no
- Budget status: watch
- Full gate complete: yes

Required full gates:

- None.

Trend: improved; same-mode delta -16860ms; sample count 10.

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
| pass | typecheck | no | 15s | `pnpm run typecheck` | Compiled contract and renderer/Main type safety |
| pass | contract | no | 0s | `pnpm contract:check` | Host-api contract/facade/service drift |
| pass | i18n | no | 1s | `pnpm i18n:lint` | Four-locale namespace/key coverage |
| pass | workbench | no | 0s | `pnpm agent-dev:workbench` | Static Workbench evidence generation |
| pass | harness-agent-dev | no | 2s | `pnpm harness validate --spec harness/specs/scenarios/agent-dev-composable-scenarios.md` | Shared Agent Dev scenario baseline; task ownership is validated separately for each change set |
| pass | vitest-agent-dev | no | 18s | `pnpm agent-dev:unit` | Focused Agent Dev behavior and facade tests |
| pass | comms-replay | no | 1s | `pnpm run comms:replay` | Communication replay metrics |
| pass | comms-compare | no | 0s | `pnpm run comms:compare` | Communication baseline comparison |
| pass | e2e-build | no | 42s | `pnpm run build:vite` | Reusable Vite/Electron production build for no-build Playwright loops |
| fail | playwright-agent-dev | no | 4s | `pnpm run test:e2e:agent-dev-quality:run` | Electron Agent Dev scenario and in-app Workbench path |
| pass | workbench-refresh | no | 0s | `pnpm agent-dev:workbench` | Refresh Workbench evidence after quality report generation |

## Bottlenecks

1. e2e-build: 41696ms
2. vitest-agent-dev: 17952ms
3. typecheck: 15390ms
4. playwright-agent-dev: 3632ms
5. harness-agent-dev: 1539ms

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
| watch | e2e-build | no | 41696ms | 25000ms | 45000ms | full-local | Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build. |
| watch | vitest-agent-dev | no | 17952ms | 10000ms | 21000ms | fast-pr | Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe. |
| ok | typecheck | no | 15390ms | 25000ms | 45000ms | full-local | Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate. |
| ok | playwright-agent-dev | no | 3632ms | 25000ms | 40000ms | full-local | Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding. |
| ok | harness-agent-dev | no | 1539ms | 3000ms | 8000ms | full-local | Keep the shared scenario baseline separate from task-specific changed-path ownership checks. |
| ok | i18n | no | 647ms | 1000ms | 3000ms | fast-pr | Keep literal namespace scans bounded to source and locale directories. |
| ok | comms-replay | no | 553ms | 2000ms | 5000ms | nightly-release | Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates. |
| ok | comms-compare | no | 492ms | 2000ms | 5000ms | nightly-release | Refresh baselines intentionally and keep compare output compact. |
| ok | contract | no | 465ms | 1000ms | 3000ms | fast-pr | Keep contract scanning text-based and bounded to host-api/service sources. |
| ok | workbench | no | 376ms | 1500ms | 5000ms | fast-pr | Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation. |
| ok | workbench-refresh | no | 373ms | 1500ms | 5000ms | nightly-release | Refresh evidence from existing artifacts only. |

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
| full-local | 62257ms | 4 | 0 | e2e-build |
| fast-pr | 19440ms | 4 | 0 | vitest-agent-dev |
| nightly-release | 1418ms | 3 | 0 | comms-replay |

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
| `node scripts/generate-ext-bridge.mjs` | 52ms | pass |
| `pnpm run typecheck:node` | 10726ms | pass |
| `pnpm run typecheck:web` | 5749ms | pass |

Largest build assets:

| Asset | Size |
|---|---:|
| `dist/assets/editor-CiEo1edq.js` | 3758.58 kB |
| `dist/assets/chat-core-LI_OFHEl.js` | 2588.59 kB |
| `dist-electron/main/index-4BLUup-d.js` | 1830.04 kB |
| `dist/assets/settings-detail-BIgKC0YY.js` | 1204.76 kB |
| `dist/assets/emacs-lisp-CXvaQtF9.js` | 779.88 kB |
| `dist/assets/ui-vendor-CRZG6yUM.js` | 687.5 kB |
| `dist/assets/cpp-UfJy6YNI.js` | 626.08 kB |
| `dist/assets/wasm-CG6Dc4jp.js` | 622.34 kB |

Playwright test durations:

| Duration | Test |
|---:|---|


## Optimization Recommendations

- e2e-build exceeded its target by 16696ms; Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build.
- vitest-agent-dev exceeded its target by 7952ms; Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.
- Vite/Electron build is the dominant E2E setup cost; use pnpm agent-dev:deep-test:reuse after a fresh build for repeated local loops.
- Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.
- Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.
