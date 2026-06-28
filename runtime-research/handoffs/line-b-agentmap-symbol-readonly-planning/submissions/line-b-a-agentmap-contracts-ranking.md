# line-b-a-agentmap-contracts-ranking: AgentMap readonly contracts and ranking reasons

## Scope Confirmation

- Lane: Line B Phase 1 / Lane A AgentMap readonly contracts.
- Runtime code touched:
  - `openclaw_runtime/src/runtime-core/agent-map.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Tests touched:
  - `tests/unit/runtime-agent-map-contracts.test.ts`
- Documentation touched:
  - this submission file

## Required Reading

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`
- `runtime-research/aider/algorithms.md`
- `runtime-research/aider/contracts.md`
- `runtime-research/aider/clawx-mapping.md`
- `runtime-research/aider/useful-tests.md`
- `openclaw_runtime/AGENTS.md`
- `openclaw_runtime/src/runtime-core/types.ts`
- `openclaw_runtime/src/runtime-core/registries.ts`
- Harness context selected scenario/rules/layers for `phase-line-b-agentmap-symbol-readonly`.

Tooling note: `rtk` was not on PATH in this workspace. The first direct `pnpm harness context` attempt was blocked by pnpm's ignored-builds dependency check; reruns used `pnpm --config.verify-deps-before-run=false ...` or direct `node` entrypoints.

## Implementation Summary

- Added canonical AgentMap readonly contract types for request, tag, source range, ranked tag, ranking reason, file selection, evidence, and result.
- Added closed vocabularies and type guards for refresh policies, languages, tag kinds, symbol kinds, ranking reason kinds, evidence types, file-selection reasons, and result statuses.
- Added deterministic fixture builders for AgentMap requests, tags, ranking reasons, evidence, ranked tags, file selections, and results.
- Exported the pure contract from `openclaw_runtime/src/runtime-core/index.ts`.
- Added focused unit tests for vocabulary stability, valid fixtures, prompt-present file exclusion metadata, readonly result shape, budget bound, and malformed-value rejection.

## Boundary Evidence

| Claim | Evidence |
|---|---|
| AgentMap request/result/tag/ranking/evidence contracts exist | `openclaw_runtime/src/runtime-core/agent-map.ts` defines `AgentMapRequest`, `AgentMapTag`, `AgentMapRankingReason`, `AgentMapEvidence`, `AgentMapRankedTag`, `AgentMapFileSelection`, and `AgentMapResult`. |
| Ranking is explainable but not algorithmic cutover | `AGENT_MAP_RANKING_REASON_KINDS` includes reason codes such as `fromActiveFileReference`, `mentionedByUser`, `pathComponentMatch`, `uniqueDefinition`, and `budgetFit`; no PageRank or provider execution code was added. |
| Result remains readonly and budget bounded | `isAgentMapResult()` requires `readonly: true` and `tokenEstimate <= tokenBudget`; `tests/unit/runtime-agent-map-contracts.test.ts` rejects `readonly: false` and over-budget results. |
| Prompt-present files can be excluded/marked without prompt assembly changes | The fixture result excludes `src/components/chat/Composer.tsx` with reason `promptPresentFile`; no prompt assembly files were touched. |
| No AgentMap provider registration | `openclaw_runtime/src/runtime-core/registries.ts`, context-engine provider registry files, TaskLoop, Gateway, renderer, host-api, api-client, and model-message paths were not changed by this lane. |
| No read/grep/find/ls or Symbol mutation behavior changed | Only runtime-core contract/barrel and a focused unit test were added; boundary scans over touched files found no service/listener/database, Symbol edit, AST apply, or transport bypass patterns. |

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` passed and returned the expected read order.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts` passed: 1 file / 4 tests.
- `node ..\node_modules\typescript\bin\tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck src/runtime-core/agent-map.ts` passed from `openclaw_runtime/`.
- `node ..\node_modules\typescript\bin\tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck src/runtime-core/index.ts` passed from `openclaw_runtime/`.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` passed.
- Service/listener/daemon/database scan over touched files returned no matches.
- Symbol/AST mutation scan over touched files returned no matches.
- AgentMap provider/TaskLoop/Gateway/prompt/renderer transport bypass scan over touched files returned no matches.

Typecheck note: the broader runtime `tsgo:core` lane is currently blocked by unrelated pre-existing syntax errors in `openclaw_runtime/src/auto-reply/reply/get-reply-directives.ts` and `openclaw_runtime/src/auto-reply/reply/get-reply.ts`.

## Docs Sync

No README translation updates are required because this is a pure runtime-core contract/test addition with no user-visible UI, CLI, Gateway, host-api, renderer, runtime prompt, or provider-ordering behavior change.

Status: accepted
