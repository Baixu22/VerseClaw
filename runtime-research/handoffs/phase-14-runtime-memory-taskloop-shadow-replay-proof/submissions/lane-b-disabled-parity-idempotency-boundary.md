# Lane B: Disabled Parity And Idempotency Boundary

## Scope Rechecked

- Source: `openclaw_runtime/src/agents/task-loop-controller.ts`; `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`.
- Tests: `tests/unit/task-loop-controller.test.ts`; `tests/unit/runtime-memory-persistence.test.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts`.

## Evidence

| Claim | Evidence | Result |
|---|---|---|
| Dual flag gate remains strict | `runtimeMemoryShadowPersistenceEnabled()` still requires `flags.shadow === true && flags.persist === true`. | pass |
| Disabled TaskLoop states do not open or write Runtime Memory | Existing TaskLoop table test covers omitted flags, `shadow=false`, `persist=false`, and `persist=true` with omitted shadow; it injects throwing writer/openDatabase and asserts no calls. | pass |
| Adapter disabled parity remains no-open/no-read/no-write | `runtime-memory-runtime-integration.test.ts` and `runtime-memory-persistence.test.ts` both cover disabled persistence with throwing openers. | pass |
| Idempotency/replay remains canonical | `runtime-memory-persistence.test.ts` persists an alias idempotency key, reloads one canonical episode, and asserts the alias source ref merges into the canonical replay. | pass |

## Commands

```text
cmd /d /c ""C:\Users\27933\.cherrystudio\bin\rtk.exe" "C:\Program Files\nodejs\node.exe" node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts"
```

Result: pass, 9 files / 111 tests.

## Rejected Claims

- `runtime.memory.persist` alone enabling TaskLoop writes.
- Disabled states opening SQLite, reading memory, or writing memory.
- Alias idempotency creating duplicate replay episodes.

## Gaps

- None for disabled parity and idempotency boundary proof.

Status: accepted
