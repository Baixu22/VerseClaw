# DCS W1 COMPLETE — D2 task_phase_change producer + attempt DCS deps

**Date**: 2026-07-14  
**Window**: W1 (DCS wiring repair)  
**Commit message**: `fix(runtime): wire dcs task_phase_change producer`

## Goal

Make Stage 2 *writable* on the real product path:

1. TaskLoop lifecycle phase transitions call `runAgentHarnessTaskPhaseChangeHook`.
2. Embedded attempt/compact pass DCS deps (`sink` / `store` / optional `objective` / `parentSessionId`) into `buildEmbeddedExtensionFactories`.

## production wiring status: partial

Tools still missing (context_read/search/write agent tools = D1/W2).  
Remaining debt: **D1 D3 D4 D5 D6 D7**.

## Production call sites (file:line)

### A. TaskLoop phase producer (authoritative)

| Site | Location |
|------|----------|
| Lifecycle emit bridge | `openclaw_runtime/src/agents/task-loop-controller.ts:2671` — `emit()` → `emitTaskLoopTaskPhaseChange(record, event)` |
| Producer implementation | `openclaw_runtime/src/agents/task-loop-controller.ts:2680` — `function emitTaskLoopTaskPhaseChange` |
| Hook dispatch | `openclaw_runtime/src/agents/task-loop-controller.ts:2699` — `void runAgentHarnessTaskPhaseChangeHook({...})` |
| Hook import | `openclaw_runtime/src/agents/task-loop-controller.ts:56` |

Behavior:

- Maps via existing `runtimeTaskStatusForTaskLoop(phase, status)`.
- Fires **once per true `RuntimeTaskStatus` change** (deduped via `WeakMap`).
- First observation of `created` seeds without a synthetic prior emit.
- First non-created status uses effectiveFrom `created`.
- Hook failures are logged (`taskLoopPhaseLog.warn`); TaskLoop control flow does not throw.

### B. Attempt / compact factory deps

| Site | Location |
|------|----------|
| Deps helper | `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts:26` — `resolveEmbeddedDcsExtensionDeps` |
| Attempt resolve | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2193` |
| Attempt pass-through | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2205-2208` (`workingMemoryStore`, `contextBlockSink`, `objective`, `parentSessionId`) |
| Compact resolve | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:1212` |
| Compact pass-through | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:1223-1226` (+ `sessionId`/`sessionKey` for parity) |

Helper behavior:

- Builds `BlockStore(openOpenClawStateDatabase().db)` + `createContextBlockSink(store)`.
- Optional `objective` from `prompt`, `parentSessionId` from `spawnedBy`.
- Returns `undefined` on open failure (safe omit; factories keep prior no-sink behavior).
- Does **not** hard-enable feature flags.
- `trajectoryCapture` intentionally omitted (W4 / SEKB install).

## Tests added

| File | What it proves if removed |
|------|---------------------------|
| `openclaw_runtime/src/agents/task-loop-controller.dcs-phase-producer.test.ts` | Production `emitTaskLoopTaskPhaseChange` path calls hook once per true status transition; rejection does not throw |
| `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.test.ts` | Deps helper supplies sink/store; factories set `TaskStateHandlerConfig`; missing deps leave config undefined |

`package.json` `test:dcs` / `lint:dcs` include both new files + `task-loop-controller.ts`.

## Gate results (all exit 0)

| Gate | Command | Exit |
|------|---------|------|
| Focused vitest | `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/embedded-agent-runner/dcs-extension-deps.test.ts src/agents/task-loop-controller.dcs-phase-producer.test.ts src/agents/embedded-agent-runner/extensions.task-state.test.ts` | **0** (3 files / 10 tests) |
| DCS suite | `pnpm run test:dcs` | **0** (unit 12/136 + runtime-config 4/8 + agents 8/34) |
| DCS lint (type-aware) | `pnpm run lint:dcs` | **0** |
| Typecheck | `pnpm run typecheck` | **0** (node + web) |

Note: full `openclaw_runtime` `tsgo:core` remains red on pre-existing shared/CJS and unrelated package errors; not introduced by W1. DCS surface is gated by `lint:dcs --type-check` + root `typecheck`.

## Out of scope (unchanged)

- D1 context_* agent tools
- D5 toolEntries fill
- D4 SEKB install / trajectoryCapture product path
- D3 fingerprint
- D6 real E2E
- D7 observability counters
- UI / Settings / host-api

## Files in commit

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/agents/task-loop-controller.dcs-phase-producer.test.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.test.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`
- `package.json`
- `team/dcs/DCS-W1-COMPLETE.md`
