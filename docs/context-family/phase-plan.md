# Context Family Three-Phase Plan

This plan groups the fine-grained task slices into three Goal-sized development phases. Each phase can run as one long Goal, but it must still respect the internal slice boundaries and record a checkpoint after each slice.

## Phase 1: Foundation and Registry

Slices:

- Slice 1: `context-family-protocol-types`
- Slice 2: `context-item-registry-shadow`
- Slice 3: `context-family-shadow-ingestion`

Purpose:

Build the shared ContextItem protocol, the metadata-only Registry, and shadow ingestion adapters. At the end of this phase, existing runtime inputs can be represented as ContextItems in shadow mode, but runtime behavior remains unchanged.

Primary specs:

- `harness/specs/tasks/context-family-protocol-types.md`
- `harness/specs/tasks/context-item-registry-shadow.md`
- `harness/specs/tasks/context-family-shadow-ingestion.md`

Required reading:

- `docs/context-family/goal-runbook.md`
- `docs/context-family/task-slices.md`
- `docs/context-family/glossary.md`
- `docs/context-family/axioms.md`
- `docs/context-family/goal-progress.md`
- `harness/specs/scenarios/context-family.md`
- `harness/specs/rules/context-family-boundary.md`
- `harness/specs/rules/context-runtime-kit-boundary.md`
- `shared/types/context-runtime-kit.ts`
- The harness context output for each active spec.

Allowed scope:

- Additive shared types and pure helpers.
- Metadata-only Registry implementation.
- Shadow-only registration at selected runtime input points.
- Unit tests and docs updates.

Forbidden scope:

- Prompt behavior changes.
- Gateway or Host API changes.
- Renderer UI changes.
- Database authority changes beyond the explicitly approved metadata-only Registry store.
- Large payload storage in Registry.
- Archive, masking, recall, or policy promotion.

Phase 1 acceptance:

- All three specs validate with `corepack pnpm harness validate`.
- Required tests from each spec pass.
- Flag-off or shadow behavior does not change prompt text, transcript semantics, tool execution, compaction output, or UI.
- `docs/context-family/goal-progress.md` contains a checkpoint and handoff packet for each slice.

## Phase 2: Lifecycle, Archive, and Status

Slices:

- Slice 4: `context-lifecycle-event-audit`
- Slice 5: `context-lossless-archive-mvp`
- Slice 6: `context-status-projection-shadow`

Purpose:

Make context transformations auditable, add the first checksum-backed ArchiveHandle substrate, and generate a bounded Context Status projection under a flag. At the end of this phase, the system can explain truncation/compaction transitions, preserve original payload references before lossy operations, and expose bounded self-awareness without default prompt changes.

Primary specs:

- `harness/specs/tasks/context-lifecycle-event-audit.md`
- `harness/specs/tasks/context-lossless-archive-mvp.md`
- `harness/specs/tasks/context-status-projection-shadow.md`

Required reading:

- All Phase 1 outputs.
- `reports/agent-context-guidance-queue-current-state.md`
- `harness/specs/tasks/token-dense-recovery-compression-v1.md`
- `harness/specs/tasks/chat-session-handoff-mvp.md`
- `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`
- `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts`
- The harness context output for each active spec.

Allowed scope:

- Lifecycle event recording for existing transformations.
- ArchiveHandle creation before truncation and compaction.
- Checksum verification and cleanup semantics for archive artifacts.
- Flag-gated bounded Context Status projection.
- Tests and docs updates.

Forbidden scope:

- Changing route decisions.
- Changing truncation or compaction semantics.
- Treating checkpoints as lossless archives.
- Observation masking.
- Read-only recall surfaces.
- Default prompt changes.
- UI exposure beyond what the active spec explicitly requires.

Phase 2 acceptance:

- Lifecycle events exist for truncation, routing, compaction, and checkpoints.
- Archive handles verify checksums and fail closed.
- Deletion cleanup semantics cover archive artifacts.
- Context Status flag off has prompt parity.
- Context Status flag on is bounded and does not include large payloads.
- `docs/context-family/goal-progress.md` includes examples of lifecycle events, archive handles, status output shape, and validation results.

## Phase 3: Masking, Recall, and Promotion

Slices:

- Slice 7: `context-observation-masking-projection`
- Slice 8: `context-readonly-recall-surface`
- Slice 9: `context-family-policy-promotion`

Purpose:

Use the ArchiveHandle substrate to add projection-only observation masking, expose read-only recall through proper boundaries, and promote only proven behavior. At the end of this phase, Context Family can reduce prompt pressure through recallable projections and promote stable pieces with metrics and rollback.

Primary specs:

- `harness/specs/tasks/context-observation-masking-projection.md`
- `harness/specs/tasks/context-readonly-recall-surface.md`
- `harness/specs/tasks/context-family-policy-promotion.md`

Required reading:

- All Phase 1 and Phase 2 outputs.
- `harness/specs/tasks/chat-session-handoff-mvp.md`
- `harness/specs/tasks/chat-session-runtime-fork.md`
- `harness/specs/tasks/token-dense-recovery-compression-v1.md`
- `harness/specs/tasks/context-runtime-kit-default-on.md`
- `electron/services/sessions-api.ts`
- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- The harness context output for each active spec.

Allowed scope:

- Projection-only masking for archived observations.
- Read-only recall and selector expansion through runtime/Main/Host API boundaries.
- Handoff integration with read-only recovery output.
- Explicit policy promotion with flags, rollback, metrics, and tests.

Forbidden scope:

- Transcript rewrite masking in the first masking version.
- Masking without ArchiveHandles.
- Masking instructions or user intent automatically.
- Renderer direct transcript/archive reads.
- Recall mutation.
- Memory/Knowledge/Task Ledger writes through recall.
- Active tool-call blocking unless a narrower promotion spec authorizes it.
- Bundled promotion without evidence.

Phase 3 acceptance:

- Masked prompt snapshots preserve tool-call structure and include recall handles.
- Read-only recall verifies checksums and reports stale/missing/ambiguous selector diagnostics.
- Handoff can use recovery output and still fallback safely.
- Promoted behavior has flag-off parity, rollback, metrics, docs, and required tests.
- Comms replay/compare runs when communication paths change.
