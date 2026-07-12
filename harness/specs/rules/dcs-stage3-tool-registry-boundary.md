---
id: dcs-stage3-tool-registry-boundary
title: DCS Stage 3 Tool Registry Block Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# DCS Stage 3 Tool Registry Block Boundary

## Authority

`team/dcs/dcs-v1.6-spec.md` and its final review are the only DCS design
authority. A task manifest, implementation plan, or agent prompt may narrow
execution scope and acceptance evidence, but may not redefine the tool_registry
Block contract, feature flag naming, hook ownership, or Assembler injection
semantics.

## Required Ownership

- The `before_agent_start` hook is the only source of `tool_registry` Block
  production. The handler (`handleBeforeAgentStartToolRegistry`) converts a
  tool-registry snapshot into a system-managed Block write through
  `ContextBlockSink`.
- `BlockStore` remains the only persistence and authorization owner. The
  default query scope is the requester session.
- The Assembler's `#appendToolRegistry` is the only pre_llm_call injection path
  for tool_registry. It follows the same flag-guard + exactly-once + query
  pattern as `#appendWorkingMemory`.
- The existing CVK `ContextRuntimeKitContextEngine.assemble` path is unchanged.
  The Stage 3 Block path is a parallel, flag-gated path, default off.
- The feature flag is `runtime.contextBlock.tool-registry.enabled` (kebab in
  config) mapped to `runtime.contextBlock.tool_registry.enabled` (snake in
  Assembler flag keys) via `contextBlockFlagNameForSourceSystem("cvk")`.

## Tool Registry Block Contract

- `block_type = "tool_registry"`, `source_system = "cvk"`,
  `mutability = "system_managed"`.
- `presence.always_on = true`, `presence.token_budget = 200`,
  `presence.priority = 7`,
  `presence.on_demand = { expand_tool: "context_read", auto_register: true }`.
- `full_content` contains structured tool entries JSON:
  `{ entries: Array<{ resourceId, kind, title, purpose, category? }> }`.
- `summary` follows the format:
  `## Tools ({count} available)\n→ context_read('tool_registry') for full schema`.
- `compression_depth = 0` (structured extraction, not lossy summary).
- `entity_extraction_status = "empty"` (no entity extraction for tool entries).

## Prohibitions

- Do not replace or modify the existing CVK `ContextRuntimeKitContextEngine`
  path, `formatPromptAddition`, or `generateCvkViews` as part of Stage 3.
- Do not implement COMPASS, knowledge, experience, or environment Block
  production. Only tool_registry is in scope.
- Do not modify Stage 1 working-memory merge/eviction behavior, Stage 2
  task_state/handoff behavior, or SEKB trajectory capture.
- Do not introduce a new event bus, session classifier, context engine, state
  database, or direct SQLite DDL outside BlockStore schema ownership.
- Do not modify Renderer/Main/Gateway transport, host-api contract, or
  transcript persistence as part of Stage 3.
- Do not use skips, synthetic completion evidence, build-gate reduction, or
  direct prompt injection to make the acceptance path appear green.

## Required Evidence

- TDD records each new behavior as RED before production implementation.
- Tests cover Block construction (all presence fields), sink write, injection
  formatting, flag-off no-op, exactly-once guard, and factory wiring.
- Tests prove the feature flag defaults to false and the existing CVK path is
  unchanged when the flag is off.
- The final report lists every gate and exit code, a direct ownership scan, an
  untracked-file scan, and independent review results with Critical 0 and
  Important 0.
