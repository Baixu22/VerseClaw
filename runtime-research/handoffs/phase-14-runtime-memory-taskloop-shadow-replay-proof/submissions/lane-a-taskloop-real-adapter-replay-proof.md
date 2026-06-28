# Lane A: TaskLoop Real Adapter Replay Proof

## Scope Rechecked

- Source: `openclaw_runtime/src/agents/task-loop-controller.ts`; `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`.
- Tests: `tests/unit/task-loop-controller.test.ts`; focused Runtime Memory suite.
- Prior phase evidence: Phase 13 synthesis accepted only dual-flag sanitized TaskLoop terminal episode shadow writes.

## Evidence

| Claim | Evidence | Result |
|---|---|---|
| Phase 14 uses a fresh spec before implementation | `harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md` was created and `harness context`/`validate` passed. | pass |
| Real TaskLoop adapter path persists one replayable sanitized episode | Added `replays the real persisted TaskLoop Runtime Memory episode without reading memory into TaskLoop` in `tests/unit/task-loop-controller.test.ts`; it runs TaskLoop without injecting a writer, uses temp SQLite through `runtimeMemoryIntegrationOptions`, then reloads via `createRuntimeMemoryRuntimeIntegration().loadStore()`. | pass |
| Replay is episode-only | The test asserts `episodes: 1`, `facts: 0`, and `invalidations: 0`, and `queryFacts(...)` returns `[]`. | pass |
| Replay is sanitized and non-authoritative | The test asserts `redactionStatus: "sanitized"` plus `shadowOnly`, `legacyDecisionUnaffected`, `noProviderHydration`, `noFactExtraction`, and `noRuntimeAuthority` metadata. | pass |
| Raw task/self-check/subagent/template/tool/env/trace markers do not replay | The test asserts the replay JSON does not contain the raw task string, self-check summary, template marker, subagent ids, stdout/stderr, `process.env`, `secret`, `traceparent`, `tracestate`, or `baggage`. | pass |

## Commands

```text
cmd /d /c ""C:\Users\27933\.cherrystudio\bin\rtk.exe" "C:\Program Files\nodejs\node.exe" node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts"
```

Result: pass, 1 file / 56 tests.

```text
cmd /d /c ""C:\Users\27933\.cherrystudio\bin\rtk.exe" "C:\Program Files\nodejs\node.exe" node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts"
```

Result: pass, 9 files / 111 tests.

## Rejected Claims

- TaskLoop memory reads.
- Provider hydration or provider output.
- Fact writes, invalidations, durable promotion, or candidate promotion.
- Runtime authority from persisted memory.

## Gaps

- None for the accepted narrow replay proof.

Status: accepted
