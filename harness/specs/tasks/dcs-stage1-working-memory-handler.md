---
id: dcs-stage1-working-memory-handler
title: DCS Stage 1 working memory handler
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the DCS v1.6 Stage 1 default-off tool_result to working-memory-handler to BlockStore to Assembler pre-LLM loop, while preserving component ownership, deterministic admission and eviction, flag-off identity, and zero COMPASS writes.
touchedAreas:
  - harness/specs/tasks/dcs-stage1-working-memory-handler.md
  - team/dcs/dcs-v1.6-spec.md
  - team/dcs/dcs-v1.6-review.md
  # R1 on main carries the Stage 0 foundation plus the M0 authority-restoration
  # doc set in the same round; these entries align ownership with that reality.
  - team/dcs/**
  - harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md
  - harness/specs/rules/coding-runtime-workspace-dcs-producer-boundary.md
  - harness/specs/tasks/dcs-stage2-task-state-handoff.md
  - harness/specs/rules/dcs-stage2-handoff-boundary.md
  - docs/superpowers/plans/2026-07-11-coding-runtime-p0-workspace-dcs-producer.md
  - docs/superpowers/plans/2026-07-11-dcs-stage2-readiness-and-handoff.md
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/src/context-engine/block.test.ts
  - openclaw_runtime/src/context-engine/block-store.ts
  - openclaw_runtime/src/context-engine/block-store.test.ts
  - openclaw_runtime/src/context-engine/handlers/working-memory-handler.ts
  - openclaw_runtime/src/context-engine/handlers/working-memory-handler.test.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/assembler.test.ts
  - openclaw_runtime/src/agents/harness/hook-context.ts
  - openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts
  - openclaw_runtime/src/agents/harness/dcs-stage0-hooks.test.ts
  - openclaw_runtime/src/plugins/hook-types.ts
  - openclaw_runtime/src/plugins/hooks.ts
  - openclaw_runtime/src/sessions/session-key-utils.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.working-memory.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/runtime-context-block-working-memory.test.ts
  - openclaw_runtime/tsdown.config.ts
  - openclaw_runtime/scripts/build-diffs-viewer-runtime.mjs
  - openclaw_runtime/scripts/check-cli-bootstrap-imports.mjs
  - openclaw_runtime/scripts/lib/plugin-sdk-entrypoints.json
  - openclaw_runtime/scripts/write-cli-compat.ts
  - openclaw_runtime/scripts/write-cli-startup-metadata.ts
  - openclaw_runtime/test/scripts/pruned-runtime-build-contract.test.ts
  - openclaw_runtime/src/context-engine/pruned-runtime-build-contract.test.ts
  - openclaw_runtime/src/gateway/health-runtime/status.summary.runtime.ts
  - package.json
  - .gitignore
  - team/dcs/README.md
expectedUserBehavior:
  - With runtime.contextBlock.working-memory.enabled omitted or false, no working-memory extension handler, BlockStore construction, BlockStore query, BlockStore write, or prompt/message mutation occurs, and Assembler returns the exact existing output reference.
  - An explicit standardized tool-result working-memory envelope with significance high or medium updates one stable per-session working_memory Block and becomes visible on the next pre-LLM call under the exact heading "## Recent Actions".
  - Significance low is recorded only through observability and never reaches ContextBlockSink or BlockStore.
  - Missing significance is rejected and recorded through observability without inferring significance from tool name, arguments, content, status, or result text.
  - The per-session rolling window contains at most five actions; overflow evicts the oldest medium action first, otherwise the oldest high action, and retained actions remain in arrival order.
  - Overlapping tool_result callbacks for one session are merged in callback-entry order without lost updates; a rejected sink write leaves the last accepted Block as the next merge baseline.
  - Stage 1 never invokes or writes COMPASS and does not change Renderer, Electron Main, Gateway transport, or existing legacy prompt builders.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/dcs-stage1-working-memory-handler.md
  - pnpm harness validate --spec harness/specs/tasks/dcs-stage1-working-memory-handler.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/handlers/working-memory-handler.test.ts src/context-engine/assembler.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.runtime-config.config.ts src/config/runtime-context-block-working-memory.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/harness/dcs-stage0-hooks.test.ts src/agents/embedded-agent-runner/extensions.working-memory.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.tooling.config.ts test/scripts/pruned-runtime-build-contract.test.ts
  - pnpm run typecheck
  - pnpm run lint
  - pnpm test
  - pnpm run test:dcs
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run harness:ci
  - pnpm harness run --spec harness/specs/tasks/dcs-stage1-working-memory-handler.md
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm --dir openclaw_runtime build
acceptance:
  - The RED run records expected failures for the absent handler, missing admission-preserving sink envelope, absent working-memory Assembler injection, absent runtime wiring, and absent default-off config contract before any production implementation is written.
  - ContextBlockSink carries ContextBlock plus its BlockAdmissionContext so BlockStore receives high or medium significance, returns equal-length ordered BlockWriteResult evidence, and contains no rolling-window or eviction policy.
  - The tool-result producer contract reads only an explicit details.working_memory envelope containing result_summary and significance; result_summary is never reconstructed from raw tool output and significance is never inferred.
  - The working-memory handler alone parses and merges the stable per-session window, constructs the working_memory ContextBlock, caps the window at five, evicts oldest medium before oldest high, and preserves retained arrival order.
  - BlockStore remains the sole persistence, admission, transaction, and query owner and receives every accepted write through upsert(block, admission).
  - Assembler performs only readonly BlockStore selection and prompt/message formatting, injects the exact heading "## Recent Actions", and never writes BlockStore.
  - The runtime hook layer only normalizes the explicit producer envelope, dispatches the handler, passes ContextBlockSink, invokes Assembler at the context/pre-LLM boundary, and records low/rejection observability without altering the business outcome.
  - runtime.contextBlock.working-memory.enabled is represented in exported config types, strict schema, labels, and help; omission is false and the disabled path proves reference-level identity plus zero BlockStore construction/query/write.
  - High and medium writes are visible on the next pre-LLM call, low and missing-significance results never create or update a Block, and integration tests use the real BlockStore boundary.
  - Same-session callbacks are serialized only inside the active attempt, while the existing session write lock remains the sole cross-attempt exclusion owner; no second session lock or classifier is introduced.
  - Existing Stage 0 Assembler dependencies on buildPreReplyInjection and buildContextPack remain intact and flag-gated; no new working-memory path imports, invokes, mocks, or writes those builders, buildRoleSystemPrompt, COMPASS TemporalFact, task_state, knowledge, notes, handoff, Renderer/Main/Gateway transport, direct IPC, direct Gateway HTTP/WebSocket, raw SQLite DDL, or a new event bus.
  - Existing Runtime build entry failures are repaired against this repository's pruned openclaw_runtime baseline, using the smallest local source/configuration repair needed for declared retained entries; no unrelated upstream module set is restored, no business dependency is externalized, and no build gate is weakened.
  - package.json test:dcs and lint:dcs include every new Stage 1 source and test file.
  - Ownership scans, all required commands, untracked-file inspection, and an independent review report no Critical or Important issue before team/dcs/README.md is marked Stage 1 complete.
docs:
  required: true
  files:
    - team/dcs/README.md
---

# DCS Stage 1 Working Memory Handler

This task spec is an execution and validation manifest for `team/dcs/dcs-v1.6-spec.md`; it is not a parallel DCS design source. If this task conflicts with DCS v1.6, the DCS specification and its final review win and this task must be corrected before production edits continue.

## Authoritative Inputs

Read and apply, in order:

1. `AGENTS.md`
2. `team/dcs/dcs-v1.6-spec.md`, especially Chapters 2, 4, and 9
3. `team/dcs/dcs-v1.6-review.md`
4. `team/dcs/README.md`
5. `team/architecture-audit-full.md`
6. `harness/specs/scenarios/gateway-backend-communication.md`
7. `harness/specs/rules/backend-communication-boundary.md`
8. `harness/specs/rules/contract-first-boundary.md`
9. `harness/specs/rules/comms-regression.md`
10. `harness/specs/layers/openclaw-runtime.md`

## Component Ownership

- Tool-result producer: supplies only the explicit standardized `details.working_memory` result envelope and never accesses BlockStore or SQLite.
- Working-memory handler: accepts only normalized high/medium actions plus the latest accepted working_memory Block, and owns only structured window parsing, merge, deterministic eviction, and ContextBlock construction.
- BlockStore: exclusively owns persistence, admission, transactions, and queries; it never formats prompt text.
- Assembler: performs readonly BlockStore selection and formats/injects working-memory content; it never writes BlockStore.
- Hook/extension layer: validates and normalizes only the explicit producer envelope, serializes same-session callbacks in entry order, dispatches the handler, wraps its candidate Block with admission evidence, and passes ContextBlockSink; it does not own merge, eviction, persistence, or prompt-format policy.
- Observability: records low-significance and rejection outcomes and cannot change the handler result or create a write.
- Renderer, Electron Main, Gateway transport, COMPASS, task_state, knowledge, notes, and handoff remain untouched by Stage 1.

## Admission-Preserving Sink Contract

The Stage 0 sink shape loses the admission evidence required by `BlockStore.upsert`. Before runtime wiring, refine the shared contract to an admission-preserving envelope:

```ts
type ContextBlockWrite = {
  block: ContextBlock;
  admission?: BlockAdmissionContext;
};

type ContextBlockSink = (
  writes: readonly ContextBlockWrite[],
) => Promise<readonly BlockWriteResult[]>;
```

Accepted high/medium handler output must carry the original significance in `admission`. Low and missing-significance outcomes must not produce a write envelope. The sink adapter calls `BlockStore.upsert(write.block, write.admission)` in input order and returns an equal-length, same-order result list, but it may not merge windows, choose eviction candidates, format prompts, or infer metadata.

## Producer Metadata Contract

Stage 1 hook wiring consumes only an explicit standardized envelope:

```ts
details: {
  working_memory: {
    result_summary: string;
    significance: "high" | "medium" | "low";
  };
}
```

`result_summary` must be a non-empty producer-supplied structured summary of at most 100 characters. An absent or malformed summary is rejected and observed; raw `content`, tool arguments, tool name, error status, or arbitrary details are not used to synthesize it. An absent or invalid significance is rejected and observed; no heuristic fallback is permitted.

The hook/extension layer owns this boundary validation. The working-memory handler is never called for low, missing, or malformed metadata; it receives only `{ tool, result_summary, significance: "high" | "medium" }`.

## Deterministic Window Contract

- One stable working_memory Block is used per session.
- Accepted actions are stored in arrival order as `{ tool, result_summary, significance }`.
- Appending beyond five entries removes the oldest medium entry.
- If no medium entry exists, appending beyond five removes the oldest high entry.
- The remaining entries retain their prior relative order.
- The handler performs no COMPASS call, import, write, or side effect.
- The hook/extension layer initializes from the current persisted stable Block, queues same-session `tool_result` callbacks in callback-entry order, and advances its current Block only after the matching sink result is accepted.
- The context/pre-LLM callback waits for already queued synchronous tool-result writes before querying BlockStore.
- An overlapping-update test must prove no lost updates and deterministic order.

## RED Evidence

Before production edits, add focused tests that fail for the intended missing behavior:

1. Handler tests fail because the module/API does not exist and cover stable block identity, persisted-window parsing, high/medium action merge, five-entry capacity, oldest-medium-first eviction, all-high fallback eviction, and retained order.
2. Hook-context tests fail because ContextBlockSink cannot carry BlockAdmissionContext, cannot return ordered BlockWriteResult evidence, and cannot be awaited.
3. Assembler tests fail because working_memory is not a default-false flag, no readonly BlockStore query occurs when enabled, no `## Recent Actions` injection exists, and disabled output is not yet proven against working-memory dependencies.
4. Runtime integration tests fail because the explicit tool-result envelope is not dispatched through ContextBlockSink, the real BlockStore is not updated, low/rejected observations are not emitted, overlapping callbacks lose ordering/update evidence, sink rejection can poison the next merge baseline, the next context event does not await and inject the window, and the flag-off path is not a reference-level no-op with zero store access.
5. Config tests fail because the strict schema and exported config type do not yet accept `runtime.contextBlock["working-memory"].enabled` while omission remains disabled.

Record the commands, expected failure reason, and non-zero exit code before implementing the corresponding production behavior.

## Runtime Build Repair

The Runtime build repair is a user-mandated acceptance prerequisite for this Goal, not an expansion of DCS Stage 1 behavior and not a parallel DCS design source. It remains in this exact touched-area manifest so the required final build cannot be made green through an untracked or hidden side change.

Repair the build against this repository's current pruned `openclaw_runtime` baseline. Use the smallest local source/configuration change required for retained build entries, especially the `commands/status.summary.runtime` entry and its `src/gateway/health-runtime/status.summary.runtime.ts` source. Do not restore unrelated upstream module families, create an empty compatibility shell, externalize a business dependency, or lower the build gate. If a build entry is not a retained capability of the pruned runtime, the repair must document and encode that current local contract instead of importing upstream dependency closure by default.

The pruned runtime's retained executable is `src/entry.ts`, which starts the Gateway directly. CLI-only generated artifacts may be skipped only when their owning source entry is absent. That decision must be covered by `test/scripts/pruned-runtime-build-contract.test.ts`, must remove stale generated CLI artifacts, and must not suppress validation of any retained entry. The bootstrap guard must continue to inspect `dist/entry.js`; it may omit `dist/cli/run-main.js` and its gateway-command chunk budget only when the corresponding source entry is absent.

## Forbidden Scope

- No new event bus or parallel session classifier.
- No direct SQLite DDL outside existing schema ownership.
- No direct Renderer IPC or Gateway HTTP/WebSocket call.
- Preserve the existing Stage 0 Assembler imports, dependency injection, and flag-gated calls for `buildPreReplyInjection` and `buildContextPack`; no new working-memory path may import, invoke, mock, or modify them.
- No modifications to `buildPreReplyInjection`, `buildContextPack`, `buildRoleSystemPrompt`, Renderer/Main/Gateway transport, COMPASS, task_state, knowledge, notes, or handoff behavior.
- No blanket skips, assertion deletion, fake passes, test-only production switches, or build-entry removal.

## Completion Sequence

1. Pass Harness context and validation before production edits.
2. Add and run RED tests; record expected non-zero exits.
3. Implement the minimum production behavior and turn focused tests GREEN.
4. Run ownership, forbidden-import, COMPASS-zero-call, identity, and untracked-file scans.
5. Run every required acceptance command and record its exit code.
6. Obtain an independent review with no Critical or Important issue.
7. Only then update `team/dcs/README.md` and produce the final acceptance report.
