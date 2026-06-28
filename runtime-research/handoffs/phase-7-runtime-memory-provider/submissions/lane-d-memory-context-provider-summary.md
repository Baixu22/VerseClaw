# lane-d-memory-context-provider-summary: Readonly RuntimeMemoryProvider and budgeted memory context items

## Scope

- Added `openclaw_runtime/src/context-engine/memory-context-provider.ts`.
- Added `tests/unit/runtime-memory-context-provider.test.ts`.
- Did not wire the provider into default registry ordering, TaskLoop, Gateway, renderer, host-api, api-client, persistence, completion, verifier, security, retry, tool, or runtime authority paths.

## Implementation summary

- Introduced `createRuntimeMemoryContextProvider`, gated by `runtime.memory.provider`.
- Disabled provider flag returns a fallback result with empty `contextItems` and a skipped diagnostic.
- Provider output is readonly `ContextItem` memory summaries only:
  - budgeted by `tokenBudget`;
  - source/evidence linked by fact id, source episode ids, and evidence refs;
  - time-labeled with `time_scope`, `valid_at`, `reference_time`, and optional `invalid_at` / `expired_at`;
  - metadata marks no memory dump and no completion/verifier/security/retry/tool/runtime authority.
- Candidate facts remain absent by default and appear only when `includeCandidates` or candidate `verificationStatuses` are explicitly requested.
- Ranking prioritizes accepted verified/human/deterministic facts, source/evidence-backed facts, current task/source episode matches, file/symbol matches, and evidence ref matches.
- Added `createRuntimeMemoryProviderResult` as a readonly helper returning the Phase 7 `RuntimeMemoryContextProviderResult` contract without adding runtime authority.

## Evidence

| Requirement | Evidence | Status |
|---|---|---|
| Provider gated by `runtime.memory.provider` | Disabled test expects fallback/skipped/empty output. | pass |
| No full memory dumps or source bodies | Provider builds text from bounded fact summary/time/source/evidence ids only; test sentinel in metadata is absent from result JSON. | pass |
| No raw episodes/facts/chat/trace text | Provider never serializes fact objects, episode bodies, or external source bodies into context text. | pass |
| Historical facts are time-labeled | Historical query test asserts `time_scope=historical`, `valid_at`, `invalid_at`, and `reference_time`. | pass |
| Candidate facts only on explicit request | Candidate gating test covers default exclusion and explicit inclusion. | pass |
| Optional registration, default ordering unchanged | Registry test keeps default legacy + loop ordering; memory appears only when passed as an extra provider. | pass |
| No authority cutover | Manifest/result/item metadata explicitly mark no completion/verifier/security/retry/tool/runtime authority. | pass |

## Validation

- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` - pass.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` - pass.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/context-provider-registry.test.ts` - pass, 3 files / 19 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` - pass.
- Renderer boundary scan over `src/pages src/components` for direct IPC/Gateway/WebSocket patterns - pass, no matches.
- Touched-file service/exporter scan over the new provider/test files - pass, no matches.
- Touched-file retention scan over the new provider/test files for forbidden raw-retention terms - pass, no matches.

## Notes

- Broad service/exporter scan across `openclaw_runtime/src electron shared tests/unit` still reports existing servers/WebSocket/collector symbols in unrelated files. Lane D did not add or modify those paths.
- `pnpm harness context` attempted to run a dependency-status install check and stopped on the repo's ignored-builds policy; the required harness context was run successfully through `rtk node harness/src/cli.mjs context`.

## Status

Status: accepted
