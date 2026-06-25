# lane-e-harness-tests-boundary-docs: Phase 3 validation, boundary scan, docs/index updates, synthesis readiness

## Scope Confirmation

- Lane: `lane-e-harness-tests-boundary-docs`
- Output file: `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-e-harness-tests-boundary-docs.md`
- Lane-owned file only: yes — this lane only writes this submission file.
- Implementation paths touched: none
- Test paths touched: none
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/task-loop-controller.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'`
  - `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'`
  - `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine/provider-registry.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/task-loop-controller.test.ts`
  - `rtk node scripts/comms/replay.mjs`
  - `rtk node scripts/comms/compare.mjs`
  - `rtk node -e "<submission heading/status audit>"`
- Required reading completed: yes — Phase-3 required docs were read earlier in this thread; this lane additionally read all current Lane A-D submissions and reran the Phase-3 harness context command.

## Executive Summary

- Validated the Phase-3 harness task spec successfully.
- Ran the required focused Phase-3 unit slice: 4 files / 66 tests passed.
- Ran the expanded A-D integration unit slice including all new registry tests: 7 files / 80 tests passed.
- Ran direct Node TypeScript check for node/runtime surfaces: passed.
- Ran full boundary scan and focused renderer pages/components boundary scan; no new renderer direct IPC/Gateway bypass was found.
- Ran comms replay/compare because Lane C touches `electron/services/mcp-api.ts`; both passed.
- Did not run targeted Electron E2E because Lane A-D submissions report no UI/user-visible behavior changes and no renderer UI files were lane-owned.
- Audited current Lane A-D submission headings/statuses; all four submitted the accepted state, but synthesis must still independently reject any under-evidenced claims if later review finds gaps.
- Did not update `runtime-research/agent-runtime-index.md`; this lane recommends index updates only after the synthesis owner accepts all lanes.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Phase-3 harness context command succeeds. | command | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | output lists task/scenario/rules/layers | Pass. |
| Phase-3 harness spec validates. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | `Spec is valid` | Pass. |
| Required focused unit slice passes. | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | 4 files / 66 tests passed | Covers required task-spec unit command. |
| Expanded A-D unit slice passes. | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | 7 files / 80 tests passed | Covers Lane A-D focused tests together. |
| Direct Node TypeScript check passes. | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | exit code 0 | Avoids known local `rtk pnpm` shim issue reported by other lanes. |
| Full direct IPC/Gateway boundary scan reviewed. | command | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | matches only existing preload/Main/tests/i18n/rule text/comment/url-helper cases | No Lane A-D renderer bypass found. |
| Renderer pages/components have no direct IPC/Gateway matches. | missing-after-search | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` | no stdout, exit 1 | Pass by no matches. |
| Phase-3 touched-file second-service scan found no new runtime service. | command | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' ...` | one existing `electron/services/mcp-api.ts:909 createServer` config method | Reviewed; this is existing MCP server config CRUD, not an HTTP/WS/runtime service. |
| Comms replay passes. | command | `rtk node scripts/comms/replay.mjs` | exit code 0 | Run because Lane C touches Main `mcp-api.ts`. |
| Comms compare passes. | command | `rtk node scripts/comms/compare.mjs` | exit code 0 | Run because Lane C touches Main `mcp-api.ts`. |
| Lane A-D submissions have required headings and exactly one accepted status each. | handoff | `rtk node -e "<submission heading/status audit>"` | A/B/C/D: `missing=none statuses=accepted` | Submission audit only; synthesis owner still owns final acceptance. |

## Implementation Summary

Current code:

- Lane E made no implementation code changes.
- Reviewed Lane A-D submissions and recorded synthesis-readiness evidence.

Tests:

- Required unit slice passed: 4 files / 66 tests.
- Expanded A-D unit slice passed: 7 files / 80 tests.
- Direct Node TypeScript check passed.

Feature flags:

- Lane E did not add or change flags.
- Evidence from Lane A-D submissions indicates all registry behavior remains default-off/shadow/pilot-gated:
  - `runtime.registryPilot.enabled`
  - `runtime.providerRegistry.shadow`
  - `runtime.contextProviders.registryPilot`
  - `runtime.toolRegistry.shadow`
  - existing Phase-2 flags such as `runtime.toolProtocol.mcpShadow`, `runtime.contextProviders.shadow`, `runtimeTaskEventLogShadow`, and `runtimeCoreShadow`.

Harness/spec changes:

- Lane E did not edit harness specs.
- `phase-3-provider-tool-registry-pilot` context and validate commands passed.

Docs/index:

- Lane E did not update `runtime-research/agent-runtime-index.md`.
- Recommendation: update the index only after the synthesis owner accepts A-D/E.
- README translation updates are not required for Lane E itself because no user-visible UI/flow changed.

## Registry Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Lane A registry contracts/flags | `openclaw_runtime/src/runtime-core/registries.ts` plus config schema/help entries | contract/default-off; no active provider registration by default | `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, `runtime.contextProviders.registryPilot`, `runtime.toolRegistry.shadow` | Lane A submission; expanded unit slice passed 7 files / 80 tests. |
| Lane B context provider pilot | `openclaw_runtime/src/context-engine/provider-registry.ts` wraps `LegacyContextEngine` and `LoopContextPack` as compatibility providers | explicit helper/shadow diagnostics only; no live prompt cutover | `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot` | Lane B submission; `tests/unit/context-provider-registry.test.ts` passed in expanded unit slice. |
| Lane C tool provider pilot | `electron/services/tool-provider-registry.ts` and `electron/services/mcp-api.ts` wrap MCP `callTool` shadows | shadow-only diagnostics; legacy `McpCallToolResult` authoritative | `runtime.toolRegistry.shadow` | Lane C submission; `tests/unit/tool-provider-registry.test.ts` and `tests/unit/mcp-api.test.ts` passed; comms replay/compare passed. |
| Lane D TaskLoop diagnostics integration | `openclaw_runtime/src/agents/task-loop-controller.ts` consumes registry diagnostics via optional deps seam | RuntimeTaskEvent shadow metadata/evidence only; status/checkpoint authority unchanged | existing TaskLoop shadow flags plus registry surface flags | Lane D submission; `tests/unit/task-loop-controller.test.ts` passed 45 tests in current run. |
| Lane E validation | this submission | synthesis readiness only; no registry implementation | N/A | Harness/unit/typecheck/boundary/comms commands in Evidence Table. |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `openclaw_runtime/src/context-engine/legacy.ts` / `openclaw_runtime/src/agents/loop-context-pack.ts` | Legacy prompt/message context remains authoritative. | `tests/unit/context-shadow-adapter.test.ts` and `tests/unit/context-provider-registry.test.ts` passed in expanded unit slice. | Future integration must keep prompt/message parity if consuming Lane B helpers. |
| `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` | Legacy MCP response shape remains authoritative. | `tests/unit/mcp-api.test.ts` and `tests/unit/tool-provider-registry.test.ts` passed; comms replay/compare passed. | Future policy/cutover must preserve approval waiting/blocked semantics. |
| `openclaw_runtime/src/agents/task-loop-controller.ts` | TaskLoop final status, lifecycle callback payloads, self-check decisions, and checkpoint authority remain legacy. | `tests/unit/task-loop-controller.test.ts` passed 45 tests; expanded unit slice passed. | Future collector wiring must not write registry refs into legacy `record.evidenceRefs` or persisted checkpoints without explicit cutover. |
| Renderer/Main transport boundary | Renderer pages/components must not own direct IPC/Gateway calls. | Focused renderer scan had no matches; broad scan reviewed existing allowed/test/rule-text matches. | Existing broad-scan matches should remain documented to avoid false positives. |
| Runtime service ownership | No second Provider/Tool Registry runtime service should exist. | Touched-file service scan found only existing `mcp-api.ts:createServer` config method, not a listener/service. | Future lanes must continue to treat `verseshell-runtime` as terminal tool exception only. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | pass | Phase-3 read-order and spec routing | None |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Harness task spec validity | `--no-diff` structural validation only; no harness files edited. |
| Required unit slice | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | pass; 4 files / 66 tests | Required task-spec test command | Does not include new Lane A/B/C test files, so expanded slice was also run. |
| Expanded A-D unit slice | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass; 7 files / 80 tests | All current Phase-3 lane test files together | None |
| TypeScript node check | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime TS surface | Did not run `rtk pnpm run typecheck:node` because A/C/D reported local pnpm shim issue; direct Node tsc passed here. |
| Full boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | pass/reviewed | Renderer/Main boundary and Gateway endpoint audit | Existing matches in preload/Main/tests/i18n/rule text/comment/url helpers are not new Phase-3 lane violations. |
| Renderer pages/components scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` | pass by no matches | User-facing renderer boundary | None |
| Second runtime service scan | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' <Phase-3 touched files>` | pass/reviewed | No new service/port/WS/Gateway in Phase-3 files | Existing `mcp-api.ts:createServer` is MCP config CRUD, not listener/service. |
| Comms replay | `rtk node scripts/comms/replay.mjs` | pass | Main communication regression after Lane C `mcp-api.ts` touch | stdout empty, exit 0. |
| Comms compare | `rtk node scripts/comms/compare.mjs` | pass | Main communication baseline compare after Lane C `mcp-api.ts` touch | stdout empty, exit 0. |
| Submission structure/status audit | `rtk node -e "<submission heading/status audit>"` | pass/reviewed | A-D have required headings and one accepted status each | This is not final synthesis acceptance. |
| Targeted Electron E2E | Playwright targeted spec | not-run | UI/user-visible behavior | Not required: Lane A-D submissions report no UI/user-visible changes. |
| README translation docs sync | manual review from submissions | not-run | User-facing docs | Not required for Lane E; recommend synthesis update runtime index only after final acceptance. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Phase-3 touched-file service scan had no new listener/server/Gateway endpoint; existing `mcp-api.ts:createServer` is config CRUD. |
| No renderer direct IPC | pass | Focused `src/pages`/`src/components` scan had no matches; broad matches are existing preload/tests/rule text. |
| No renderer direct Gateway HTTP/WS | pass | Focused renderer scan had no Gateway endpoint matches; broad endpoint matches are existing Main/tests/rule text/comment/url helper cases. |
| Feature flags default safe | pass | Lane A-D submissions and tests show registry behavior remains default-off/shadow/pilot gated; expanded unit slice passed. |
| Flag-off parity covered | pass | Required unit slice and expanded A-D slice passed, including context/MCP/TaskLoop flag-off and shadow parity coverage. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Lane A-D submissions all self-report accepted, but final acceptance belongs to synthesis. | Submission audit: A/B/C/D required headings present and exactly one valid status each. | Do not accept under-evidenced claims automatically. | Synthesis owner should independently review path/function/test/command evidence before final `synthesis.md`; Lane E provides validation input only. |
| Tool registry gating differs from context registry gating. | Lane B/D context diagnostics require global/provider/context flags; Lane C tool wrapper uses `runtime.toolRegistry.shadow`. | Predictable rollback semantics across registry surfaces. | Synthesis should decide whether `runtime.registryPilot.enabled` becomes a master gate for tool registry diagnostics too. |
| Broad boundary scan has expected historical matches. | Full scan shows preload/Main/test/i18n/rule-text/comment/url-helper matches. | Boundary checks should catch new renderer page/component bypasses without false positives. | Keep both broad reviewed scan and focused renderer pages/components scan in final synthesis evidence. |
| `agent-runtime-index.md` update timing. | Phase-3 README says final integration/synthesis classifies lanes; Lane E found A-D submissions accepted but has not written synthesis. | Runtime index should reflect accepted final state, not parallel-lane claims. | Update `runtime-research/agent-runtime-index.md` only after synthesis accepts all relevant lanes. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Phase-3 synthesis and index update after final acceptance
New code path: runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
Legacy path wrapped: N/A; synthesis only
Shadow / pilot boundary: preserve Lane A-D flag/shadow constraints; no default-on cutover
Feature flag: document runtime.registryPilot.enabled, runtime.providerRegistry.shadow, runtime.contextProviders.registryPilot, runtime.toolRegistry.shadow, runtime.toolProtocol.mcpShadow, runtimeTaskEventLogShadow/runtimeCoreShadow
Tests: cite current 7-file / 80-test expanded unit slice, required 4-file / 66-test slice, harness validate, boundary scan, comms replay/compare
Harness: rerun `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` if synthesis changes specs
Rollback: disable registry flags; legacy context/MCP/TaskLoop paths remain authoritative
Done when: synthesis classifies A-D/E as accepted/needs_revision/blocked and only then updates agent-runtime-index.md pointers/status
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `runtime.registryPilot.enabled` be a master gate for `runtime.toolRegistry.shadow`? | Lane C currently gates tools by `runtime.toolRegistry.shadow`; context gates include the global pilot flag. | maintainer/synthesis owner | no |
| Should `openclaw_runtime/src/runtime-core/registry.ts` remain as a compatibility barrel? | Lane A notes singular/plural file-name churn; keeping both may confuse future lanes. | synthesis owner/maintainer | no |
| Should `agent-runtime-index.md` be updated in synthesis or a follow-up commit? | Prevents recording parallel-lane claims before final acceptance. | synthesis owner | no |

## Handoff Notes

- Current validation evidence supports synthesis readiness for Lane A-D, but this file does not itself grant final acceptance.
- Lane E intentionally did not edit `runtime-research/agent-runtime-index.md`; update it only after synthesis accepts all lanes.
- Comms replay/compare were run and passed because Lane C touched `electron/services/mcp-api.ts`.
- Targeted E2E was not run because no Phase-3 lane reported UI or user-visible behavior changes.
- Synthesis should preserve the hard constraints: no second runtime service, no renderer direct IPC/Gateway bypass, no default-on registry cutover, and flag-off legacy behavior unchanged.
