---
id: context-runtime-kit-phase-0
title: Context Runtime Kit Phase 0 Specification and Harness Entry Point
scenario: context-runtime-kit
taskType: harness-spec
intent: Freeze the Context Runtime Kit protocol and harness entry point before any runtime compiler, router, verifier, prompt, or tool-call behavior changes.
ownedPaths:
  - harness/specs/tasks/context-runtime-kit.md
  - harness/specs/rules/context-runtime-kit-boundary.md
  - harness/specs/scenarios/context-runtime-kit.md
  - docs/context-runtime-kit/**
touchedAreas:
  - harness/specs/tasks/context-runtime-kit.md
  - harness/specs/rules/context-runtime-kit-boundary.md
  - harness/specs/scenarios/context-runtime-kit.md
expectedUserBehavior:
  - Phase 0 is invisible to end users because it creates harness specifications only.
  - Existing runtime prompts, tool calls, approvals, retries, compaction behavior, host-api contracts, renderer UI, and storage remain unchanged.
requiredRules:
  - context-runtime-kit-boundary
  - workspace-harness-single-source
  - chat-loop-boundary
forbiddenPatterns:
  - CVK compiler implementation
  - selector resolver implementation
  - context router implementation
  - verifier implementation
  - CompressionArtifact type changes
  - host-api contract changes
  - renderer or UI changes
  - database or index implementation
  - prompt assembly changes
  - tool call behavior changes
  - parallel durable source of truth such as .trellis
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-runtime-kit.md
  - pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
acceptance:
  - The task spec, scenario spec, and boundary rule exist under `harness/specs/**`.
  - Phase 0 states that runtime behavior is unchanged.
  - The hard rules cover navigation-only projections, hard-claim evidence refs, tool-selector expansion, compact boundaries, shadow-first rollout, no parallel durable truth, and non-replacement of existing state owners.
  - Phase 1 acceptance is clear enough for the next agent to start type-only `ResourceId`, `Selector`, `Chunk`, and `EvidenceRef` work.
  - The required harness context and validate commands pass, or any failure is explained without modifying runtime code.
docs:
  required: false
  note: Phase 0 is itself a harness documentation change. README translations are not required because no user-visible behavior, runtime flow, public interface, or architecture implementation changes.
  phaseControlPack:
    - docs/context-runtime-kit/README.md
    - docs/context-runtime-kit/goal-mode-development-protocol.md
    - docs/context-runtime-kit/acceptance-and-test-matrix.md
    - docs/context-runtime-kit/goal-mode-start-prompt.md
    - docs/context-runtime-kit/phase-constraints/phase-00-spec-and-harness.md
---

# Context Runtime Kit Phase 0

This task is the durable harness entry point for Context Runtime Kit. Phase 0 freezes the minimum protocol and validation reading list before implementation begins. It explicitly does not change runtime behavior.

## Background and Goal

Long-running local agents need context that is smaller, recoverable, and verifiable. Current Verse Claw boundaries already split long-task truth across Task Ledger, execution state across ClawGraph, run evidence across Observability, reusable knowledge across Memory and Knowledge, dynamic recovery state across `CompressionArtifact v1` and Resume Checkpoint, and bounded injection across `LoopContextPack` / Context Pack.

Context Runtime Kit adds a protocol for addressable persistent context: resources, selectors, chunks, checksums, views, and evidence references. The goal is to make future hard claims and tool-schema constraints cite exact evidence while keeping prompt text a per-turn projection rather than a durable context store.

Phase 0 creates only the task, scenario, and rule entry points under `harness/specs/**` so later phases can start from a stable contract.

## Goal-Mode Control Pack

Long-task or goal-mode development must read the control pack before implementation:

- `docs/context-runtime-kit/README.md`
- `docs/context-runtime-kit/goal-mode-development-protocol.md`
- `docs/context-runtime-kit/acceptance-and-test-matrix.md`
- `docs/context-runtime-kit/goal-mode-start-prompt.md`
- the active phase file under `docs/context-runtime-kit/phase-constraints/`

Each goal-mode run owns one phase only. The active phase constraint file is binding. If a worker needs to cross a phase boundary, it must stop and ask for a new goal rather than silently widening scope.

The control pack exists so long tasks read durable constraints instead of inventing phase rules from conversation memory.

## Non-Goals

- Do not implement the CVK compiler.
- Do not implement a selector resolver.
- Do not implement a Context Router.
- Do not implement a Verifier.
- Do not modify `CompressionArtifact` types or serialization.
- Do not modify `shared/host-api/contract.ts`.
- Do not modify renderer/UI code.
- Do not add a database, local index, or `.cvk/` artifact store.
- Do not change prompt assembly, runtime prompt text, tool-call behavior, approvals, retries, errors, or return payloads.
- Do not replace Task Ledger, ClawGraph, Observability, Memory, Knowledge, `CompressionArtifact v1`, `LoopContextPack`, Context Pack, or existing compaction.
- Do not create a parallel durable source of truth such as `.trellis/`.

## Existing System Entry Points

- `harness/specs/**`: durable AI coding policy, scenarios, rules, tasks, guides, and layer specs.
- `docs/superpowers/plans/2026-07-06-context-runtime-kit.md`: implementation roadmap and context model for P0-P10.
- `docs/clawx-design-overview.md`: long-conversation ownership boundaries, manual compaction, Task Ledger, ClawGraph, Observability, Context Pack, and `LoopContextPack`.
- `docs/enhancements/05-adaptive-context-budget.md`: shadow-first context budget design, no-schema-change rollout, and disable-only rollback pattern.
- `openclaw_runtime/src/context-engine/**`: existing context-engine contracts, provider registry, and shadow provider seams.
- `openclaw_runtime/packages/agent-core/src/harness/compaction/**`: production compaction planner and `CompressionArtifact v1`.
- `openclaw_runtime/src/memory/context-pack.ts`: role-aware Context Pack injection surface.
- `openclaw_runtime/src/agents/loop-context-pack.ts`: sole `/loop` recovery context builder.
- `shared/host-api/contract.ts`: existing typed bridge contracts for future read-only surfaces when a later phase needs them.
- `scripts/context-compression-eval-runner.mjs`: existing compression/recovery evaluation runner.
- `tests/unit/context-compression-eval.test.ts`: existing compression evaluation regression shape.

## Protocol Boundaries

Context Runtime Kit separates three layers:

1. Persistent truth: addressable resources, chunks, selectors, checksums, and source spans.
2. Dynamic state: compact recovery state, blockers, decisions, failed attempts, next action, uncertainty, and evidence refs.
3. Prompt projection: the per-turn assembled view of only the context needed for the next action.

Summary text, compact views, and compact projections are never hard fact sources. They navigate to or recover from context. A hard claim must cite `resource_id`, `selector`, and `checksum`.

Tool calls have a stricter hard-selector requirement: before a call is valid under future Context Runtime Kit gates, selectors for required fields, enum values, field types, default values, nullable semantics, permission notes, and side-effect notes must be expanded.

Compact and `CompressionArtifact` may carry evidence refs and dynamic state. They must not absorb large durable facts, project rules, tool schemas, docs, code chunks, memory, or task truth as unverified prose.

## Phase Summary P0-P10

- P0 Specification and Harness Entry Point: create task, scenario, and rule specs; keep runtime behavior unchanged.
- P1 Protocol Types and Artifact Shape: add type-only contracts for `ResourceId`, `Selector`, `Chunk`, `CompactView`, `EvidenceRef`, retrieval traces, prompt bundles, and verification results; no prompt or tool behavior changes.
- P2 Toolset, Skill, and Project Rule Compiler: compile deterministic sources into resources, chunks, selectors, checksums, views, and build reports for fixture coverage only.
- P3 Selector Resolver and Checksum Verifier: resolve `resource_id + selector` to chunks and fail closed on missing, stale, ambiguous, or checksum-mismatched refs.
- P4 View Generator and Lazy Exposure: generate registry and compact views that are navigation-only and carry must-expand selectors.
- P5 Context Router Shadow Provider: emit resource maps, compact views, budget reports, and retrieval plans as shadow diagnostics while legacy prompt text stays authoritative.
- P6 Tool Call Gate: report-only first, then gated only after a follow-up spec proves required selector expansion and rollback.
- P7 CompressionArtifact Integration: add evidence/ref fields only after compatibility proof; preserve existing consumers and reject large durable fact absorption.
- P8 Recovery Context Integration: recover from compact state plus selectors, with visible stale or missing refs instead of transcript replay assumptions.
- P9 Codebase Index MVP: add deterministic file, line-range, symbol, and related-test selectors with stability and staleness checks.
- P10 Evaluation and Reporting: produce fixture and replay reports for tool schema, skill routing, project rules, code selectors, compact recovery, and token savings.

## Phase 0 Acceptance

- `harness/specs/tasks/context-runtime-kit.md` exists and is the durable task entry point.
- A minimal scenario or rule spec exists so harness context loads the hard boundaries.
- `pnpm harness context --spec harness/specs/tasks/context-runtime-kit.md` returns the task, scenario, required rules, and harness layer in its read order.
- `pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md` passes.
- The spec states that Phase 0 does not change runtime prompt behavior, tool execution behavior, compaction behavior, host-api contracts, renderer UI, storage, or indexes.
- The spec forbids implementing CVK compiler, selector resolver, router, verifier, database/index, prompt assembly, tool-call behavior, and `CompressionArtifact` changes in this phase.

## Phase 1 Acceptance

Phase 1 starts only after Phase 0 validation passes. Its scope is type-only contract work.

- Add stable types for `ResourceId`, `Selector`, `Chunk`, `CompactView`, `CvkEvidenceRef` or equivalent `EvidenceRef`, `RetrievalTraceEntry`, `PromptBundle`, and `VerificationResult`.
- Validate JSON serialization and deserialization for these contracts with pure unit tests.
- Reject invalid resource ids, selectors, checksums, chunk ranges, and evidence refs with explicit errors.
- Prove no runtime prompt text changes, no tool-call behavior changes, no host-api contract changes unless a narrower follow-up spec explicitly authorizes read-only exposure, and no `CompressionArtifact` schema changes.
- Provide fixture examples for hard claims that require `resource_id + selector + checksum`.
- Provide fixture examples for tool schema selector families: required, enum, type, default, nullable, permission, and side-effect.

## Validation Commands

Run these for Phase 0:

```powershell
pnpm harness context --spec harness/specs/tasks/context-runtime-kit.md
pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
```

Phase 1 should add targeted pure unit tests for the new contracts and continue to run the two Phase 0 commands. Runtime, host-api, renderer, comms, E2E, or compaction gates are required only when a later task spec actually touches those paths.

## Rollback and Gradual Rollout

Phase 0 rollback is file-level only: revert the three harness spec files created for this entry point. No migration or data cleanup is required because no runtime state is written.

All later phases must follow the shadow-first pattern:

- Off or absent flags preserve legacy behavior.
- Shadow mode records diagnostics only.
- Report-only gates may emit would-block results but must not block execution.
- Pilot or active behavior requires a follow-up task spec, flag-off parity, metrics, rollback, and targeted tests.
- Rollback must be disable-only whenever possible. Existing Context Pack, `LoopContextPack`, compaction, Task Ledger, ClawGraph, Observability, Memory, and Knowledge behavior must remain available.

## Metrics Summary

- SC, Source Coverage: covered source spans divided by eligible source spans. Persistent source compilation fails if eligible hard-constraint spans are uncovered.
- SS, Selector Stability: selectors unchanged across identical input builds. Stable selectors are required before evidence refs can survive compaction and recovery.
- AR, Artifact Reproducibility: identical artifact hashes across repeated builds from identical inputs.
- RRR, Reference Resolution Rate: resolvable refs divided by total refs. Missing, stale, or ambiguous refs fail closed.
- HCR, Hard Constraint Recall: correctly used hard constraints divided by required hard constraints. HCR takes priority over token savings.
- ERR, Evidence Retention Rate: required evidence refs preserved after compaction or projection divided by required refs before compaction.
- RFS, Recovery Fidelity Score: recovery tasks resumed correctly after transcript removal, including next action, blockers, failed attempts, uncertainty, and evidence refs.
- TSR, Token Saving Rate: `1 - T_cvk / T_baseline`. TSR is useful only when SC, SS, AR, RRR, HCR, ERR, and RFS remain within acceptance thresholds.

Priority rule: saving tokens by losing evidence is a failed result.

## Phase 0 Runtime Behavior Statement

This phase changes no runtime behavior. It only creates harness specifications. The current prompt assembly path, compaction path, tool execution path, approval path, host-api contract, renderer UI, storage layout, Task Ledger behavior, ClawGraph behavior, Observability behavior, Memory behavior, Knowledge behavior, `CompressionArtifact v1`, and `LoopContextPack` remain unchanged.
