---
id: dcs-stage2-handoff-boundary
title: DCS Stage 2 Task State and Handoff Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# DCS Stage 2 Task State and Handoff Boundary

## Authority

`team/dcs/dcs-v1.6-spec.md` and its final review are the only DCS design
authority. A task manifest, implementation plan, or agent prompt may narrow
execution scope and acceptance evidence, but may not redefine `HandoffPack`,
cross-session authorization, hook ownership, or phase status semantics.

## Required Ownership

- The real TaskLoop phase producer is the only source of `task_phase_change`.
  Reuse `RuntimeTaskStatus`; do not add a DCS-private status enum.
- `taskLoopHandler` converts a phase event into a system-managed `task_state`
  write. It does not access SQLite directly, format prompts, or create a
  second state store.
- `BlockStore` remains the only persistence and cross-session authorization
  owner. The default query scope is the requester session.
- The parent handoff path writes one `task_state` Block for the child session
  key before spawning the child. The spawn path receives only the fixed
  `context_read('task_state')` instruction.
- The child `before_agent_start` path reads only its own current `task_state`
  Block and restores the validated HandoffPack through existing context
  mechanisms.
- SEKB trajectory capture is triggered only from the Stage 2 terminal phase
  path (`done` or `failed`) and does not add or duplicate `agent_end`.

## Handoff Contract

- `HandoffPack` contains exactly `objective`, `current_phase`,
  `recent_actions`, and `parent_session_id`.
- `objective` is at most 2000 characters; `recent_actions` contains at most
  five high/medium entries; each `result_summary` is at most 100 characters.
- `recent_actions` comes only from accepted, persisted working-memory facts.
  It must not be reconstructed from transcripts, raw tool output, prompt text,
  or tool-name heuristics.
- A child can read its own Blocks. It can read only the direct parent named by
  its own current, valid HandoffPack. Arbitrary-session and recursive-ancestor
  reads return no Block and increment authorization observability.

## Prohibitions

- Do not put HandoffPack JSON, a task-state JSON object, a Block id list, or
  hidden state in `extraSystemPrompt`.
- Do not implement sequential same-session handoff, a new event bus, a new
  session classifier, a second context engine, a second state database, or
  direct SQLite DDL outside BlockStore schema ownership.
- Do not modify Stage 1 working-memory merge/eviction behavior, COMPASS,
  AgentMap, AST, CodeGraph, Renderer/Main/Gateway transport, or transcript
  persistence as part of Stage 2.
- Do not treat a Task Ledger, orchestration graph, scheduler record, or
  handoff-artifact prompt fragment as authoritative DCS `task_state` without a
  separately approved adapter contract.
- Do not use skips, synthetic completion evidence, build-gate reduction, or
  direct prompt injection to make the acceptance path appear green.

## Required Evidence

- TDD records each new behavior as RED before production implementation.
- Tests cover self, direct parent, arbitrary target, and recursive ancestor
  access; malformed or stale HandoffPack never authorizes a parent read.
- Tests prove child-state write completes before spawn, the fixed prompt has no
  serialized handoff, and child startup restores only its own state.
- Tests prove a terminal phase creates exactly one SEKB trajectory capture and
  no duplicate `agent_end` path.
- The final report lists every gate and exit code, a direct ownership scan, an
  untracked-file scan, and independent review results with Critical 0 and
  Important 0.
