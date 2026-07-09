# Context Family Goal Prompts

Use these prompts as Goal objectives. Each prompt intentionally names boundaries, reading material, outputs, and validation so a fresh long-running session can start without relying on chat history.

## Phase 1 Goal: Foundation and Registry

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Phase 1: Foundation and Registry.

This phase covers exactly these slices:
1. Slice 1: harness/specs/tasks/context-family-protocol-types.md
2. Slice 2: harness/specs/tasks/context-item-registry-shadow.md
3. Slice 3: harness/specs/tasks/context-family-shadow-ingestion.md

Goal:
Add the shared ContextItem protocol, implement a metadata-only ContextItemRegistry in shadow mode, and register existing runtime inputs as ContextItems without changing runtime behavior. At the end of this phase, Context Family should have a typed language, a shadow registry, and shadow ingestion evidence, but prompts/tool execution/compaction/UI must remain behaviorally unchanged.

Required reading before coding:
- AGENTS.md
- docs/context-family/goal-runbook.md
- docs/context-family/phase-plan.md
- docs/context-family/task-slices.md
- docs/context-family/glossary.md
- docs/context-family/axioms.md
- docs/context-family/goal-progress.md
- harness/specs/scenarios/context-family.md
- harness/specs/rules/context-family-boundary.md
- harness/specs/rules/context-runtime-kit-boundary.md
- harness/specs/tasks/context-family-protocol-types.md
- harness/specs/tasks/context-item-registry-shadow.md
- harness/specs/tasks/context-family-shadow-ingestion.md
- shared/types/context-runtime-kit.ts
- reports/agent-context-guidance-queue-current-state.md

Required process:
For each slice, run corepack pnpm harness context --spec <slice-spec> before implementation, then read the returned context. Implement one slice at a time and update docs/context-family/goal-progress.md after each slice with objective, files touched, decisions, tests, validation gaps, risks, and next action.

Allowed scope:
- shared/types/context-item.ts
- shared/types/context-family.ts
- tests/unit/context-family-contracts.test.ts
- openclaw_runtime/src/context-engine/registry/**
- tests/unit/context-item-registry.test.ts
- focused shadow-ingestion touchpoints authorized by harness/specs/tasks/context-family-shadow-ingestion.md
- docs/context-family/**

Forbidden scope:
- No prompt text or prompt order changes.
- No Gateway or Host API changes.
- No renderer UI changes.
- No ArchiveHandle implementation.
- No observation masking.
- No recall surface.
- No policy promotion.
- No large payload storage in Registry.
- No CompressionArtifact schema/serialization changes.
- No replacement of Task Ledger, ClawGraph, Observability, Memory, Knowledge, transcript JSONL, LoopContextPack, Context Pack, or CompressionArtifact authority.

Validation:
- corepack pnpm harness validate --spec harness/specs/tasks/context-family-protocol-types.md
- corepack pnpm harness validate --spec harness/specs/tasks/context-item-registry-shadow.md
- corepack pnpm harness validate --spec harness/specs/tasks/context-family-shadow-ingestion.md
- Run every requiredTests command from the three active specs.
- git diff --check for all touched paths.

Acceptance:
- ContextItem shared types and pure helpers are additive and tested.
- Registry can register metadata-only items, append lifecycle events, query by session/kind/state, and produce status snapshots.
- Registry failures are non-fatal in shadow mode.
- Shadow ingestion records observations, instructions, user intents, reasoning, derived summaries, and ledger artifacts when available.
- Existing prompt output, transcript semantics, tool behavior, compaction output, Gateway/Host API, and renderer UI are unchanged.
- docs/context-family/goal-progress.md contains a handoff packet for Phase 1 and one checkpoint per slice.
```

## Phase 2 Goal: Lifecycle, Archive, and Status

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Phase 2: Lifecycle, Archive, and Status.

This phase covers exactly these slices:
1. Slice 4: harness/specs/tasks/context-lifecycle-event-audit.md
2. Slice 5: harness/specs/tasks/context-lossless-archive-mvp.md
3. Slice 6: harness/specs/tasks/context-status-projection-shadow.md

Goal:
Make context transformations auditable, add the first checksum-backed ArchiveHandle substrate, and expose a bounded flag-gated Context Status projection. At the end of this phase, truncation/routing/compaction/checkpoint transitions should be explainable, original payloads or message ranges should be addressable before lossy operations, and Context Status should be available under a flag with prompt parity when disabled.

Required reading before coding:
- AGENTS.md
- docs/context-family/goal-runbook.md
- docs/context-family/phase-plan.md
- docs/context-family/task-slices.md
- docs/context-family/glossary.md
- docs/context-family/axioms.md
- docs/context-family/goal-progress.md
- harness/specs/scenarios/context-family.md
- harness/specs/rules/context-family-boundary.md
- harness/specs/rules/context-runtime-kit-boundary.md
- harness/specs/tasks/context-lifecycle-event-audit.md
- harness/specs/tasks/context-lossless-archive-mvp.md
- harness/specs/tasks/context-status-projection-shadow.md
- harness/specs/tasks/token-dense-recovery-compression-v1.md
- harness/specs/tasks/chat-session-handoff-mvp.md
- reports/agent-context-guidance-queue-current-state.md
- openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts
- openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts
- openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
- openclaw_runtime/src/gateway/session-compaction-checkpoints.ts

Required process:
For each slice, run corepack pnpm harness context --spec <slice-spec> before implementation, then read the returned context. Implement one slice at a time. Update docs/context-family/goal-progress.md after lifecycle audit, after archive MVP, and after status projection.

Allowed scope:
- Lifecycle event recording for existing transformations.
- ArchiveHandle creation before tool-result truncation and compaction source replacement.
- Checksum verification and cleanup semantics for archive artifacts.
- Flag-gated bounded Context Status projection.
- Focused tests and docs updates authorized by each active spec.

Forbidden scope:
- No route decision changes.
- No truncation behavior changes beyond archive preparation and audit metadata.
- No compaction summary behavior changes beyond archive preparation and audit metadata.
- No treating checkpoints as lossless archives unless they point to verified ArchiveHandles.
- No observation masking.
- No read-only recall API/UI.
- No default prompt changes.
- No large payloads in Registry.
- No renderer direct transcript/archive reads.

Validation:
- corepack pnpm harness validate --spec harness/specs/tasks/context-lifecycle-event-audit.md
- corepack pnpm harness validate --spec harness/specs/tasks/context-lossless-archive-mvp.md
- corepack pnpm harness validate --spec harness/specs/tasks/context-status-projection-shadow.md
- Run every requiredTests command from the three active specs.
- Run comms validation when the active spec or changed paths touch communication behavior.
- git diff --check for all touched paths.

Acceptance:
- Tool-result truncation, preemptive routing, compaction, and checkpoint creation record lifecycle events.
- ArchiveHandles include checksum, source identity, and storage pointer or source range pointer.
- Checksum mismatch fails closed.
- Session hard delete cleans related archive artifacts.
- Context Status flag off preserves exact prompt parity.
- Context Status flag on is bounded, contains no large payloads, and reports lifecycle counts plus recovery availability.
- docs/context-family/goal-progress.md includes lifecycle event examples, archive handle examples, Context Status output shape, tests, risks, and a Phase 2 handoff packet.
```

## Phase 3 Goal: Masking, Recall, and Promotion

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Phase 3: Masking, Recall, and Promotion.

This phase covers exactly these slices:
1. Slice 7: harness/specs/tasks/context-observation-masking-projection.md
2. Slice 8: harness/specs/tasks/context-readonly-recall-surface.md
3. Slice 9: harness/specs/tasks/context-family-policy-promotion.md

Goal:
Use verified ArchiveHandles to add projection-only observation masking, expose read-only recall through proper runtime/Main/Host API boundaries, and promote only proven Context Family behavior with flags, rollback, metrics, and tests. At the end of this phase, old large observations can be replaced by recallable prompt placeholders, recovery can read original content or selector chunks safely, and any default behavior is justified by evidence.

Required reading before coding:
- AGENTS.md
- docs/context-family/goal-runbook.md
- docs/context-family/phase-plan.md
- docs/context-family/task-slices.md
- docs/context-family/glossary.md
- docs/context-family/axioms.md
- docs/context-family/goal-progress.md
- harness/specs/scenarios/context-family.md
- harness/specs/rules/context-family-boundary.md
- harness/specs/rules/context-runtime-kit-boundary.md
- harness/specs/tasks/context-observation-masking-projection.md
- harness/specs/tasks/context-readonly-recall-surface.md
- harness/specs/tasks/context-family-policy-promotion.md
- harness/specs/tasks/chat-session-handoff-mvp.md
- harness/specs/tasks/chat-session-runtime-fork.md
- harness/specs/tasks/token-dense-recovery-compression-v1.md
- harness/specs/tasks/context-runtime-kit-default-on.md
- electron/services/sessions-api.ts
- shared/host-api/contract.ts
- src/lib/host-api.ts
- prior Phase 1 and Phase 2 handoff packets in docs/context-family/goal-progress.md

Required process:
For each slice, run corepack pnpm harness context --spec <slice-spec> before implementation, then read the returned context. Implement masking before recall, and recall before promotion. Do not start promotion until masking and recall have validation evidence. Update docs/context-family/goal-progress.md after each slice.

Allowed scope:
- Projection-only masking for old archived observations.
- Read-only recall and selector expansion through runtime/Main/Host API boundaries.
- Handoff integration with read-only recovery output.
- Explicit behavior promotion only when rollback, metrics, parity, docs, and tests are present.

Forbidden scope:
- No transcript rewrite masking in the first masking version.
- No masking without ArchiveHandles.
- No automatic masking of instruction or user_intent items.
- No renderer direct transcript/archive reads.
- No recall mutation.
- No Memory, Knowledge, Task Ledger, transcript, workspace file, or prompt-state writes through recall.
- No active tool-call blocking unless a narrower promotion spec explicitly authorizes it.
- No bundled promotion without evidence.
- No removal of legacy fallback.

Validation:
- corepack pnpm harness validate --spec harness/specs/tasks/context-observation-masking-projection.md
- corepack pnpm harness validate --spec harness/specs/tasks/context-readonly-recall-surface.md
- corepack pnpm harness validate --spec harness/specs/tasks/context-family-policy-promotion.md
- Run every requiredTests command from the three active specs.
- Run pnpm run comms:replay and pnpm run comms:compare when communication paths change.
- Run docs sync checks when user-visible behavior changes.
- git diff --check for all touched paths.

Acceptance:
- Masking is projection-only, targets only archived observations, preserves tool-call structure, and includes item id or archive handle in placeholders.
- Read-only recall verifies checksums, fails closed, and reports stale/missing/ambiguous selector diagnostics.
- Renderer uses Host API only.
- Handoff can use recovery output and still fallback to checkpoint/transcript/ledger/git/trace sources.
- Any promoted default behavior has flag-off parity, rollback, metrics, tests, and docs.
- docs/context-family/goal-progress.md contains token savings evidence, recallability evidence, promotion metrics, rollback notes, and a Phase 3 handoff packet.
```

## Goal 0: Semantic Constitution

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 0: Semantic Constitution.

Read AGENTS.md, reports/agent-context-guidance-queue-current-state.md, docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-runtime-kit.md, harness/specs/tasks/context-runtime-kit-default-on.md, harness/specs/rules/context-runtime-kit-boundary.md, harness/specs/scenarios/context-runtime-kit.md, harness/specs/tasks/token-dense-recovery-compression-v1.md, harness/specs/tasks/chat-session-handoff-mvp.md, harness/specs/tasks/chat-session-runtime-fork.md, and docs/clawx-design-overview.md sections covering Long-Task Stability Stack, Fork, Handoff, and Recovery.

Create the Context Family semantic layer only: docs/context-family/glossary.md, docs/context-family/axioms.md, docs/context-family/goal-progress.md, harness/specs/scenarios/context-family.md, harness/specs/rules/context-family-boundary.md, and harness/specs/tasks/context-family-semantic-constitution.md.

Do not modify runtime behavior, shared protocol types, prompt assembly, Gateway, Host API, renderer, storage, CompressionArtifact schema, or tests outside the semantic constitution scope. Do not claim recoveryContext or compressionArtifact production closure unless code evidence proves it.

Run pnpm harness context --spec harness/specs/tasks/context-family-semantic-constitution.md, pnpm harness validate --spec harness/specs/tasks/context-family-semantic-constitution.md, and git diff --check for the touched paths. Update docs/context-family/goal-progress.md with a handoff packet.
```

## Goal 1: Protocol Types

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 1: Protocol Types from docs/context-family/task-slices.md.

Start by reading docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, docs/context-family/glossary.md, docs/context-family/axioms.md, harness/specs/scenarios/context-family.md, harness/specs/rules/context-family-boundary.md, harness/specs/tasks/context-family-protocol-types.md, and the harness context output for that spec.

Implement only additive shared types and pure validation helpers for ContextItem identity, kind, lifecycle, source refs, provenance, projection specs, archive handles, and status snapshots. Add focused unit tests. Do not register runtime items, create storage, alter prompts, alter Gateway/Host API, or change CompressionArtifact serialization.

Run pnpm harness context --spec harness/specs/tasks/context-family-protocol-types.md, pnpm harness validate --spec harness/specs/tasks/context-family-protocol-types.md, the targeted unit tests, typecheck if required by the spec, and git diff --check for touched paths. Update docs/context-family/goal-progress.md with a handoff packet.
```

## Goal 2: Registry Shadow

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 2: Registry Shadow from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, shared Context Family types, harness/specs/tasks/context-item-registry-shadow.md, and the harness context output.

Implement a metadata-only ContextItemRegistry in shadow mode. It may register items, append lifecycle events, and return status snapshots. It must not store large payloads, alter prompt assembly, alter tool execution, expose UI, or default runtime registration on. Failures must be non-fatal.

Run harness context/validate for the active spec, targeted registry unit tests, typecheck if required, and git diff --check. Update docs/context-family/goal-progress.md with decisions, validation, and a handoff packet.
```

## Goal 3: Shadow Ingestion

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 3: Shadow Ingestion from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-family-shadow-ingestion.md, and the harness context output.

Wire shadow-only registration for existing runtime inputs: tool results as observation, bootstrap/system prompt files as instruction, user messages as user_intent, assistant messages as reasoning, compaction summaries as derived, and CompressionArtifact records as ledger when available. Preserve current runtime behavior and prompt output. Registration failures must only emit bounded diagnostics.

Run harness context/validate, targeted tests from the spec, typecheck if required, and git diff --check. Update docs/context-family/goal-progress.md with item distribution evidence and a handoff packet.
```

## Goal 4: Lifecycle Audit

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 4: Lifecycle Audit from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-lifecycle-event-audit.md, and the harness context output.

Record lifecycle events for tool-result truncation, preemptive route decisions, runtime compaction, and compaction checkpoint creation. Do not change existing decisions, truncation behavior, compaction summaries, or checkpoint authority. Checkpoints remain recovery indexes, not lossless archives.

Run harness context/validate, targeted tests, typecheck if required, and git diff --check. Update docs/context-family/goal-progress.md with event examples and a handoff packet.
```

## Goal 5: Lossless Archive MVP

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 5: Lossless Archive MVP from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-lossless-archive-mvp.md, token-dense recovery compression spec, and the harness context output.

Implement checksum-backed ArchiveHandle creation before irreversible tool-result truncation and before compaction replaces source ranges. The Registry may store handles and metadata only, not large payloads. Respect hard delete cleanup semantics. Do not implement masking, recall UI, or production prompt changes in this Goal.

Run harness context/validate, targeted archive tests, typecheck if required, deletion cleanup tests required by the spec, and git diff --check. Update docs/context-family/goal-progress.md with handle examples and a handoff packet.
```

## Goal 6: Context Status Shadow

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 6: Context Status Shadow from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-status-projection-shadow.md, and the harness context output.

Generate a bounded [Context Status] projection from runtime-owned status and Registry snapshots under an explicit flag. Flag off must preserve exact prompt parity. Flag on may inject only small status, counts, pressure, warnings, and recovery availability. Do not inject payloads or make UI-only state authoritative.

Run harness context/validate, prompt parity tests, targeted status tests, typecheck if required, and git diff --check. Update docs/context-family/goal-progress.md with prompt-size evidence and a handoff packet.
```

## Goal 7: Observation Masking Projection

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 7: Observation Masking Projection from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-observation-masking-projection.md, and the harness context output.

Add projection-only observation masking as a preemptive route option. Mask old large observations only when archive handles exist. Preserve tool-call structure. Do not rewrite transcript, mask instructions, mask user intent, or default the policy on without the spec's promotion criteria.

Run harness context/validate, masking route tests, prompt snapshot tests, typecheck if required, and git diff --check. Update docs/context-family/goal-progress.md with token savings and recallability evidence.
```

## Goal 8: Read-only Recall Surface

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 8: Read-only Recall Surface from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-readonly-recall-surface.md, chat session handoff spec, token-dense recovery spec, and the harness context output.

Expose read-only recall for archive handles and selector expansion through proper runtime/Main/Host API boundaries. Renderer must not read transcript or archive files directly. Recall must verify checksums and must not mutate Memory, Knowledge, Task Ledger, transcript, or prompt state by itself.

Run harness context/validate, targeted recall tests, host boundary tests if required, typecheck if required, comms validation if communication paths changed, and git diff --check. Update docs/context-family/goal-progress.md with failure-mode evidence and a handoff packet.
```

## Goal 9: Policy Promotion

```text
In C:/Users/27933/Desktop/clawx/ClawX, complete Context Family Slice 9: Policy Promotion from docs/context-family/task-slices.md.

Read docs/context-family/goal-runbook.md, docs/context-family/task-slices.md, harness/specs/tasks/context-family-policy-promotion.md, prior goal-progress handoff packets, and the harness context output.

Promote only proven shadow behavior in small reversible steps. Preserve legacy fallback and flag-off parity. Do not bundle unrelated promotion, active tool-call blocking, UI expansion, or memory/knowledge writes. Provide metrics for token reduction, recovery fidelity, and evidence retention.

Run harness context/validate, required unit/e2e/replay commands from the spec, comms replay/compare when communication paths change, docs sync checks, and git diff --check. Update docs/context-family/goal-progress.md with promotion evidence and rollback notes.
```
