# Lane C AgentMap Fixtures Quality Audit

Status: accepted

## Scope

- Added a ClawX-like AgentMap fixture workspace under `tests/fixtures/agent-map/clawx-like-workspace/`.
- Covered a renderer component, host-api wrapper, Electron main IPC handler, runtime-core helper, shared chat types, and cross-file references.
- Added `tests/unit/runtime-agent-map-quality.test.ts` for ranking quality assertions.
- Extended `tests/unit/runtime-agent-map-renderer.test.ts` with a stable ClawX-like rendered snapshot at `tests/fixtures/agent-map/expected/clawx-like-diagnostic-map.txt`.
- Kept the work readonly and non-authoritative. No prompt assembly, provider ordering, Gateway, TaskLoop, or runtime cutover wiring was added.

## Quality Evidence

- Active-file references: `sendClawMessage` is lifted from `src/pages/Chat/Composer.tsx` references and carries file evidence refs from the active renderer file.
- Exact mentioned symbol: `dispatchRuntimeMessage` ranks first with `mentionedByUser` metadata `{ exact: true }` and trace evidence `agent-map:mentioned-symbol:dispatchruntimemessage`.
- Prompt-present file handling: `ChatComposer` is marked with `promptPresentFile` in raw ranking and `src/pages/Chat/Composer.tsx` is excluded from the budgeted render with `reason: "promptPresentFile"`.
- Path-component ordering: token/path neighbors such as `buildDispatchRuntimeMessageNote` and `runtimeMessageQueueState` do not outrank the exact `dispatchRuntimeMessage` mention.
- Stable output: renderer compares the ClawX-like fixture output to `clawx-like-diagnostic-map.txt`.
- Evidence refs: quality tests assert definition, active-reference, mentioned-symbol, prompt-present, and ranking evidence refs.

## Runtime-Core Cleanup

- Completed local readonly diagnostic helper wiring in `openclaw_runtime/src/runtime-core/agent-map.ts` so `buildBudgetedAgentMapResult()` can return diagnostic evidence without runtime failures.
- Removed an unused private extraction wrapper and used a narrow parse-diagnostics cast for current TypeScript compatibility.
- This cleanup does not register AgentMap, does not change provider ordering, and does not feed AgentMap into prompt or TaskLoop paths.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md` passed.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md` passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-quality.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts` passed: 3 files, 7 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck` passed.
- Forbidden service/listener/daemon/database scan over touched files returned no matches.
- Forbidden mutation/apply/edit scan over touched files returned no matches.
- TaskLoop/Gateway/provider-ordering/prompt/renderer-transport cutover scan over touched files returned no matches.
