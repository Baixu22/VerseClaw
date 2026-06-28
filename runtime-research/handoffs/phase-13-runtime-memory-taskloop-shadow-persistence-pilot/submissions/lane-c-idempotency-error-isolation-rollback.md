# Lane C: Idempotency, Error Isolation, And Rollback

## Scope

Lane C accepts the current TaskLoop Runtime Memory shadow persistence pilot as idempotent, bounded, rollback-safe, and error-isolated.

Adapter failures remain shadow-only diagnostics. They do not change TaskLoop terminal status, returned payloads, approval/retry/tool policy, verifier/security behavior, event-log/checkpoint/resume behavior, or provider ordering.

## Files Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/README.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/parallel-lanes.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-a-taskloop-callsite-gate-disabled-parity.md`
- Lane B submission: not present when reviewed.
- `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md`
- `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md`
- `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-memory-runtime-integration.test.ts`
- `tests/unit/runtime-memory-persistence.test.ts`

## Files Changed

- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-c-idempotency-error-isolation-rollback.md`

## Prerequisite Proof

- Phase 12 synthesis exists and ends with `Status: accepted` at `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md:87`.
- Phase 12 explicitly accepted planning/spec/evidence only and rejected TaskLoop, Gateway, runtime call-site, provider-ordering, default-on persistence, raw retention, service/listener/exporter, and runtime-authority cutover.
- Phase 11 synthesis ends accepted at `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md:116` and accepted only isolated default-off adapter wiring.
- Phase 10 synthesis ends accepted at `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md:105` and accepted only default-off integration boundary/readiness.
- Phase 9 synthesis ends accepted at `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md:139` and accepted only the default-off local sanitized persistence foundation.

## Stable Idempotency Key Proof

- TaskLoop builds exactly one terminal episode record after normal/error trace completion at `openclaw_runtime/src/agents/task-loop-controller.ts:2906` and `openclaw_runtime/src/agents/task-loop-controller.ts:2922`.
- The episode id is deterministic from the TaskLoop run id, terminal phase, and terminal status at `openclaw_runtime/src/agents/task-loop-controller.ts:1892`.
- The idempotency key is also deterministic and stable for the same terminal result: `task-loop:${loopRunId}:terminal:${phase}:${status}` at `openclaw_runtime/src/agents/task-loop-controller.ts:1896`.
- The enabled TaskLoop test asserts the exact terminal idempotency key `task-loop:loop_memory_enabled:terminal:complete:complete` at `tests/unit/task-loop-controller.test.ts:767-774`.
- The episode is bounded to terminal metadata, bounded summary counts, source refs, evidence refs sliced to 20, and no runtime-authority metadata at `openclaw_runtime/src/agents/task-loop-controller.ts:1871-1935`.

## Duplicate-Write Prevention

- Persistence checks for an existing episode first by idempotency key, then by canonical episode id at `openclaw_runtime/src/runtime-core/memory-persistence.ts:575-607`.
- When a duplicate exists, persistence merges evidence/source refs, updates the canonical row, inserts the alias idempotency key, and returns `stored:false` plus `duplicate:true` at `openclaw_runtime/src/runtime-core/memory-persistence.ts:486-495`.
- New episodes insert exactly one episode row, then insert the idempotency key mapping at `openclaw_runtime/src/runtime-core/memory-persistence.ts:498-500`.
- The idempotency-key table uses `idempotency_key` as the primary key and maps to the canonical episode id; inserts use `onConflict(...doNothing())` at `openclaw_runtime/src/runtime-core/memory-persistence.ts:672-688`.
- The persistence test writes the same episode with a second idempotency key and proves it is persisted as a duplicate without a second episode row, then confirms two idempotency keys map to the retained canonical episode at `tests/unit/runtime-memory-persistence.test.ts:83-107` and `tests/unit/runtime-memory-persistence.test.ts:211-215`.

## Bounded Retention

- The TaskLoop pilot only writes `kind: "task_event"` terminal episodes through `appendEpisode`; it does not call `appendFact`, `invalidateFact`, or `loadStore` from TaskLoop.
- Persistence trims rows through the existing Phase 9 bounded-store policy after enabled writes at `openclaw_runtime/src/runtime-core/memory-persistence.ts:500`, `openclaw_runtime/src/runtime-core/memory-persistence.ts:529`, and `openclaw_runtime/src/runtime-core/memory-persistence.ts:558`.
- `trimRows()` normalizes the configured/fallback max, orders oldest rows first, and deletes only rows beyond the bound at `openclaw_runtime/src/runtime-core/memory-persistence.ts:954-977`.
- The bounded retention test sets max episodes/facts/invalidations to 1 and proves only the newest row of each type remains in both the loaded store and SQLite at `tests/unit/runtime-memory-persistence.test.ts:252-311`.

## Adapter Failure Isolation

- TaskLoop requires both `runtime.memory.shadow === true` and `runtime.memory.persist === true` before constructing or calling the adapter at `openclaw_runtime/src/agents/task-loop-controller.ts:1814-1824`.
- The adapter write is wrapped in `try/catch`; the catch intentionally swallows Runtime Memory write errors because shadow persistence must not perturb TaskLoop results at `openclaw_runtime/src/agents/task-loop-controller.ts:1826-1835`.
- The write call occurs after TaskLoop terminal state, checkpoint recording, trace completion, and trace storage, immediately before returning a cloned run record at `openclaw_runtime/src/agents/task-loop-controller.ts:2888-2907` and `openclaw_runtime/src/agents/task-loop-controller.ts:2908-2923`.
- The injected failure test makes `appendEpisode` throw `sqlite unavailable` and still asserts `status: complete`, `phase: complete`, `finalSummary: done`, `nextActions: ["synthesize_final_response"]`, and unchanged checkpoint metadata at `tests/unit/task-loop-controller.test.ts:805-850`.
- Disabled parity tests inject both a throwing writer and a throwing SQLite opener; omitted flags, `shadow=false`, `persist=false`, and `persist=true` with shadow omitted leave the run complete and prove zero writes/opens at `tests/unit/task-loop-controller.test.ts:661-720`.
- Runtime integration separately returns skipped results before delegating when `persist` is false at `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts:55-101`; its disabled test proves migrate/write/read operations do not open SQLite at `tests/unit/runtime-memory-runtime-integration.test.ts:38-72`.
- Persistence itself independently checks `persist` before migrate/write/load transaction paths at `openclaw_runtime/src/runtime-core/memory-persistence.ts:342-443`; its disabled test proves no open/migrate/read/write when `persist` is false at `tests/unit/runtime-memory-persistence.test.ts:31-65`.

## Legacy Behavior Isolation

- TaskLoop result payloads are built before the shadow write and returned from the same record clone path at `openclaw_runtime/src/agents/task-loop-controller.ts:2906-2907` and `openclaw_runtime/src/agents/task-loop-controller.ts:2922-2923`.
- Verifier/security behavior remains legacy-owned: the runtime memory episode metadata explicitly marks `noVerifierAuthority`, `noSecurityAuthority`, `noRetryAuthority`, `noToolAuthority`, and `noRuntimeAuthority` at `openclaw_runtime/src/agents/task-loop-controller.ts:1913-1918`.
- The tool-level disabled test keeps TaskLoop tool and verifier behavior unchanged with `runtime.memory.persist=false` and evidence verifier shadow enabled at `tests/unit/task-loop-controller.test.ts:2133-2190`.
- Provider ordering is not changed by TaskLoop. The import scan found the Runtime Memory adapter import/call site only in `openclaw_runtime/src/agents/task-loop-controller.ts` and the TaskLoop test; no Gateway/Electron/shared/renderer/provider-registry/default-barrel matches were found.
- Runtime Memory provider output remains separately gated. The integration test proves `runtime.memory.persist=true` with `runtime.memory.provider=false` returns fallback context, requires `runtime.memory.provider`, and does not call `queryFacts` at `tests/unit/runtime-memory-runtime-integration.test.ts:339-378`.

## Rollback Proof

- Rollback path 1: disable `runtime.memory.shadow`; TaskLoop returns before adapter construction/call at `openclaw_runtime/src/agents/task-loop-controller.ts:1814-1824`, proven by `shadow=false` test coverage at `tests/unit/task-loop-controller.test.ts:661-720`.
- Rollback path 2: disable `runtime.memory.persist`; TaskLoop returns before adapter construction/call at `openclaw_runtime/src/agents/task-loop-controller.ts:1814-1824`, and the adapter/persistence layers also return skipped before database access at `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts:55-101` and `openclaw_runtime/src/runtime-core/memory-persistence.ts:342-443`.
- Rollback path 3: omit the TaskLoop adapter import/call site; no other production path scanned imports `memory-runtime-integration`, `createRuntimeMemoryRuntimeIntegration`, `createRuntimeMemoryPersistenceStore`, `memory-persistence`, or `RUNTIME_MEMORY_PERSISTENCE_OWNER` into Gateway/Electron/shared/renderer/provider-registry/default-barrel surfaces.
- Existing Phase 9 rows are preserved by rollback-by-disable because disabled TaskLoop returns before adapter construction and disabled adapter/persistence returns before SQLite open. No rollback cleanup, migration deletion, or doctor/delete policy is introduced by Phase 13.

## No Row-Deletion Or Doctor Policy

- Phase 13 adds no doctor command, migration cleanup, rollback cleanup, hard delete, `unlink`, or data-removal policy for Runtime Memory rows.
- The only row deletion on the reviewed surface is the preexisting bounded-retention trim in the Phase 9 persistence owner at `openclaw_runtime/src/runtime-core/memory-persistence.ts:954-977`, which is exercised only after enabled persistence writes and is covered by the bounded-retention test.
- This lane does not accept deleting existing persisted rows during rollback. Rollback is flag disablement or omitting the TaskLoop pilot call site while preserving Phase 9 rows.

## Raw Retention And Service Boundary

- The TaskLoop enabled test proves the raw request text and final summary are absent from the episode JSON at `tests/unit/task-loop-controller.test.ts:801-802`.
- The persistence test rejects raw tool output and proves persisted SQLite JSON does not contain `stdout dump` or `raw prompt` at `tests/unit/runtime-memory-persistence.test.ts:108-123` and `tests/unit/runtime-memory-persistence.test.ts:227-238`.
- Raw-retention scan matches in the reviewed files are negative fixtures, sanitizer-related trace fields, or preexisting prompt-sanitization tests; no TaskLoop memory episode write stores raw prompts, transcripts, full payloads, full checkpoints, tool args/output, env, secrets, raw traceparent/tracestate/baggage, stdout, or stderr.
- Service/exporter/database-service/listener scan over the Lane C reviewed source/tests returned no matches.

## Validation

- `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-memory-persistence.test.ts`: pass, 3 files / 64 tests.
- Bare `rtk` was not on PATH in this shell, so validation used the absolute RTK path documented in the Phase 13 handoff.

Status: accepted
