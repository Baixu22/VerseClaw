# lane-f-harness-and-test-wiring: Harness, Tests, and Runtime Boundary Audit

## Scope Confirmation

- Lane: `lane-f-harness-and-test-wiring`
- Output file: `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-f-harness-and-test-wiring.md`
- Lane-owned file only: yes
- Files/directories searched: `harness/specs/tasks`, `vitest.config.ts`, `tests/unit`, `tests/e2e`, `src`, `electron`, `shared`, `openclaw_runtime/src/agents/verseshell-runtime.ts`, `verseshell-runtime/src/server.rs`
- Commands run:
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/lane-c-tool-protocol-shadow.md --no-diff`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts`
  - `rtk rg -n 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'`
  - `rtk node --max-old-space-size=6144 ./node_modules/vite/bin/vite.js build`
  - `rtk node ./node_modules/@playwright/test/cli.js test tests/e2e/task-loop-panel.spec.ts`
- Prior handoffs reviewed: Phase-1 synthesis, Phase-2 synthesis, Phase-2 README/template

## Executive Summary

- Root Vitest is configured to collect `tests/unit/**/*` and `tests/integration/**/*`, so `tests/unit/runtime-core-contracts.test.ts` is wired.
- Focused runtime foundation tests pass.
- Focused MCP shadow tests pass.
- Full `tests/unit/mcp-api.test.ts` passes.
- Full combined runtime/MCP Phase-2 test slice passes.
- Harness specs for runtime contract layer and lane-c tool protocol shadow validate structurally with `--no-diff`.
- Renderer direct IPC / direct Gateway HTTP scan found only preload/Main/test/rule-text/comment usages, not new renderer bypasses in `src/pages` or `src/components`.
- TaskLoop panel UI E2E was built and executed successfully.
- `verseshell-runtime` is user-configured as the default runtime terminal tool; it is documented as a stdio terminal tool adapter exception, not a Phase-2 runtime-core orchestration service.
- No remaining lane-f blocker prevents Phase 3.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Root Vitest includes runtime-core contract test file location. | config | `vitest.config.ts` | line 109 | Includes `tests/unit/**/*.{test,spec}.{ts,tsx}`. |
| Runtime contract layer harness spec validates structurally. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff` | result: pass | Structural only; `--no-diff`. |
| Lane-c tool protocol shadow harness spec validates structurally. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/lane-c-tool-protocol-shadow.md --no-diff` | result: pass | Structural only; `--no-diff`. |
| Focused runtime foundation tests pass. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 3 files / 52 tests | Contracts, context shadow, TaskLoop shadow/evidence shadow. |
| Focused MCP shadow tests pass. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow` | result: pass, 5 tests / 7 skipped | MCP shadow on/off and mappings. |
| Full MCP unit tests pass. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts` | result: pass, 1 file / 12 tests | MCP registry, Git built-in tools, and shadows. |
| Full combined runtime/MCP test slice passes. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 4 files / 64 tests | Phase-2 runtime core validation set. |
| Renderer direct IPC/Gateway bypass scan found no new renderer bypass in app pages/components. | command | `rtk rg -n 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | result: matches rule text, preload/Main/tests/comments | No `src/pages`/`src/components` direct IPC/Gateway fetch found. |
| TaskLoop panel UI changed. | file | `src/components/agents/RolesOrchestrationPanel.tsx` | lines 2313-2329, 2369-2388 | Shows evidence gate, quality, files, tests, trace. |
| TaskLoop panel E2E coverage exists. | test | `tests/e2e/task-loop-panel.spec.ts` | lines 155-163 | Asserts event/result gate/quality/files/tests/trace. |
| Vite/Electron build passed via direct Node command. | command | `rtk node --max-old-space-size=6144 ./node_modules/vite/bin/vite.js build` | result: pass | Used because `rtk pnpm run build:vite` failed in this shell with `node` not recognized by pnpm shim. |
| TaskLoop panel E2E passed. | command | `rtk node ./node_modules/@playwright/test/cli.js test tests/e2e/task-loop-panel.spec.ts` | result: pass, 1 test | Electron E2E validation for UI change. |
| `verseshell-runtime` manages a stdio JSON-RPC terminal tool child process. | file | `openclaw_runtime/src/agents/verseshell-runtime.ts` | comments lines 4-9; process lifecycle around lines 267 and 505-512 | User states this is the configured default runtime terminal tool. |
| `verseshell-runtime` local server is stdio-only in audited evidence. | file | `verseshell-runtime/src/server.rs` | `Transport::Stdio`, lines 25-33; `serve_stdio`, line 63 | No TCP listener shown in this evidence. |

## Current State

Current tests:

- Runtime-core, context shadow, TaskLoop shadow/evidence shadow focused tests pass.
- MCP shadow focused tests pass.
- Full MCP tests pass.
- Full combined Phase-2 unit slice passes.
- TaskLoop panel E2E passes after direct Vite/Electron build.

Current harness specs:

- `runtime-contract-layer-spike.md` validates structurally.
- `lane-c-tool-protocol-shadow.md` validates structurally.

Current boundary scan:

- No new renderer direct IPC or direct Gateway HTTP bypass was found in `src/pages` or `src/components` by the scan command.

Current terminal tool exception:

- `verseshell-runtime` is user-configured as the default runtime terminal tool. It launches/uses a stdio JSON-RPC child process for terminal commands, not an additional ClawX task orchestration service in this Phase-2 contract/shadow audit.

## Shadow Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Harness spec validation | CLI schema validation | not runtime behavior | none | Harness commands above |
| Runtime tests | Vitest unit/focused/full runs | not runtime behavior | none | Test commands above |
| Renderer boundary scan | Static grep for bypasses | not runtime behavior | none | Scan command above |
| UI validation | Electron E2E | verifies user-visible change | none | Playwright command above |
| `verseshell-runtime` terminal tool | stdio terminal tool adapter exception | outside Phase-2 runtime-core service; not accepted as orchestration service | user/default terminal tool config | `verseshell-runtime.ts:4`-`:9`; `server.rs:25`-`:33` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| Runtime contract/context/taskloop focused surfaces | Focused tests pass. | 3-file focused command passed. | Does not replace full test suite. |
| MCP registry/tool behavior | Full MCP tests pass. | `tests/unit/mcp-api.test.ts` passed. | Future visible built-ins need separate acceptance. |
| Renderer IPC/Gateway boundary | No new renderer direct bypass found by scan. | Static scan command result. | Static grep is not a full semantic import audit. |
| UI behavior | E2E passes. | Playwright command result. | Only one UI spec was run. |
| Terminal tool runtime | `verseshell-runtime` remains the default terminal tool as configured by user. | User instruction plus file evidence for stdio child process. | Must not become a second task orchestration/runtime-core service. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Runtime foundation focused tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | pass | Lane A/B/D/E focused behavior. | Full suite not run. |
| MCP shadow focused tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow` | pass | Lane C shadow-only cases. | Focused subset. |
| Full MCP tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts` | pass | Lane C plus MCP registry/built-ins. | Typecheck not run. |
| Full combined runtime/MCP tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | pass | Phase-2 core unit slice. | Full project tests not run. |
| Runtime contract harness spec | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff` | pass | Spec structure. | `--no-diff` only. |
| Tool protocol harness spec | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/lane-c-tool-protocol-shadow.md --no-diff` | pass | Spec structure. | `--no-diff` only. |
| Renderer bypass scan | `rtk rg -n 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed | Boundary scan. | Not a type-aware lint rule. |
| Build for E2E | `rtk node --max-old-space-size=6144 ./node_modules/vite/bin/vite.js build` | pass | Frontend, Electron main, preload build. | pnpm shim failed in this shell, direct command used. |
| TaskLoop panel E2E | `rtk node ./node_modules/@playwright/test/cli.js test tests/e2e/task-loop-panel.spec.ts` | pass | UI coverage for task-loop panel evidence gate/quality/files/tests/trace. | Only targeted E2E run. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| `verseshell-runtime` can look like a second runtime service. | `verseshell-runtime.ts:4`-`:9`; `server.rs:25`-`:33`; user says it is default terminal tool. | Do not introduce second agent runtime service. | Record as stdio terminal tool adapter exception, not Phase-2 runtime-core orchestration service. |
| `pnpm` shim failed under RTK in this shell. | `rtk pnpm run build:vite` failed with `'"node"' is not recognized`. | Reproducible commands should be runnable on Windows. | Use direct Node command for this audit; document pnpm shim issue separately if persistent. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Phase-3 readiness validation bundle
New code path: none
Legacy path wrapped: n/a
Shadow / warning boundary: keep terminal tool exception documented; keep MCP/context/taskloop/evidence shadows default-off
Feature flag: runtime.toolProtocol.mcpShadow, runtime.contextProviders.*, runtimeTaskEventLogShadow/runtimeCoreShadow, runtime.evidenceVerifier.shadow
Tests: keep full MCP + combined runtime unit slice + task-loop-panel E2E green
Harness: validate runtime-contract-layer-spike and lane-c-tool-protocol-shadow
Rollback: disable shadow flags; terminal tool remains separately configured
Done when: synthesis says Ready For Next Phase = yes and agent-runtime-index.md is updated
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `verseshell-runtime` be documented in `agent-runtime-index.md` as terminal tool exception? | Prevents future false positives on second-runtime audits. | maintainer/user | no |
| Should pnpm shim/RTK interaction be fixed? | Improves future validation reliability. | maintainer | no |

## Handoff Notes

- `verseshell-runtime` is not accepted as a new Phase-2 runtime-core service. It is documented here only as the user-configured default terminal tool / stdio JSON-RPC adapter exception.
- If `verseshell-runtime` starts owning task orchestration, event-log authority, provider registry, or Gateway replacement behavior, it must be re-audited under the second-runtime rule.
- Lane F is accepted for Phase-2 readiness after targeted unit, harness, boundary, build, and E2E checks passed.
