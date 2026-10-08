---
id: dcs-stage3-tool-registry
title: DCS Stage 3 tool_registry Block producer and Assembler injection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the DCS v1.6 Stage 3 tool_registry Block producer (cvkHandler) and Assembler pre_llm_call injection only after the stated readiness gates prove that Stage 1, Stage 2, Coding Runtime P0, and the retained Runtime build baseline are accepted.
touchedAreas:
  - harness/specs/tasks/dcs-stage3-tool-registry.md
  - harness/specs/rules/dcs-stage3-tool-registry-boundary.md
  - team/dcs/dcs-v1.6-spec.md
  - team/dcs/dcs-v1.6-review.md
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/assembler.test.ts
  - openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts
  - openclaw_runtime/src/context-engine/handlers/tool-registry-handler.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts
  - openclaw_runtime/src/config/runtime-context-block-working-memory.test.ts
  - package.json
  - team/dcs/README.md
expectedUserBehavior:
  - A before_agent_start hook produces one system-managed tool_registry Block through ContextBlockSink when the feature flag is on. The Block carries always_on=true, token_budget=200, priority=7, on_demand.expand_tool=context_read, on_demand.auto_register=true.
  - The Assembler injects the tool_registry summary into the pre_llm_call output when the feature flag is on, following the same flag-guard + exactly-once pattern as working_memory.
  - When the feature flag is off (default), no Block is produced, no injection occurs, and the existing CVK path runs unchanged.
  - The tool_registry Block's full_content contains structured tool entries (resourceId, kind, title, purpose, category). The summary follows the spec format "## Tools ({count} available) ... -> context_read('tool_registry') for full schema".
  - Existing working_memory, task_state, handoff, COMPASS, AgentMap, AST, CodeGraph, and transport behavior remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - docs-sync
  - dcs-stage3-tool-registry-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/dcs-stage3-tool-registry.md
  - pnpm harness validate --spec harness/specs/tasks/dcs-stage3-tool-registry.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/assembler.test.ts src/context-engine/handlers/tool-registry-handler.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/embedded-agent-runner/extensions.tool-registry.test.ts
  - pnpm run typecheck
  - pnpm run lint:dcs
  - pnpm run test:dcs
  - pnpm run harness:ci
  - pnpm harness run --spec harness/specs/tasks/dcs-stage3-tool-registry.md --since e00ee941e --dry-run
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm --dir openclaw_runtime build
  - git diff --check
acceptance:
  - Before production edits, a readiness report proves: (1) DCS Stage 1 has a final COMPLETE report; (2) Coding Runtime P0 has a final COMPLETE report; (3) DCS Stage 2 has a final COMPLETE report; (4) the retained openclaw_runtime build is green.
  - The preflight identifies one canonical cvkHandler producer path (before_agent_start -> handleBeforeAgentStartToolRegistry -> ContextBlockSink) and one Assembler injection path (#appendToolRegistry on pre_llm_call).
  - RED tests first demonstrate the missing tool-registry handler, absent Block producer, absent Assembler injection, and absent feature flag.
  - The cvkHandler produces system-managed tool_registry writes through ContextBlockSink/BlockStore. It does not directly access SQLite or duplicate the existing CVK systemPromptAddition path.
  - The Assembler's #appendToolRegistry follows the same flag-guard + exactly-once + BlockStore-query pattern as #appendWorkingMemory. It queries block_types=["tool_registry"], source_systems=["cvk"], limit=1.
  - The tool_registry Block has always_on=true, token_budget=200, priority=7, on_demand={expand_tool:"context_read", auto_register:true}, mutability="system_managed". The summary follows the spec format. The full_content contains structured tool entries JSON.
  - The feature flag runtime.contextBlock.tool-registry.enabled defaults to false. When off, no Block is produced, no injection occurs, and existing behavior is unchanged.
  - No COMPASS activation, knowledge/experience/environment Block production, AgentMap/AST/CodeGraph change, Renderer/Main/Gateway transport change, new host API, new database/table, Stage 1/2 behavioral edit, or transcript write is introduced.
  - The final report distinguishes DCS correctness evidence from tool-throughput or coding-uplift claims. It lists all commands and exit codes, RED/GREEN evidence, ownership/prohibition scans, untracked-file results, and independent review with Critical 0 / Important 0.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# DCS Stage 3 Implementation Gate

## Naming

This document uses **DCS Stage 3**. It is not the unrelated "phase-3 provider-tool-registry" program, and it is not DCS `[P3]` SEKB distillation.

## Design Authority and Reading Order

Read, in order:

1. `AGENTS.md`
2. `team/dcs/dcs-v1.6-spec.md`, especially Chapters 1, 3 (tool_registry Block), 4, and 9
3. `team/dcs/dcs-v1.6-review.md`
4. `team/dcs/README.md`
5. `harness/specs/scenarios/gateway-backend-communication.md`
6. every rule listed in this manifest
7. `harness/specs/layers/openclaw-runtime.md`
8. the accepted final reports and diffs for DCS Stage 1, Coding Runtime P0, and DCS Stage 2

This manifest is an execution and evidence contract. It is not a parallel DCS
design source. If it conflicts with the v1.6 specification or final review,
stop and amend this manifest before implementation.

## Hard Readiness Gate

Do not edit production code merely because this manifest validates. Record a
short readiness report first. It must link the three accepted prerequisites
listed in `acceptance`, record the real-worktree Runtime build result, and name
the canonical cvkHandler/injection paths. A blocked or partial Stage 1, Stage 2,
Coding Runtime P0, or Runtime build makes this task ineligible to start.

## Data and Ownership Contract

- `before_agent_start` produces tool_registry; `tool_result` continues to produce
  working_memory; `task_phase_change` continues to produce task_state. Do not
  merge their handlers or event meanings.
- The cvkHandler converts a tool-registry snapshot (provided by the factory
  closure) into a system-managed tool_registry Block write. It does not access
  SQLite directly, format prompts, or create a second tool registry.
- `BlockStore` remains the only persistence and authorization owner.
- The Assembler's `#appendToolRegistry` queries BlockStore with
  `block_types=["tool_registry"]`, `source_systems=["cvk"]`, `limit=1` and
  injects the summary when the feature flag is on. It follows the same
  exactly-once guard pattern as `#appendWorkingMemory`.
- The existing CVK `ContextRuntimeKitContextEngine.assemble` path runs
  unchanged. The Stage 3 Block path is a parallel, flag-gated path. When both
  are on, the Block injection is additive (documented as a pilot limitation).

## Mandatory Negative Tests

- No before_agent_start hook means no tool_registry Block write.
- A tool_registry write rejection does not fabricate an accepted injection.
- A malformed or empty tool_registry Block produces no injection.
- `#appendToolRegistry` does not duplicate the `## Tools` heading when a prior
  injection point already projected it (exactly-once).
- Disabled/unconfigured paths do not construct an accidental new tool registry,
  query arbitrary sessions, or alter existing prompts/transcripts.

## Completion Sequence

1. Record readiness and pass Harness context/validation.
2. Add and run every RED test with expected non-zero evidence.
3. Implement the smallest vertical behavior, then turn focused tests GREEN.
4. Run flag-guard, exactly-once, ownership, forbidden-import, transcript, and
   untracked-file scans.
5. Run every required gate and record exit codes.
6. Obtain independent review with no Critical or Important finding.
7. Only then update `team/dcs/README.md` and publish a COMPLETE report.
