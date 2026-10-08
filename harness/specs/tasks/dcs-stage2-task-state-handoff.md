---
id: dcs-stage2-task-state-handoff
title: DCS Stage 2 task state adapter and child-session handoff
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the DCS v1.6 Stage 2 task_state adapter and child-session handoff only after the stated readiness gates prove that Stage 1, Coding Runtime P0, and the retained Runtime build baseline are accepted.
touchedAreas:
  - harness/specs/tasks/dcs-stage2-task-state-handoff.md
  - harness/specs/rules/dcs-stage2-handoff-boundary.md
  - docs/superpowers/plans/2026-07-11-dcs-stage2-readiness-and-handoff.md
  - team/dcs/dcs-v1.6-spec.md
  - team/dcs/dcs-v1.6-review.md
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/src/context-engine/block-store.ts
  - openclaw_runtime/src/context-engine/block-store.test.ts
  - openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts
  - openclaw_runtime/src/context-engine/handlers/task-loop-handler.test.ts
  - openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts
  - openclaw_runtime/src/agents/harness/dcs-stage0-hooks.test.ts
  - openclaw_runtime/src/plugins/hook-types.ts
  - openclaw_runtime/src/plugins/hooks.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.task-state.test.ts
  - openclaw_runtime/src/knowledge/sekb/harness-integration.ts
  - openclaw_runtime/src/knowledge/sekb/harness-integration.test.ts
  - eslint.config.mjs
  - package.json
  - team/dcs/README.md
expectedUserBehavior:
  - A real TaskLoop phase transition persists one system-managed task_state Block whose current_phase equals the actual RuntimeTaskStatus transition target.
  - A role subagent receives no serialized state in its prompt. Before child startup, the parent writes a validated HandoffPack to the child session key; the child restores only its own state through BlockStore.
  - A child can read its own Blocks and, only when its own current HandoffPack names one direct parent, can read that parent. Arbitrary targets and recursive ancestors remain unreadable.
  - A terminal task phase creates one SEKB trajectory capture without changing the existing agent_end lifecycle.
  - Existing working-memory behavior, Coding Runtime P0 workspace authority, transcript persistence, and transport behavior remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - docs-sync
  - dcs-stage2-handoff-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/dcs-stage2-task-state-handoff.md
  - pnpm harness validate --spec harness/specs/tasks/dcs-stage2-task-state-handoff.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/block-store.test.ts src/context-engine/handlers/task-loop-handler.test.ts src/knowledge/sekb/harness-integration.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/harness/dcs-stage0-hooks.test.ts src/agents/embedded-agent-runner/extensions.task-state.test.ts
  - pnpm run typecheck
  - pnpm run lint
  - pnpm test
  - pnpm run test:dcs
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run harness:ci
  - pnpm harness run --spec harness/specs/tasks/dcs-stage2-task-state-handoff.md
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm --dir openclaw_runtime build
  - git diff --check
acceptance:
  - Before production edits, a readiness report proves: (1) DCS Stage 1 has a final COMPLETE report, every required gate exited 0, and independent review is Critical 0 / Important 0; (2) Coding Runtime P0 has a final COMPLETE report proving one authoritative workspace root, producer-owned edit/write/apply_patch envelopes, and exactly-once transient Recent Actions injection; (3) the retained openclaw_runtime build is green in the real target worktree, with no clean-copy exception or unowned file restoration.
  - The preflight identifies one canonical TaskLoop producer, one child session key derivation path, one spawn entrypoint, one child startup hook path, and one SEKB trajectory-capture adapter. If any is ambiguous, stop and revise this manifest before production code.
  - RED tests first demonstrate the missing task-loop handler, absent real phase producer, absent child-key handoff write-before-spawn, absent child-state recovery, absent terminal-only trajectory capture, and absent authorization regressions.
  - The TaskLoop producer reuses RuntimeTaskStatus and calls the existing task_phase_change runner exactly once per true transition. It neither fabricates transitions nor adds a second event bus.
  - taskLoopHandler produces system-managed task_state writes through ContextBlockSink/BlockStore. It does not directly access SQLite or use working-memory as task_state storage.
  - HandoffPack contains only objective, current_phase, recent_actions, and parent_session_id. The parent writes it for the child session key before spawn. extraSystemPrompt equals the fixed context_read instruction and contains no HandoffPack JSON, Block ids, transcript excerpt, or raw tool output.
  - Child before_agent_start restoration reads only the child session's current task_state. Direct-parent authorization validates requester, child HandoffPack parent_session_id, and queried target together; malformed, stale, arbitrary, and ancestor paths return no data and record rejection evidence.
  - Only done and failed phase transitions trigger one SEKB trajectory capture. Existing agent_end behavior remains singular and unchanged.
  - No sequential same-session handoff, Renderer/Main/Gateway transport change, new host API, new database/table, COMPASS activation, AgentMap/AST/CodeGraph change, P1 working-memory behavioral edit, or transcript write is introduced. A host-api contract change is forbidden unless a separately approved scope amendment proves a user-facing contract is required.
  - The final report distinguishes DCS correctness evidence from task-throughput or coding-uplift claims. It lists all commands and exit codes, RED/GREEN evidence, ownership/prohibition scans, direct-parent authorization results, untracked-file results, and independent review with Critical 0 / Important 0.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# DCS Stage 2 Implementation Gate

## Naming

This document uses **DCS Stage 2**. It is not the unrelated “P2” of the
multi-agent orchestration/runbook program, and it is not DCS `[P2]` entity-map
query filtering.

## Design Authority and Reading Order

Read, in order:

1. `AGENTS.md`
2. `team/dcs/dcs-v1.6-spec.md`, especially Chapters 1, 4, 5, and 9
3. `team/dcs/dcs-v1.6-review.md`
4. `team/dcs/README.md`
5. `team/architecture-audit-full.md`
6. `harness/specs/scenarios/gateway-backend-communication.md`
7. every rule listed in this manifest
8. `harness/specs/layers/openclaw-runtime.md`
9. the accepted final reports and diffs for DCS Stage 1 and Coding Runtime P0

This manifest is an execution and evidence contract. It is not a parallel DCS
design source. If it conflicts with the v1.6 specification or final review,
stop and amend this manifest before implementation.

## Hard Readiness Gate

Do not edit production code merely because this manifest validates. Record a
short readiness report first. It must link the three accepted prerequisites
listed in `acceptance`, record the real-worktree Runtime build result, and name
the canonical producer/spawn/startup/SEKB paths. A blocked or partial P1,
Coding Runtime P0, or Runtime build makes this task ineligible to start.

## Data and Ownership Contract

- `task_phase_change` produces task_state; `tool_result` continues to produce
  working_memory. Do not merge their handlers or event meanings.
- Handoff recent actions are read-only facts from the persisted, accepted
  working-memory window. They are not a second rolling window.
- `BlockStore` owns persistence, transactionality, and authorization. No
  handler, TaskLoop, or spawn helper writes SQL directly.
- The parent writes the child-owned Block before spawn. The child reads itself
  during `before_agent_start`; it does not receive state through prompt text.
- Direct-parent access is authorization, not convenience: self, direct parent,
  arbitrary target, and ancestor must remain separately tested behaviors.

## Mandatory Negative Tests

- No actual TaskLoop transition means no task_phase_change invocation.
- A task_state write rejection does not fabricate an accepted handoff or spawn
  a child with stale state.
- A malformed, expired, or unrelated HandoffPack grants no parent access.
- `extraSystemPrompt` contains the fixed read instruction only.
- A non-terminal phase never invokes trajectory capture; one terminal phase
  does not duplicate agent_end.
- Disabled/unconfigured paths do not construct an accidental new state store,
  query arbitrary sessions, or alter existing prompts/transcripts.

## Completion Sequence

1. Record readiness and pass Harness context/validation.
2. Add and run every RED test with expected non-zero evidence.
3. Implement the smallest vertical behavior, then turn focused tests GREEN.
4. Run authorization, prompt-leak, duplicate-event, ownership, forbidden-import,
   transcript, and untracked-file scans.
5. Run every required gate and record exit codes.
6. Obtain independent review with no Critical or Important finding.
7. Only then update `team/dcs/README.md` and publish a COMPLETE report.
