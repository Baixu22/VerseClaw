# Context Family Task Slices

This file is the dispatch map for Goal-based development. Each slice is meant to be implemented by one Goal session with its own task spec, verification, and handoff packet.

For larger Goal sessions, use `docs/context-family/phase-plan.md`:

- Phase 1 groups Slices 1-3: protocol types, Registry shadow, shadow ingestion.
- Phase 2 groups Slices 4-6: lifecycle audit, lossless archive MVP, Context Status shadow.
- Phase 3 groups Slices 7-9: observation masking, read-only recall, policy promotion.

Even inside a grouped phase, each slice still needs its own checkpoint and validation.

## Slice 0: Semantic Constitution

Spec: `harness/specs/tasks/context-family-semantic-constitution.md`

Goal: define the shared language before any runtime wiring.

Allowed outputs:

- `docs/context-family/glossary.md`
- `docs/context-family/axioms.md`
- `docs/context-family/goal-progress.md`
- `harness/specs/scenarios/context-family.md`
- `harness/specs/rules/context-family-boundary.md`
- `harness/specs/tasks/context-family-semantic-constitution.md`

Forbidden:

- Runtime behavior changes.
- Shared protocol types.
- Registry implementation.
- Prompt changes.

Exit criteria:

- Harness validates the semantic constitution spec.
- Existing components are mapped to Context Family roles.
- Current gaps are named without overstating production readiness.

## Slice 1: Protocol Types

Spec: `harness/specs/tasks/context-family-protocol-types.md`

Goal: add shared additive types for ContextItem identity, lifecycle, projection, source refs, provenance, and archive handles.

Allowed outputs:

- `shared/types/context-item.ts`
- `shared/types/context-family.ts`
- `tests/unit/context-family-contracts.test.ts`
- Docs updates under `docs/context-family/**`

Forbidden:

- Runtime registration.
- Database or file storage.
- Prompt behavior.
- Host API or Gateway changes.

Exit criteria:

- Types are serializable and stable.
- Invalid lifecycle transitions are rejected by pure helpers.
- CVK ids/selectors/checksums can be referenced without making CVK mandatory.

## Slice 2: Registry Shadow

Spec: `harness/specs/tasks/context-item-registry-shadow.md`

Goal: implement a metadata-only ContextItemRegistry that can register items, record lifecycle events, and produce status snapshots without affecting runtime behavior.

Allowed outputs:

- `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`
- `openclaw_runtime/src/context-engine/registry/context-item-store.ts`
- `tests/unit/context-item-registry.test.ts`
- Docs updates under `docs/context-family/**`

Forbidden:

- Large payload storage in registry.
- Prompt assembly changes.
- Tool execution changes.
- Renderer UI.
- Production default-on registration.

Exit criteria:

- Registry failures are non-fatal in shadow mode.
- Status snapshots include counts by kind/state.
- Metadata survives the intended persistence boundary.

## Slice 3: Shadow Ingestion

Spec: `harness/specs/tasks/context-family-shadow-ingestion.md`

Goal: register existing runtime inputs as ContextItems in shadow mode.

First targets:

- tool results as `observation`;
- bootstrap/system prompt files as `instruction`;
- user messages as `user_intent`;
- assistant messages as `reasoning`;
- compaction summaries as `derived`;
- CompressionArtifact records as `ledger` when available.

Forbidden:

- Changing transcript semantics.
- Changing compaction output.
- Changing prompt content.
- Treating CompressionArtifact as task truth.

Exit criteria:

- A representative run can produce a shadow item distribution.
- Registration warnings do not fail the run.
- Each registered item has a source ref and content hash or explicit reason why no hash is available.

## Slice 4: Lifecycle Audit

Spec: `harness/specs/tasks/context-lifecycle-event-audit.md`

Goal: record lifecycle events for truncation, routing, compaction, and checkpoint creation.

Forbidden:

- Changing route decisions.
- Changing truncation behavior.
- Treating checkpoints as lossless archives.

Exit criteria:

- Tool-result truncation records an event.
- Preemptive route decisions record why an item was kept, reduced, or targeted.
- Compaction records derived item provenance.
- Checkpoints can reference item ids while still being documented as recovery indexes.

## Slice 5: Lossless Archive MVP

Spec: `harness/specs/tasks/context-lossless-archive-mvp.md`

Goal: create checksum-backed archive handles for payloads or message ranges before irreversible truncation or compaction.

Forbidden:

- Masking without handles.
- Large payloads in registry.
- Skipping deletion semantics.
- UI exposure without a read-only recovery spec.

Exit criteria:

- Tool-result original payloads can be addressed before truncation.
- Compaction input ranges can be addressed before summary replacement.
- Archive handles verify checksums.
- Session hard delete cleans related archive artifacts.

## Slice 6: Context Status Shadow

Spec: `harness/specs/tasks/context-status-projection-shadow.md`

Goal: generate a small `[Context Status]` projection from runtime-owned status and Registry snapshots.

Forbidden:

- Default prompt changes.
- Large payload injection.
- UI-only truth.

Exit criteria:

- Flag off gives exact prompt parity.
- Flag on injects only bounded status.
- Status reports active/masked/compacted/archived counts and recovery availability.

## Slice 7: Observation Masking Projection

Spec: `harness/specs/tasks/context-observation-masking-projection.md`

Goal: add projection-only observation masking as a route between truncation and compaction.

Forbidden:

- Transcript rewrite masking in the first version.
- Masking instruction or user intent items.
- Masking without archive handles.

Exit criteria:

- Old large observations become placeholders in prompt snapshots only.
- Tool-call structure is preserved.
- Placeholders include item id or archive handle.
- Token count improves under tests without losing recallability.

## Slice 8: Read-only Recall Surface

Spec: `harness/specs/tasks/context-readonly-recall-surface.md`

Goal: expose read-only recovery for archive handles and CVK selectors.

Forbidden:

- Renderer direct file reads.
- Memory/Knowledge writes.
- Mutation through recall.

Exit criteria:

- `recall_original` or equivalent host/runtime route reads archived content by handle with checksum verification.
- `expand_selector` resolves resource selectors with stale/missing diagnostics.
- Handoff can use recovery output before falling back.

## Slice 9: Policy Promotion

Spec: `harness/specs/tasks/context-family-policy-promotion.md`

Goal: promote proven shadow behavior into default runtime policy in small, reversible steps.

Forbidden:

- Bundling unrelated promotions.
- Active tool-call blocking without its own promotion spec.
- Removing legacy fallback.

Exit criteria:

- Metrics show token reduction without recovery-fidelity regression.
- Flag-off parity remains covered.
- Rollback is documented and tested.
- Comms replay/compare run when communication paths change.
