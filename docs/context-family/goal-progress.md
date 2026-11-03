# Context Family Goal Progress

## Baseline Audit

- Branch: `codex/sekb-runtime-knowledge`.
- Workspace: `%USERPROFILE%\Desktop\clawx\ClawX`.
- Active stage: Slice 0, Semantic Constitution.
- Existing dirty state observed before this stage's new edits:
  - `tests/unit/runtime-memory-locomo-full-500.test.ts` modified.
  - `reports/agent-context-guidance-queue-current-state.md` untracked.
  - `tests/unit/helpers/runtime-memory-agent-retrieval.ts` untracked.
  - `docs/context-family/` existed with `goal-runbook.md`,
    `goal-prompts.md`, and `task-slices.md` before the required Slice 0 docs
    were added.
  - Context Family harness specs existed as untracked files before the required
    Slice 0 edits.
- Handling: unrelated dirty files are left untouched. Existing Context Family
  scaffold is treated as prior work and aligned rather than reverted.

## Objective

Complete Context Family Slice 0, the semantic constitution phase.

This stage creates the shared vocabulary, axioms, boundary rule, scenario, task
spec, and progress ledger for later Context Runtime work. It is a semantic and
harness-documentation phase only.

## Materials Read

- `reports/agent-context-guidance-queue-current-state.md`.
- `%USERPROFILE%\.codex\attachments\4249224c-d4c3-4f92-aa38-bc0991f48c57\pasted-text.txt`.
- `harness/specs/tasks/context-runtime-kit.md`.
- `harness/specs/tasks/context-runtime-kit-default-on.md`.
- `harness/specs/rules/context-runtime-kit-boundary.md`.
- `harness/specs/scenarios/context-runtime-kit.md`.
- `harness/specs/tasks/token-dense-recovery-compression-v1.md`.
- `harness/specs/tasks/chat-session-handoff-mvp.md`.
- `harness/specs/tasks/chat-session-runtime-fork.md`.
- `docs/clawx-design-overview.md`, especially Long Conversation Control,
  Long-Task Stability Stack, Human Intervention and Resume Control, Handoff,
  Fork, Recovery, and Mission ownership passages.
- `docs/context-family/goal-runbook.md`.
- `docs/context-family/goal-prompts.md`.
- `docs/context-family/task-slices.md`.
- Adjacent harness rules `workspace-harness-single-source` and
  `chat-loop-boundary`.

## Decisions

- Context Family is a semantic layer, not a new storage system, task truth
  system, prompt assembler, tool router, or runtime owner.
- Prompt is always a projection. Hard claims must resolve to owner-store
  evidence, archive handles, selectors and checksums, ledger events, handoffs,
  or traces.
- `CompressionArtifact v1` maps to a `ledger` ContextItem and remains a recovery
  carrier. It is not proof of task completion and does not replace Task Ledger,
  ClawGraph, or Observability.
- Compaction checkpoints are recovery indexes unless future work adds archive
  handles for original payloads.
- Observation masking remains future work and must require archive handles
  before any masked payload can be called recoverable.
- Existing component owners keep their authority: Task Ledger, ClawGraph,
  Observability, Memory, Knowledge, transcript JSONL, CompressionArtifact,
  LoopContextPack, and Context Pack.

## Forbidden Scope For This Stage

- No runtime behavior changes.
- No shared protocol type implementation.
- No Registry, Archive, Masking, Recall, or Context Status runtime wiring.
- No prompt assembly changes.
- No Gateway handler changes.
- No Host API or renderer changes.
- No tool execution, approval, retry, compaction algorithm, or transport policy
  changes.
- No `CompressionArtifact` schema or serialization changes.
- No database or storage schema changes.
- No parallel durable source of truth.

## Produced Files

Initial document group:

- `docs/context-family/glossary.md`: shared Context Family vocabulary, old-to-new
  terminology mapping, component role mapping, required lifecycle/projection
  wording, and current gaps.
- `docs/context-family/axioms.md`: five axioms plus archive-handle and ownership
  principles.
- `docs/context-family/goal-progress.md`: this progress ledger.

Harness group:

- `harness/specs/scenarios/context-family.md`: defines Context Family as the
  semantic layer and maps relationships to CRK, CompressionArtifact, handoff,
  fork, Task Ledger, ClawGraph, Observability, Memory, Knowledge,
  LoopContextPack, Context Pack, and transcript JSONL.
- `harness/specs/rules/context-family-boundary.md`: hard boundary rule for
  shadow-first rollout, flag-off parity, prompt/tool/API/UI/storage boundaries,
  ArchiveHandle prerequisites, masking prerequisites, and owner preservation.
- `harness/specs/tasks/context-family-semantic-constitution.md`: Slice 0 task
  spec with expected behavior, forbidden patterns, required validation, and
  acceptance criteria.

## Verification Commands

Planned:

```powershell
pnpm harness context --spec harness/specs/tasks/context-family-semantic-constitution.md
pnpm harness validate --spec harness/specs/tasks/context-family-semantic-constitution.md
git diff --check -- docs/context-family harness/specs/scenarios/context-family.md harness/specs/rules/context-family-boundary.md harness/specs/tasks/context-family-semantic-constitution.md
```

Current status: completed with repo-pinned `corepack pnpm` and `git diff
--check`; see Checkpoint 3.

## Unverified Statements

- No unit, typecheck, comms, or E2E commands were run because this task is
  semantic/harness documentation only.
- No runtime behavior was exercised beyond harness validation and diff checks.

## Current Gaps Recorded For Later Phases

- Shared ContextItem protocol types are not implemented in Slice 0.
- Metadata-only ContextItemRegistry is not implemented in Slice 0.
- ArchiveHandle creation and checksum verification are not implemented in Slice
  0.
- Observation masking, read-only recall, and Context Status prompt projection are
  not implemented in Slice 0.
- Current code evidence must not be overstated as a complete lossless archive or
  production recall loop.

## Next Stage Recommendation

- Suggested next Goal: `context-family-protocol-types`.
- Reason: Slice 0 defines the language. The next useful step is additive shared
  types and pure validation helpers for ContextItem identity, kind, lifecycle,
  source refs, provenance, projection specs, archive handles, and status
  snapshots.
- Boundary: the next stage should still avoid runtime registration, storage,
  prompt changes, Gateway/Host API/renderer changes, and `CompressionArtifact`
  serialization changes unless its task spec is explicitly updated.

## Checkpoint 1: Constitution Docs

- Status: in progress.
- Files completed:
  - `docs/context-family/glossary.md`.
  - `docs/context-family/axioms.md`.
  - `docs/context-family/goal-progress.md`.
- Decisions recorded:
  - Prompt is projection, not truth.
  - ArchiveHandle is required before lossless recovery claims.
  - Context Family keeps owner boundaries intact.
- Unverified:
  - Harness commands are still pending.

## Checkpoint 2: Harness Specs

- Status: in progress.
- Files completed:
  - `harness/specs/scenarios/context-family.md`.
  - `harness/specs/rules/context-family-boundary.md`.
  - `harness/specs/tasks/context-family-semantic-constitution.md`.
- Decisions recorded:
  - Context Family relationship to CRK and existing owner layers is explicit.
  - Boundary rule now names shadow-first, flag-off parity, no direct renderer
    transcript reads, no direct renderer Gateway calls, no prompt behavior
    change without promotion, no active tool-call blocking, and no lossless
    archive claims before ArchiveHandle.
  - Slice 0 validation is limited to harness and diff checks because no runtime
    code changes are allowed.
- Unverified:
  - Harness context, harness validate, and diff whitespace checks are still
    pending.

## Checkpoint 3: Validation

- Status: complete.
- Environment note:
  - Initial bare `pnpm harness context --spec
    harness/specs/tasks/context-family-semantic-constitution.md` failed before
    harness execution because bare `pnpm` resolved to 11.7.0 and attempted a
    non-TTY dependency install/purge.
  - Repo-pinned `corepack pnpm` resolved to 10.33.4 and was used for the final
    required harness commands, matching the package manager pin.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-semantic-constitution.md`
    - Result: passed. Read order included task, context-family scenario,
      context-family-boundary, context-runtime-kit-boundary,
      workspace-harness-single-source, harness guides, and harness layer.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-semantic-constitution.md`
    - Result: passed with `Spec is valid:
      harness\specs\tasks\context-family-semantic-constitution.md`.
  - `git diff --check -- docs/context-family
    harness/specs/scenarios/context-family.md
    harness/specs/rules/context-family-boundary.md
    harness/specs/tasks/context-family-semantic-constitution.md`
    - Result: passed with no whitespace errors.
  - Additional untracked-file whitespace check using
    `git diff --check --no-index -- /dev/null <file>` for each new Slice 0
    file.
    - Result: passed with no whitespace warnings in new untracked Slice 0 files.
- Unverified:
  - No unit, typecheck, comms, or E2E commands were run because Slice 0 is
    semantic/harness documentation only and the task spec does not require them.

## Final Stage Ledger

- Status: complete pending final diff review.
- Files completed:
  - `docs/context-family/glossary.md`.
  - `docs/context-family/axioms.md`.
  - `docs/context-family/goal-progress.md`.
  - `harness/specs/scenarios/context-family.md`.
  - `harness/specs/rules/context-family-boundary.md`.
  - `harness/specs/tasks/context-family-semantic-constitution.md`.
- Decisions:
  - Context Family unifies semantic language and lifecycle terms only.
  - Prompt, handoff, recovery context, compact views, and Context Status are
    projections, not durable truth.
  - Lossless recovery requires ArchiveHandle plus checksum verification.
  - `CompressionArtifact v1` is a ledger/recovery carrier, not proof of
    completion.
  - Next Goal should be `context-family-protocol-types`.
- Not done:
  - No runtime wiring.
  - No shared types.
  - No registry, archive, masking, recall, or status implementation.
  - No Prompt, Host API, renderer, Gateway, CompressionArtifact schema, storage,
    tool execution, approval, or compaction algorithm changes.

## Checkpoint 4: Follow-up Goal Dispatch Queue

- Status: complete.
- Files prepared:
  - `docs/context-family/goal-runbook.md`.
  - `docs/context-family/task-slices.md`.
  - `docs/context-family/goal-prompts.md`.
  - `harness/specs/tasks/context-family-protocol-types.md`.
  - `harness/specs/tasks/context-item-registry-shadow.md`.
  - `harness/specs/tasks/context-family-shadow-ingestion.md`.
  - `harness/specs/tasks/context-lifecycle-event-audit.md`.
  - `harness/specs/tasks/context-lossless-archive-mvp.md`.
  - `harness/specs/tasks/context-status-projection-shadow.md`.
  - `harness/specs/tasks/context-observation-masking-projection.md`.
  - `harness/specs/tasks/context-readonly-recall-surface.md`.
  - `harness/specs/tasks/context-family-policy-promotion.md`.
- Commands run:
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-semantic-constitution.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-item-registry-shadow.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-shadow-ingestion.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-lossless-archive-mvp.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-observation-masking-projection.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-readonly-recall-surface.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-policy-promotion.md`: passed.
  - `git diff --check -- docs/context-family harness/specs/scenarios/context-family.md harness/specs/rules/context-family-boundary.md harness/specs/tasks/context-family-semantic-constitution.md harness/specs/tasks/context-family-protocol-types.md harness/specs/tasks/context-item-registry-shadow.md harness/specs/tasks/context-family-shadow-ingestion.md harness/specs/tasks/context-lifecycle-event-audit.md harness/specs/tasks/context-lossless-archive-mvp.md harness/specs/tasks/context-status-projection-shadow.md harness/specs/tasks/context-observation-masking-projection.md harness/specs/tasks/context-readonly-recall-surface.md harness/specs/tasks/context-family-policy-promotion.md`: passed.
- Dispatch rule:
  - Future Goal sessions should pick exactly one spec from `docs/context-family/task-slices.md`, read `docs/context-family/goal-prompts.md`, run harness context for that spec, then implement only that slice.
- Validation gap:
  - These specs validate structurally. Runtime tests are intentionally deferred to the Goal that implements each slice.

## Checkpoint 5: Three-Phase Goal Packaging

- Status: complete.
- Files updated:
  - `docs/context-family/phase-plan.md`.
  - `docs/context-family/task-slices.md`.
  - `docs/context-family/goal-prompts.md`.
  - `docs/context-family/goal-runbook.md`.
- Phase grouping:
  - Phase 1, Foundation and Registry: Slices 1-3 (`context-family-protocol-types`, `context-item-registry-shadow`, `context-family-shadow-ingestion`).
  - Phase 2, Lifecycle, Archive, and Status: Slices 4-6 (`context-lifecycle-event-audit`, `context-lossless-archive-mvp`, `context-status-projection-shadow`).
  - Phase 3, Masking, Recall, and Promotion: Slices 7-9 (`context-observation-masking-projection`, `context-readonly-recall-surface`, `context-family-policy-promotion`).
- Commands run:
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-item-registry-shadow.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-shadow-ingestion.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-lossless-archive-mvp.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-observation-masking-projection.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-readonly-recall-surface.md`: passed.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-family-policy-promotion.md`: passed.
  - `git diff --check -- docs/context-family harness/specs/scenarios/context-family.md harness/specs/rules/context-family-boundary.md harness/specs/tasks/context-family-protocol-types.md harness/specs/tasks/context-item-registry-shadow.md harness/specs/tasks/context-family-shadow-ingestion.md harness/specs/tasks/context-lifecycle-event-audit.md harness/specs/tasks/context-lossless-archive-mvp.md harness/specs/tasks/context-status-projection-shadow.md harness/specs/tasks/context-observation-masking-projection.md harness/specs/tasks/context-readonly-recall-surface.md harness/specs/tasks/context-family-policy-promotion.md`: passed.
- Dispatch note:
  - Future Goal sessions may use the three Phase prompts in `docs/context-family/goal-prompts.md`. Even when running a grouped phase, each internal slice must run harness context/validate and leave its own checkpoint in this progress ledger.

## Handoff Packet Template

Use this packet before any handoff, fork, or context-pressure continuation.

```markdown
## Handoff Packet

- objective:
- done:
- inProgress:
- blocked:
- decisions:
- filesTouched:
- testsRun:
- risks:
- nextAction:
```

## Handoff Packet

- objective: Complete Context Family Slice 0 semantic constitution.
- done:
  - Required source materials read.
  - Existing Context Family scaffold detected and preserved.
  - Glossary, axioms, and progress ledger created.
  - Context Family scenario, boundary rule, and semantic constitution task spec
    tightened.
  - Required validation commands passed with repo-pinned `corepack pnpm` and
    `git diff --check`.
- inProgress:
  - Final diff/status review.
- blocked:
  - None currently.
- decisions:
  - Context Family is semantic and projection-oriented only in Slice 0.
  - Archive handles are required before lossless recovery or masking recovery
    claims.
  - Existing owner layers remain authoritative.
- filesTouched:
  - `docs/context-family/glossary.md`.
  - `docs/context-family/axioms.md`.
  - `docs/context-family/goal-progress.md`.
  - `harness/specs/scenarios/context-family.md`.
  - `harness/specs/rules/context-family-boundary.md`.
  - `harness/specs/tasks/context-family-semantic-constitution.md`.
- testsRun:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-semantic-constitution.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-semantic-constitution.md`: passed.
  - `git diff --check -- docs/context-family
    harness/specs/scenarios/context-family.md
    harness/specs/rules/context-family-boundary.md
    harness/specs/tasks/context-family-semantic-constitution.md`: passed.
  - Additional no-index whitespace check for new untracked Slice 0 files:
    passed.
- risks:
  - Bare `pnpm` is version 11.7.0 in this shell; use `corepack pnpm` for pinned
    repo commands.
  - Need final check that no runtime paths were modified.
- nextAction:
  - Perform final diff/status review, then hand off or start
    `context-family-protocol-types`.

## Slice 1 Checkpoint 1: Protocol Types Contract

- Status: in progress.
- Active spec:
  - `harness/specs/tasks/context-family-protocol-types.md`.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-family-contracts.test.ts --reporter=verbose`: failed
    first because `../../shared/types/context-family` did not exist. This was
    the expected RED contract-test result.
  - `corepack pnpm exec vitest run
    tests/unit/context-family-contracts.test.ts --reporter=verbose`: passed
    after adding the shared type helpers.
  - `corepack pnpm exec tsc --noEmit --skipLibCheck --target ES2022
    --moduleResolution bundler --module ESNext --allowImportingTsExtensions
    shared/types/context-item.ts shared/types/context-family.ts
    tests/unit/context-family-contracts.test.ts`: passed.
  - `corepack pnpm run typecheck`: failed on existing runtime type/dependency
    issues unrelated to the new Context Family files, including missing
    `@openclaw/normalization-core/*`, missing `@openclaw/acp-core/runtime/types`,
    missing `@ast-grep/napi`, ES2023 APIs under the current lib target, and
    existing mismatches in `openclaw_runtime/src/shared/number-coercion.ts` and
    `openclaw_runtime/src/runtime-core/memory-persistence.ts`. One new
    lifecycle transition map inference error in `shared/types/context-item.ts`
    was found and fixed before the touched-file TypeScript check passed.
- Files touched:
  - `shared/types/context-item.ts`.
  - `shared/types/context-family.ts`.
  - `tests/unit/context-family-contracts.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Decisions:
  - Added additive shared contract types only; no runtime registration, storage,
    prompt, Gateway, Host API, renderer, compaction, or UI behavior was changed.
  - `context-family.ts` is a public slice-level re-export over the canonical
    `context-item.ts` definitions.
  - Archive handles are validated as checksum-backed references but this slice
    does not create archive storage or claim recallability.
  - CVK references are optional on projections and provenance so Context Family
    can reference selectors/checksums without making CVK mandatory for every
    item.
- Validation gaps:
  - Full repo typecheck remains blocked by pre-existing runtime dependency/lib
    errors. The new Context Family files compile under a targeted TypeScript
    check.
- Next action:
  - Run final required harness/context, targeted unit test, diff whitespace
    checks, and final status review. Then write the Slice 1 handoff packet.

## Slice 1 Handoff Packet

- Objective: Complete Context Family Slice 1 protocol types.
- Status: partial.
- Done:
  - Read the required Context Family docs, active task spec, scenario, boundary
    rules, and harness context reading list.
  - Added additive shared Context Family protocol contracts in
    `shared/types/context-item.ts`.
  - Added `shared/types/context-family.ts` as the public re-export for this
    slice.
  - Added focused contract tests for deterministic serialization, item id
    validation, ArchiveHandle checksum validation, lifecycle transitions,
    bounded projection metadata, optional CVK selector/checksum references, and
    status snapshots.
  - Verified the targeted contract test followed RED/GREEN: it first failed
    because `shared/types/context-family` did not exist, then passed after the
    type/helper implementation.
- In progress:
  - None inside the active Slice 1 touched areas.
- Blocked:
  - Full repo `corepack pnpm run typecheck` fails on existing runtime
    dependency/lib/type issues outside the active spec touched areas, so the
    spec's required typecheck cannot be reported as passing in this workspace.
- Decisions:
  - This slice remains shared-contract only: no runtime registration, storage,
    prompt assembly, Gateway, Host API, renderer, compaction, tool execution, or
    UI behavior changes.
  - `ArchiveHandle` is a checksum-backed reference type only in Slice 1; archive
    storage, checksum verification against stored content, deletion cleanup,
    masking, and recall remain future slices.
  - CVK references are optional projection/provenance metadata and do not make
    CVK mandatory for every ContextItem.
  - Lifecycle transition validation is pure and local; it does not mutate owner
    stores or registry state.
- Files touched:
  - `shared/types/context-item.ts`.
  - `shared/types/context-family.ts`.
  - `tests/unit/context-family-contracts.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Tests run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-family-contracts.test.ts --reporter=verbose`: failed RED
    before implementation because `../../shared/types/context-family` was
    missing.
  - `corepack pnpm exec vitest run
    tests/unit/context-family-contracts.test.ts --reporter=verbose`: passed
    after implementation, 3 tests passed.
  - `corepack pnpm exec tsc --noEmit --skipLibCheck --target ES2022
    --moduleResolution bundler --module ESNext --allowImportingTsExtensions
    shared/types/context-item.ts shared/types/context-family.ts
    tests/unit/context-family-contracts.test.ts`: passed.
  - `git diff --check -- shared/types/context-item.ts
    shared/types/context-family.ts tests/unit/context-family-contracts.test.ts
    docs/context-family`: passed for tracked diff paths.
  - `git -c core.autocrlf=false diff --check --no-index -- /dev/null <file>`
    for the new Slice 1 files: no whitespace diagnostics; command exits `1`
    because `--no-index` reports differences from `/dev/null`.
  - `corepack pnpm run typecheck`: failed on pre-existing runtime errors,
    including missing `@openclaw/normalization-core/*`,
    `@openclaw/acp-core/runtime/types`, `@ast-grep/napi`, ES2023 lib gaps for
    `toSorted`/`findLast`, and existing runtime export mismatches. No new
    Context Family file errors remained after fixing the lifecycle transition
    map inference.
- Validation gaps:
  - Full repo typecheck is not green in this workspace. The new files are
    covered by the targeted Vitest contract and a touched-file TypeScript
    compile.
- Risks:
  - Later registry/archive slices must continue enforcing metadata-only
    records; these shared types allow metadata and handles but do not store or
    verify large payloads.
  - The active branch had unrelated dirty/untracked files before Slice 1; they
    were left untouched.
- Next action:
  - Resolve or isolate the pre-existing repo typecheck failures, then rerun
    `corepack pnpm run typecheck`. After that, the next Context Family stage is
    Slice 2: `context-item-registry-shadow`.

## Slice 2 Checkpoint: Registry Shadow

- Status: complete pending final phase validation.
- Active spec:
  - `harness/specs/tasks/context-item-registry-shadow.md`.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-item-registry-shadow.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: failed RED
    before implementation because
    `openclaw_runtime/src/context-engine/registry/context-item-registry` did
    not exist.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: passed after
    adding the metadata-only registry and in-memory store, 5 tests passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-item-registry-shadow.md`: passed.
- Files touched:
  - `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`.
  - `openclaw_runtime/src/context-engine/registry/context-item-store.ts`.
  - `tests/unit/context-item-registry.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Decisions:
  - The registry is shadow-first and metadata-only. It stores normalized
    `ContextItem` metadata and lifecycle events, not raw prompt, tool, or
    transcript payloads.
  - Registry writes and lifecycle failures return bounded diagnostics in shadow
    mode instead of failing an active run.
  - The Phase 1 store is an in-memory metadata adapter for tests and shadow
    observations; it is not a durable truth store and does not replace
    transcript JSONL, CompressionArtifact, Task Ledger, ClawGraph,
    Observability, Memory, Knowledge, or future archive storage.
  - Status snapshots report item counts by kind and lifecycle state only; they
    do not create a prompt-visible Context Status projection.
- Validation gaps:
  - Full repo `corepack pnpm run typecheck` is still expected to hit the
    pre-existing workspace typecheck blockers recorded in the Slice 1 packet.
    Final phase validation will rerun it and record the current output.
- Next action:
  - Run Slice 3 harness context, then wire shadow ingestion helpers at existing
    runtime input-adjacent seams without changing prompts, transcripts,
    compaction output, tool behavior, Host API, Gateway, renderer, or UI.

## Slice 3 Checkpoint: Shadow Ingestion

- Status: complete pending final phase validation.
- Active spec:
  - `harness/specs/tasks/context-family-shadow-ingestion.md`.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-shadow-ingestion.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: passed after
    adding runtime-adjacent shadow ingestion hooks, 5 tests passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-shadow-ingestion.md`: passed.
- Files touched:
  - `openclaw_runtime/src/agents/sessions/agent-session.ts`.
  - `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`.
  - `openclaw_runtime/src/context-engine/registry/context-item-store.ts`.
  - `tests/unit/context-item-registry.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Decisions:
  - Shadow ingestion is a private `AgentSession` observer. It is called only
    after existing persistence points for user, assistant, and toolResult
    messages and after existing compaction persistence.
  - System prompt registration observes the assembled system prompt as an
    `instruction` item. The helper API also supports path-backed instruction
    registration when a caller has exact bootstrap file provenance.
  - Tool results register as `observation`, user messages as `user_intent`,
    assistant messages as `reasoning`, compaction summaries as `derived`, and
    compaction details as `ledger` only when details are available.
  - Registered items carry source refs and either a content hash or an explicit
    `hashUnavailableReason`. Registry records keep hashes and metadata only,
    not raw payloads.
  - Registration results are fire-and-forget in runtime hooks; diagnostics are
    not surfaced to prompt assembly, transcript writes, compaction output, tool
    execution, Host API, Gateway, renderer, or UI.
- Validation gaps:
  - This slice does not expose registry data outside the private runtime
    observer. A representative distribution is covered by the focused unit test;
    production diagnostics/status surfacing remains future work.
  - Full repo `corepack pnpm run typecheck` still needs the final phase rerun
    and may remain blocked by previously recorded unrelated workspace issues.
- Next action:
  - Run all three required harness validations, all required tests from the
    three specs, final typecheck attempt, and `git diff --check` for touched
    paths. Then add the Phase 1 handoff packet.

## Phase 1 Handoff Packet

- Objective: Complete Context Family Phase 1, Foundation and Registry, covering
  Slices 1-3.
- Status: complete with one pre-existing repo-wide validation blocker.
- Done:
  - Slice 1 added shared `ContextItem` protocol types and pure helpers for
    item ids, lifecycle transitions, projection metadata, source refs,
    provenance, archive handles, checksums, and status snapshots.
  - Slice 2 added a shadow `ContextItemRegistry` and in-memory metadata store
    that can register items, record lifecycle events, query by session/kind/state,
    and produce count snapshots without storing raw payloads.
  - Slice 3 added shadow ingestion helpers and private `AgentSession` observer
    hooks for assembled system prompt instructions, user messages, assistant
    messages, tool results, compaction summaries, and compaction details when
    available.
  - `docs/context-family/goal-progress.md` now has one checkpoint per slice and
    this Phase 1 handoff.
- In progress:
  - None for Phase 1 touched surfaces.
- Blocked:
  - Full repo `corepack pnpm run typecheck` remains blocked by existing
    workspace/runtime issues outside the Phase 1 touched files. Fresh output
    names missing `@openclaw/normalization-core/*`,
    `@openclaw/acp-core/runtime/types`, `@ast-grep/napi`, ES2023 lib gaps for
    `toSorted`/`findLast`, and existing export mismatches in
    `openclaw_runtime/src/shared/number-coercion.ts`,
    `openclaw_runtime/src/infra/sqlite-wal.ts`,
    `openclaw_runtime/src/runtime-core/memory-persistence.ts`, and
    `openclaw_runtime/src/utils.ts`.
- Decisions:
  - Phase 1 remains shadow-only. It does not change prompt text, prompt order,
    transcript semantics, tool invocation, approvals, retries, compaction
    output, Host API, Gateway RPCs, renderer UI, or storage authority.
  - The Registry is metadata-only and non-fatal. Runtime hooks ignore registry
    diagnostics by design in this phase.
  - `ArchiveHandle` remains a protocol/reference type only. This phase does not
    implement archive storage, masking, recall, promotion, or lossless recovery
    claims.
  - Compaction details are registered as `ledger` items only when available and
    are not treated as task truth or a replacement for CompressionArtifact,
    Task Ledger, ClawGraph, or Observability.
  - README docs were reviewed for required sync. No README changes were made
    because Phase 1 exposes no user-facing flow, UI, API, or behavior change.
- Files touched:
  - `shared/types/context-item.ts`.
  - `shared/types/context-family.ts`.
  - `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`.
  - `openclaw_runtime/src/context-engine/registry/context-item-store.ts`.
  - `openclaw_runtime/src/agents/sessions/agent-session.ts`.
  - `tests/unit/context-family-contracts.test.ts`.
  - `tests/unit/context-item-registry.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Tests run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-item-registry-shadow.md`: passed.
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-shadow-ingestion.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-protocol-types.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-item-registry-shadow.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-shadow-ingestion.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-family-contracts.test.ts --reporter=verbose`: passed,
    3 tests passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: passed,
    5 tests passed.
  - `corepack pnpm exec tsc --noEmit --skipLibCheck --target ES2022
    --moduleResolution bundler --module ESNext --allowImportingTsExtensions
    shared/types/context-item.ts shared/types/context-family.ts
    openclaw_runtime/src/context-engine/registry/context-item-store.ts
    openclaw_runtime/src/context-engine/registry/context-item-registry.ts
    tests/unit/context-family-contracts.test.ts
    tests/unit/context-item-registry.test.ts`: passed.
  - `corepack pnpm run typecheck`: failed on the pre-existing repo-wide blockers
    listed above; no new Context Family touched file was named in the output.
  - Required `git diff --check -- ...` commands for Slice 1, Slice 2, and Slice
    3 touched path groups: passed. Git warned that
    `openclaw_runtime/src/agents/sessions/agent-session.ts` LF line endings will
    be replaced by CRLF when Git next touches it.
  - Additional `git -c core.autocrlf=false diff --check --no-index -- /dev/null
    <file>` checks for new Phase 1 files: no whitespace diagnostics.
- Validation gaps:
  - Full repo typecheck is not green in this workspace due to unrelated
    dependency/lib/export issues. Touched Context Family files have targeted
    compile coverage and focused unit coverage.
  - No comms replay/compare or E2E tests were run because Phase 1 did not add
    or change Host API, Gateway, renderer, or communication payload behavior.
- Risks:
  - The private session registry is currently not externally observable except
    through tests. Future status/diagnostic surfacing must use a separate
    promotion spec with flag-off parity and proper Host API/Gateway boundaries.
  - Later archive/masking/recall phases must not infer lossless recovery from
    the metadata registry or from compaction details.
  - The active branch had unrelated dirty/untracked files before this phase,
    including `tests/unit/runtime-memory-locomo-full-500.test.ts` and
    `tests/unit/helpers/runtime-memory-agent-retrieval.ts`; they remain outside
    this phase's scope.
- Next action:
  - Resolve or isolate the existing repo-wide typecheck blockers, then proceed
    to Phase 2 Slice 4: `context-lifecycle-event-audit`.

## Slice 4 Checkpoint: Lifecycle Event Audit

- Status: complete pending final phase validation.
- Active spec:
  - `harness/specs/tasks/context-lifecycle-event-audit.md`.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: failed RED
    before implementation because lifecycle audit helper exports did not exist.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: passed after
    adding lifecycle audit helpers, 8 tests passed.
- Files touched:
  - `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`.
  - `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts`.
  - `openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts`.
  - `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`.
  - `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts`.
  - `openclaw_runtime/src/config/sessions/types.ts`.
  - `tests/unit/context-item-registry.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Event examples:
  - Tool-result truncation emits `reason: "tool_result_truncation"`,
    `actor: "tool-result-truncation"`, `from: "active"`, `to: "evicted"`,
    and bounded metadata such as `originalChars`, `projectedChars`,
    `truncatedChars`, `maxChars`, `aggregateBudgetChars`, and
    `replacementKind`.
  - Preemptive routing can emit `reason: "preemptive_route_decision"` with
    route facts such as `route`, `estimatedPromptTokens`,
    `promptBudgetBeforeReserve`, `overflowTokens`, and
    `toolResultReducibleChars`.
  - Runtime compaction can emit `reason: "runtime_compaction"` with
    `checkpointId`, `sourceItemCount`, `tokensBefore`, `tokensAfter`, and
    `summaryChars`, plus derived item event ids when available.
  - Compaction checkpoints now carry `lifecycleAudit.eventIds` and
    `lifecycleAudit.role: "recovery_index"` with `losslessArchive: false`.
- Decisions:
  - Lifecycle audit helpers sanitize payload-shaped fields and store bounded
    metadata only; no Registry raw payload storage was added.
  - Tool-result truncation, route decisions, compaction, and checkpoint creation
    expose audit event shapes without changing truncation output, route
    selection, compaction summaries, prompt assembly, tool execution, Host API,
    Gateway methods, renderer behavior, or storage authority.
  - Checkpoints remain recovery indexes. They are explicitly not lossless
    archives until Slice 5 adds checksum-backed ArchiveHandles.
- Validation gaps:
  - Slice 4 final `harness validate`, repo `typecheck`, full `pnpm test`, and
    `git diff --check` will run during Phase 2 final validation.
- Next action:
  - Start Slice 5: `context-lossless-archive-mvp`, beginning with
    `corepack pnpm harness context --spec
    harness/specs/tasks/context-lossless-archive-mvp.md`.

## Slice 5 Checkpoint: Lossless Archive MVP

- Status: complete pending final phase validation.
- Active spec:
  - `harness/specs/tasks/context-lossless-archive-mvp.md`.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-lossless-archive-mvp.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: failed RED
    before implementation because archive helper exports did not exist.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts --reporter=verbose`: passed after
    adding archive helpers and runtime wiring, 11 tests passed.
- Files touched:
  - `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`.
  - `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts`.
  - `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts`.
  - `openclaw_runtime/src/config/sessions/types.ts`.
  - `electron/services/sessions-api.ts`.
  - `tests/unit/context-item-registry.test.ts`.
  - `docs/context-family/goal-progress.md`.
- ArchiveHandle examples:
  - Tool-result archive handle shape:
    `context-archive://session-1/observation-tool-call-1-<checksum>.context-archive.json`
    with `checksum: "sha256:<64 hex>"`, `byteLength`, and source metadata
    pointing to the transcript entry or tool call.
  - Pre-compaction snapshot handles are created during checkpoint snapshot
    capture, before compaction proceeds, and are stored on the checkpoint as
    `archiveHandle` when snapshot archiving succeeds.
  - `verifyContextArchiveHandle(handle)` returns `{ ok: false,
    reason: "checksum_mismatch" }` for stale or corrupted content, so consumers
    fail closed instead of treating mismatched payloads as recoverable.
- Cleanup behavior:
  - `cleanupContextArchiveArtifacts({ sessionIds })` removes
    `*.context-archive.json` artifacts for deleted sessions.
  - Electron host hard delete calls this cleanup after the existing transcript
    and trajectory artifact sweep. Renderer code does not read archive files.
- Decisions:
  - Archive artifacts store original payloads outside the metadata Registry; the
    Registry continues to store only handles, checksums, byte counts, and bounded
    provenance metadata.
  - No observation masking, recall API/UI, renderer direct reads, prompt
    promotion, route changes, truncation semantic changes, or large Registry
    payload storage were added.
  - Checkpoints may carry an ArchiveHandle when pre-compaction capture succeeds,
    but checkpoints without a handle remain recovery indexes only and must not
    claim lossless recovery.
- Validation gaps:
  - Slice 5 final `harness validate`, repo `typecheck`, full `pnpm test`, comms
    replay/compare, and `git diff --check` will run during Phase 2 final
    validation.
- Next action:
  - Start Slice 6: `context-status-projection-shadow`, beginning with
    `corepack pnpm harness context --spec
    harness/specs/tasks/context-status-projection-shadow.md`.

## Slice 6 Checkpoint: Context Status Projection Shadow

- Status: complete pending final phase validation.
- Active spec:
  - `harness/specs/tasks/context-status-projection-shadow.md`.
- Commands run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-runtime-kit-active-engine.test.ts --reporter=verbose`:
    failed RED before implementation because enabled Context Status was absent.
  - `corepack pnpm exec vitest run
    tests/unit/context-runtime-kit-active-engine.test.ts --reporter=verbose`:
    passed after adding the explicit flag, 3 tests passed.
- Files touched:
  - `openclaw_runtime/src/context-engine/cvk/engine.ts`.
  - `tests/unit/context-runtime-kit-active-engine.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Status output example:
  - `[Context Status]`
  - `pressure: tokenBudget=4000 messages=1`
  - `lifecycle: active=1 archived=2 compacted=1`
  - `kinds: derived=1 ledger=1 observation=2`
  - `archive: available=true recovery=false`
  - `warnings: recall surface disabled in Slice 6`
- Decisions:
  - Context Status is controlled by `contextStatusEnabled`; the default and
    explicit `false` preserve exact prompt-addition parity.
  - Flag-on status is bounded inside the existing context-engine prompt budget,
    truncates long warnings, and contains no raw hidden payloads or UI-only task
    truth.
  - The projection reports pressure, lifecycle counts, kind counts, archive
    availability, recovery availability, and warnings. It does not replace Task
    Ledger, ClawGraph, Observability, Memory, Knowledge, CompressionArtifact, or
    Context Pack authority.
- Validation gaps:
  - Slice 6 final `harness validate`, repo `typecheck`, active-engine required
    test rerun, and `git diff --check` will run during Phase 2 final
    validation.
- Next action:
  - Run Phase 2 final validations for Slices 4-6, including required harness
    validates, required tests, comms validation for the archive cleanup/backend
    path, and `git diff --check`.

## Phase 2 Handoff: Lifecycle, Archive, and Status

- Status: implemented with repo-wide validation blockers recorded below.
- Scope completed:
  - Slice 4 records lifecycle audit events for tool-result truncation,
    preemptive routing decisions, runtime compaction, and compaction checkpoint
    creation.
  - Slice 5 creates checksum-backed `ArchiveHandle` artifacts for original
    tool-result payloads and pre-compaction transcript snapshots, verifies them
    fail-closed, and removes related archive artifacts during hard delete.
  - Slice 6 exposes bounded `[Context Status]` under `contextStatusEnabled`
    while preserving exact prompt parity when disabled.
- Boundary cleanup:
  - Electron hard delete now calls
    `cleanupContextArchiveArtifacts({ sessionIds })` from
    `electron/utils/session-files.ts`, keeping renderer/Main archive deletion
    on the Electron utility boundary rather than importing runtime registry code
    directly from `electron/services/sessions-api.ts`.
  - Runtime registry helpers remain the authority for creating and verifying
    archive handles; Electron only performs best-effort hard-delete artifact
    cleanup by session id.
- Acceptance examples:
  - Truncation lifecycle event metadata includes bounded size fields such as
    `originalChars`, `projectedChars`, `truncatedChars`, `maxChars`, and
    `replacementKind`.
  - Route lifecycle event metadata includes decision facts such as `route`,
    `estimatedPromptTokens`, `promptBudgetBeforeReserve`, and
    `overflowTokens` without changing route selection.
  - Compaction checkpoint lifecycle metadata carries
    `lifecycleAudit.role: "recovery_index"` and `losslessArchive: false` unless
    a verified `archiveHandle` exists.
  - Archive verification returns closed failures such as `missing` and
    `checksum_mismatch`; consumers must not treat mismatched payloads as
    recovered content.
  - Context Status flag-on output is bounded and reports pressure, lifecycle
    counts, kind counts, archive/recovery availability, and warnings; flag-off
    output is prompt-identical to the previous path.
- Final validation run:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-lossless-archive-mvp.md`: passed.
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-lossless-archive-mvp.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts
    tests/unit/context-runtime-kit-active-engine.test.ts --reporter=verbose`:
    passed, 14 tests.
  - `corepack pnpm exec vitest run tests/unit/session-files.test.ts
    --reporter=verbose`: passed, 1 test.
  - `corepack pnpm run comms:replay`: passed.
  - `corepack pnpm run comms:compare`: passed.
  - Required `git diff --check` commands for the three slice path sets: passed
    with line-ending warnings only.
- Repo-wide validation blockers:
  - `corepack pnpm run typecheck` still fails in `typecheck:node` before web
    typecheck. Current blockers include unresolved runtime packages such as
    `@openclaw/normalization-core/*`, `@openclaw/acp-core/runtime/types`, and
    `@ast-grep/napi`, plus existing ES2023 `toSorted` / `findLast` library
    target errors and SQLite helper export mismatches.
  - `corepack pnpm test` still fails repo-wide: 2582 tests passed, 15 tests
    failed, and 16 suites failed to import. Visible blockers include missing
    `@ast-grep/napi`, missing
    `openclaw_runtime/src/context-engine/role-memory-context-provider`,
    existing host boundary violations in
    `electron/services/tool-protocol-shadow.ts` and
    `electron/services/tool-provider-registry.ts`, and unrelated UI/store
    assertion or timeout failures.
- Phase 3 handoff:
  - Preserve the Phase 2 boundaries: no route decision changes, no truncation or
    compaction semantic changes, no checkpoint-as-lossless claim without
    `ArchiveHandle`, no masking, no recall API/UI, no default prompt changes,
    no large Registry payloads, and no renderer direct transcript/archive reads.
  - Future masking/recall work should consume verified ArchiveHandles and must
    fail closed when checksums or artifacts do not verify.

## Phase 3 Slice 7: Observation Masking Projection

- Status: implemented with focused validation evidence.
- Harness context:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-observation-masking-projection.md`: passed.
- Validation evidence:
  - `corepack pnpm exec vitest run
    tests/unit/context-observation-masking.test.ts --reporter=verbose`: RED
    before implementation, then passed with 3 tests after implementation.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-observation-masking-projection.md`: passed.
- Files touched:
  - `openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts`.
  - `openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.types.ts`.
  - `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`.
  - `openclaw_runtime/src/config/types.openclaw.ts`.
  - `openclaw_runtime/src/config/zod-schema.ts`.
  - `tests/unit/context-observation-masking.test.ts`.
  - `docs/context-family/goal-progress.md`.
- Behavior:
  - Added an explicit `observation_masking` preemptive route.
  - Added `runtime.contextFamily.observationMasking` with `enabled`,
    `minChars`, and `preserveNewestObservationCount` fields. Omitted or disabled
    config preserves legacy route behavior.
  - Added projection-only masking for old large `observation` tool-result
    messages. The provider-boundary prompt receives placeholders; transcript
    rewrite masking was not implemented.
  - Masking creates and verifies `ArchiveHandle` artifacts before replacing text
    in the prompt projection. Missing `sessionId` or failed verification leaves
    messages unmasked and records diagnostics.
  - Placeholders include the ContextItem id, archive URI, checksum, and original
    character count. Tool-result role/id/tool-call structure is preserved.
- Decisions:
  - Instruction, user-intent, assistant reasoning, and newest observation
    messages are not automatically masked.
  - The existing truncation and compaction routes remain available as fallback.
  - The flag defaults off in Slice 7; default-on behavior is reserved for Slice
    9 promotion evidence.
- Validation gaps:
  - Full `typecheck`, `pnpm test`, comms replay/compare, and `git diff --check`
    will run during Phase 3 final validation after Slice 8 and Slice 9.
- Next action:
  - Start Slice 8 read-only recall using the verified archive handles created by
    Slice 5 and consumed by Slice 7.

## Phase 3 Slice 8: Read-only Recall Surface

- Status: implemented with focused validation evidence and one unrelated
  pre-existing targeted-suite blocker.
- Harness context:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-readonly-recall-surface.md`: passed.
- Validation evidence:
  - `corepack pnpm exec vitest run
    tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
    --reporter=verbose`: RED before implementation for missing
    `recallOriginal` and `expandSelector`; after implementation, the new Host
    API and service tests passed, with the suite still failing only on the
    pre-existing boundary scan for
    `electron/services/tool-protocol-shadow.ts` and
    `electron/services/tool-provider-registry.ts` importing runtime internals.
  - `corepack pnpm exec vitest run
    tests/unit/context-observation-masking.test.ts
    tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
    --reporter=verbose`: 69 tests passed, 1 unrelated boundary-scan test failed
    for the same two existing files.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-readonly-recall-surface.md`: passed.
- Files touched:
  - `shared/host-api/contract.ts`.
  - `src/lib/host-api.ts`.
  - `electron/services/sessions-api.ts`.
  - `openclaw_runtime/packages/gateway-protocol/src/index.ts`.
  - `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts`.
  - `openclaw_runtime/packages/gateway-protocol/src/schema/protocol-schemas.ts`.
  - `openclaw_runtime/src/gateway/methods/core-descriptors.ts`.
  - `openclaw_runtime/src/gateway/server-methods.ts`.
  - `openclaw_runtime/src/gateway/server-methods/sessions.ts`.
  - `tests/unit/host-api-facade.test.ts`.
  - `tests/unit/host-services.test.ts`.
  - `README.md`, `README.zh-CN.md`, `README.ja-JP.md`.
  - `docs/context-family/goal-progress.md`.
- Behavior:
  - Added `hostApi.sessions.recallOriginal` and
    `hostApi.sessions.expandSelector`; renderer consumers stay behind the Host
    API facade and do not read transcript or archive files directly.
  - Electron Main proxies recall through Gateway RPC only. It does not add a
    local archive-read fallback.
  - Gateway `sessions.recallOriginal` validates the `ArchiveHandle`, verifies
    checksum-backed archive contents with `verifyContextArchiveHandle`, returns
    payload only on verified success, and fails closed with diagnostics for
    invalid handles, missing archive files, checksum mismatch, or read errors.
  - Gateway `sessions.expandSelector` is diagnostic-only in this first recall
    slice. Without a resolver, it returns `missing_selector`,
    `stale_selector`, or `ambiguous_selector` diagnostics instead of
    fabricating success.
  - Recall does not write Memory, Knowledge, Task Ledger, transcript files,
    prompt state, tool state, approvals, or workspace files.
- Decisions:
  - Archive recall and selector expansion are operator-read RPCs.
  - Selector expansion is intentionally fail-closed until a concrete selector
    resolver is wired through a narrower task.
  - README updates describe the read-only, archive-backed behavior and rollback
    flag without adding UI claims.
- Validation gaps:
  - Full `typecheck`, `pnpm test`, comms replay/compare, E2E, and final
    `git diff --check` remain for Phase 3 final validation.
- Next action:
  - Start Slice 9 policy promotion only for behavior with Slice 7 and Slice 8
    evidence, preserving flag-off parity and rollback.

## Phase 3 Slice 9: Policy Promotion

- Status: implemented as a narrow, opt-in promotion evidence layer.
- Harness context:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-family-policy-promotion.md`: passed.
- Validation evidence:
  - `corepack pnpm exec vitest run
    tests/unit/context-family-policy-promotion.test.ts --reporter=verbose`:
    RED before implementation for missing promotion metrics helper, then passed
    with 2 tests after implementation.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-policy-promotion.md`: passed.
- Files touched:
  - `openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts`.
  - `tests/unit/context-family-policy-promotion.test.ts`.
  - `README.md`, `README.zh-CN.md`, `README.ja-JP.md`.
  - `docs/context-family/goal-progress.md`.
- Promoted behavior:
  - Promoted only the archive-backed observation masking route as an opt-in
    runtime policy path controlled by
    `runtime.contextFamily.observationMasking.enabled`.
  - Rollback path is explicit:
    `runtime.contextFamily.observationMasking.enabled=false` or omit the config
    field. Flag-off parity is covered by tests comparing the rollback decision
    with the baseline decision.
  - Legacy truncation and compaction routes remain available and are not
    removed.
- Metrics:
  - Added `buildContextFamilyPolicyPromotionMetrics` for
    `observation_masking_projection`.
  - Metrics compare baseline route, promoted route, baseline prompt tokens,
    projected prompt tokens, token reduction, archive handle count, verified
    masked count, recallability, diagnostics, and failure modes.
  - Focused test evidence shows an opt-in masking projection can switch from a
    compaction route to `observation_masking`, retain 2 verified archive
    handles for 2 masked observations, and reduce projected prompt tokens.
- Boundaries:
  - No active tool-call blocking was introduced.
  - No Memory, Knowledge, Task Ledger, transcript, workspace, approval, or tool
    state writes were added through recall.
  - No unrelated promotion or legacy fallback removal was bundled.
- Documentation:
  - README series now documents archive-backed, read-only masking/recall,
    explicit observation masking enablement, checksum verification, selector
    diagnostics, and non-mutation boundaries.
- Validation gaps:
  - Final Phase 3 validation commands follow in the next checkpoint.

## Phase 3 Final Handoff: Masking, Recall, and Promotion

- Status: implemented with focused validation evidence and repo-wide validation
  blockers recorded below.
- Scope completed:
  - Slice 7 added projection-only observation masking at the provider prompt
    boundary, backed by verified `ArchiveHandle` artifacts before any
    observation text is replaced in the prompt projection.
  - Slice 8 exposed read-only recall through Host API, Electron Main, Gateway
    protocol, and Gateway handlers. Renderer consumers use the Host API facade;
    recall verifies checksums and fails closed with explicit diagnostics.
  - Slice 9 promoted only the proven archive-backed observation masking route as
    an opt-in policy path with rollback, metrics, tests, and README docs.
- Boundary evidence:
  - Transcript truth is not rewritten for masking; masking changes only the
    provider-bound prompt projection.
  - `instruction`, `user_intent`, assistant reasoning, and newest observations
    are not automatically masked.
  - Recall does not mutate Memory, Knowledge, Task Ledger, transcript files,
    prompt state, workspace files, approval state, or tool state.
  - No renderer direct file reads were added. Recall goes through
    `src/lib/host-api.ts`, `electron/services/sessions-api.ts`, and Gateway RPC.
  - No active tool-call blocking or legacy fallback removal was introduced.
- Fresh final validation run:
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-observation-masking-projection.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-readonly-recall-surface.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-family-policy-promotion.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-observation-masking.test.ts
    tests/unit/context-family-policy-promotion.test.ts
    tests/unit/host-services.test.ts --reporter=verbose`: passed, 33 tests.
  - `corepack pnpm exec vitest run
    tests/unit/context-observation-masking.test.ts
    tests/unit/context-family-policy-promotion.test.ts
    tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
    --reporter=verbose`: 71 tests passed, 1 unrelated pre-existing boundary
    scan failed for
    `electron/services/tool-protocol-shadow.ts` and
    `electron/services/tool-provider-registry.ts` importing runtime internals.
    The new recall facade and service assertions passed in that run.
  - `corepack pnpm run comms:replay`: passed.
  - `corepack pnpm run comms:compare`: passed.
  - `git diff --check -- openclaw_runtime/src/agents/embedded-agent-runner
    openclaw_runtime/src/context-engine/registry openclaw_runtime/src/gateway
    openclaw_runtime/packages/gateway-protocol electron/services
    shared/host-api src/lib tests/unit docs/context-family README.md
    README.zh-CN.md README.ja-JP.md`: passed with line-ending warnings only.
- Repo-wide validation blockers:
  - `corepack pnpm run typecheck`: failed fresh in `typecheck:node` by existing
    dependency/type-target issues, including unresolved
    `@openclaw/normalization-core/*`, `@openclaw/acp-core/runtime/types`,
    `@ast-grep/napi`, ES2023 `toSorted` / `findLast` target support, and
    existing SQLite/number-coercion export mismatches.
  - `corepack pnpm test`: failed fresh repo-wide with 2590 passing tests, 13
    failed tests, and 16 failed suites. Visible blockers include missing
    `@ast-grep/napi`, missing `role-memory-context-provider`, existing host
    boundary scan failures, React Router setup errors, stale LoCoMo metrics,
    runtime memory cache version drift, and rollback-plan expectations.
  - `corepack pnpm run test:e2e`: timed out twice. The fresh final attempt timed
    out after about 15 minutes with no captured Playwright result output.
- Handoff packet:
  - objective: Complete Context Family Phase 3, Slices 7-9.
  - done: Masking, read-only recall, opt-in promotion metrics, rollback docs,
    harness validation, focused tests, comms replay/compare, and diff whitespace
    checks.
  - inProgress: None.
  - blocked: Repo-wide typecheck/full-test/E2E are blocked as described above.
  - decisions: Keep masking projection-only and opt-in; keep selector expansion
    diagnostic-only until a resolver-specific task; promote only verified
    archive-backed observation masking.
  - filesTouched: Phase 3 touched runtime compaction/attempt config, Gateway
    protocol and handlers, Electron sessions service, Host API contract/facade,
    README docs, tests, and this progress ledger.
  - testsRun: See fresh final validation run above.
  - risks: E2E remains unverified due to timeout; repo-wide validation has
    unrelated blockers that should be cleared in a separate stabilization pass.
  - nextAction: Review the final diff and decide whether to address unrelated
    repo-wide blockers separately before integration.

## Rework Checkpoint: Context Family Integration Closure

- Status: implemented with focused validation evidence.
- Reason for rework:
  - Prior phase completion reports overstated integration completeness. Three
    gaps remained: runtime transformation paths did not all feed the shared
    lifecycle audit, Context Status was not wired from runtime config at engine
    registration time, and session handoff did not consume read-only archive
    recall output.
- Scope repaired:
  - Lifecycle audit remains shadow/non-fatal and now has focused coverage for
    truncation, route, compaction-like, and checkpoint lifecycle events in the
    shared audit snapshot.
  - Context Status remains flag-gated through
    `runtime.contextFamily.contextStatus.enabled`; flag-off prompt parity is
    preserved.
  - Handoff now preserves `archiveHandle` on checkpoint records, calls
    `sessions.recallOriginal` through Gateway RPC when a checkpoint archive is
    available, records `context_recall` as an evidence source, and includes a
    bounded read-only recall section in the draft without local archive reads or
    transcript/memory/workspace mutation.
- Additional files touched during rework:
  - `electron/services/sessions-api.ts`.
  - `shared/types/long-task-control.ts`.
  - `shared/host-api/contract.ts`.
  - `openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts`.
- Fresh validation evidence:
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm harness context --spec
    harness/specs/tasks/context-readonly-recall-surface.md`: passed.
  - `corepack pnpm exec vitest run
    tests/unit/context-item-registry.test.ts
    tests/unit/context-engine-registry-default-on.test.ts
    tests/unit/host-services.test.ts --reporter=verbose`: passed, 45 tests.
  - `corepack pnpm exec vitest run
    tests/unit/context-family-contracts.test.ts
    tests/unit/context-item-registry.test.ts
    tests/unit/context-runtime-kit-active-engine.test.ts
    tests/unit/context-engine-registry-default-on.test.ts
    tests/unit/context-observation-masking.test.ts
    tests/unit/context-family-policy-promotion.test.ts
    tests/unit/session-files.test.ts
    tests/unit/host-services.test.ts --reporter=verbose`: passed, 57 tests.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-lifecycle-event-audit.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-status-projection-shadow.md`: passed.
  - `corepack pnpm harness validate --spec
    harness/specs/tasks/context-readonly-recall-surface.md`: passed.
  - `corepack pnpm run comms:replay`: passed.
  - `corepack pnpm run comms:compare`: passed.
  - `git diff --check -- openclaw_runtime/src/agents/embedded-agent-runner
    openclaw_runtime/src/context-engine openclaw_runtime/src/gateway
    openclaw_runtime/packages/gateway-protocol electron/services
    shared/host-api shared/types src/lib tests/unit docs/context-family
    harness/specs`: passed with line-ending warnings only.
- Remaining known blockers:
  - Full repo `typecheck`, full `pnpm test`, and E2E were not rerun in this
    rework checkpoint because the immediately preceding phase records already
    identify unrelated repo-wide blockers and E2E timeouts. This checkpoint
    verifies the repaired Context Family integration surface with focused tests,
    harness validation, comms checks, and diff hygiene.

## CI Closure Checkpoint: Host Boundary, Unit Closure, And Recall E2E

- Status: backend/system integration closed for this checkpoint; full UI
  Electron E2E is temporarily waived because the remaining failures are broad
  UI/test-worktree drift rather than Context/CRK backend integration blockers.
- Reason for closure:
  - The prior validation surface still had a Host API boundary failure caused by
    Electron services importing runtime-core types directly.
  - Handoff E2E coverage did not assert the read-only context recall source or
    recall-backed draft content.
- Scope repaired:
  - Added a shared runtime shadow DTO contract for MCP tool-call and provider
    registry shadow records.
  - Updated Electron MCP shadow services to depend on `@shared/types` instead of
    `openclaw_runtime/src/runtime-core`.
  - Extended the chat session handoff E2E fixture to include the `context_recall`
    source and read-only recall draft section.
  - Made `@ast-grep/napi` optional at module-import time so missing native
    dependency state degrades to a scan diagnostic instead of crashing unrelated
    unit suites.
  - Added the role-memory context provider expected by the current memory
    provider contract tests.
  - Repaired repo-wide unit blockers from stale Chat test harness setup,
    rollback-plan evidence copy, current LoCoMo artifact metrics, registry flag
    expectations, and generated-file line stats in the work-context artifact
    surface.
  - Filled the Russian Settings > Skills title localization gap exposed by E2E.
  - Stabilized `resource-leases-stress` by asserting FIFO grant order and
    recorded wait telemetry instead of wall-clock millisecond monotonicity.
- Boundaries preserved:
  - Context Family Registry remains metadata-only and non-authoritative.
  - Observation masking remains opt-in through
    `runtime.contextFamily.observationMasking.enabled`.
  - Context Status remains opt-in through
    `runtime.contextFamily.contextStatus.enabled`.
  - Read-only recall remains routed through Host API, Electron Main, and Gateway
    RPC; renderer code does not read transcript or archive files directly.
  - No active tool-call blocking was introduced.
- Fresh validation evidence:
  - `corepack pnpm exec vitest run
    tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
    --reporter=verbose`: passed, 67 tests.
  - CRK focused tests from the closure plan: passed, 51 tests across the
    runtime adapter, active engine, registry default-on, recovery, contracts,
    compiler, resolver, views, shadow provider, tool-call gate, compression,
    recovery context, codebase index, and eval report suites.
  - Context Family focused tests from the closure plan: passed, 21 tests.
  - Harness validation passed for `context-runtime-kit-default-on.md`, all
    `context-family-*.md` task specs, `context-item-registry-shadow.md`,
    `context-lifecycle-event-audit.md`, `context-lossless-archive-mvp.md`,
    `context-observation-masking-projection.md`,
    `context-readonly-recall-surface.md`, and
    `context-status-projection-shadow.md`.
  - `corepack pnpm run typecheck`: passed fresh on 2026-07-09.
  - `corepack pnpm test`: passed fresh on 2026-07-09, 299 files passed, 1
    skipped; 2784 tests passed, 8 skipped.
  - `corepack pnpm run comms:replay`: passed.
  - `corepack pnpm run comms:compare`: passed.
  - `corepack pnpm run build:vite`: passed.
  - `corepack pnpm run test:e2e tests/e2e/chat-session-handoff.spec.ts`:
    passed, 2 tests; verifies the handoff dialog shows the read-only context
    recall source and the draft includes recall-backed content.
  - `corepack pnpm exec playwright test tests/e2e/language-russian.spec.ts
    --reporter=line`: passed, 4 tests after rebuilding the bundle.
- Remaining known blockers:
  - `corepack pnpm run test:e2e` first hit the external 15-minute command
    timeout without a final Playwright result.
  - A follow-up full `corepack pnpm exec playwright test --reporter=line` with
    the timeout widened completed in 19.6 minutes with 124 passed, 2 skipped,
    and 32 failed tests. Failures are broad UI/E2E drift outside the Context/CRK
    closure surface, including billing chart bars, channel binding row
    selectors, effort button availability, visual snapshot dimensions, chat file
    diff background color, long-task/new-session/scroll/fork/work-context
    expectations, workspace panels, and work-mode `promptMode` payload
    assertions.
  - Because those 32 failures are not isolated to handoff/recall or the
    Host API boundary repaired here, this checkpoint closes the Context/CRK
    focused and repo-wide unit gates. Per the 2026-07-09 decision, those UI E2E
    failures are parked as UI/worktree drift and are not treated as backend
    closure blockers.

## 2026-11-03 Inline/Spill retention development checkpoint

- The default truncation references remain archive-backed and bounded. The
  follow-up retention policy is explicitly off by default through
  `runtime.contextFamily.archiveRecallRetention.enabled`.
- The real recall tool issues provenance only after checksum/session checks.
  The pruner and replacement planner use it for `ageTurns < 4`, at most 16000
  visible characters total, and only when the existing budget can fit it.
  Already-trimmed results, ordinary tools, user content, and assistant reasoning
  get no added retention. No store, timer, queue, or re-injection is introduced.
- The legacy pruner negative control was captured before implementation at
  commit `10dd6c472`. The frozen `off-mode-baseline.json` is replayed by current
  tests; metadata is never counted as provider-visible text.
- Development proof passed 36 retention tests, one malformed-provider evidence
  test, 10 would-trim tests, and 126 config-parity tests. Replay/precheck retain
  minimal verified lineage; eligible sources are selected before conversion and
  final budgets are planned afterward with transient lineage removed before
  dispatch. Existing call-id rewrites carry only a previously valid binding.
  Guarded disk reload covers large ASCII/CJK pages; multi-block budget failures
  fall back to the existing unprotected plan. The evaluator retains real JSONL.
  Multiple fitting recalls share the total cap, converter-added text remains
  bounded, and masking replacements follow the enabled conversion boundary.
  Retained pages do not consume truncation notices; actual budget pressure
  releases the oldest protected page first through the existing planner.
  This is a development checkpoint, not final acceptance.
- Final deterministic/live-provider results, raw transcripts, source hashes,
  command records, credential scan, and recovery index are retained under
  `harness/specs/fixtures/context-inline-spill/`; closure depends on reading
  those refreshed artifacts and completing the spec-declared gates.
- Autonomous model recall selection, full-loop continuation, lossless full
  summarization, product/default graduation, and GA are not claimed.
