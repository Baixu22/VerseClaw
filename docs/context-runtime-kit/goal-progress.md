# Context Runtime Kit Goal Progress

## Baseline Audit

- Branch: `codex/sekb-runtime-knowledge`
- Workspace isolation: normal repository checkout, not a linked worktree.
- Existing dirty state before Phase 1 edits:
  - `docs/context-runtime-kit/` (untracked control pack)
  - `docs/superpowers/plans/2026-07-06-context-runtime-kit.md` (untracked plan)
  - `harness/specs/rules/context-runtime-kit-boundary.md` (untracked rule)
  - `harness/specs/scenarios/context-runtime-kit.md` (untracked scenario)
  - `harness/specs/tasks/context-runtime-kit.md` (untracked task spec)
- Unrelated dirty changes identified: none yet; all existing untracked files appear to be Context Runtime Kit control-pack inputs.
- Later unrelated dirty changes observed and left untouched:
  - `docs/enhancements/sekb-mvp.md` (modified)
  - `harness/specs/tasks/sekb-mvp.md` (modified)
  - `docs/enhancements/sekb-runtime-roadmap.md` (untracked)
  - `harness/specs/guides/sekb-long-task-stages.md` (untracked)
  - `harness/specs/rules/sekb-runtime-development-loop.md` (untracked)
  - `harness/specs/tasks/sekb-runtime-long-task-development.md` (untracked)
  - `openclaw_runtime/src/knowledge/sekb/sekb.test.ts` (modified)
  - `openclaw_runtime/src/knowledge/sekb/harness-integration.ts` (modified)

## Phase 1: Protocol Types and Artifact Shape

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-01-protocol-types.md`.
- Allowed changes extracted:
  - Add `shared/types/context-runtime-kit.ts` or equivalent shared type file.
  - Add pure validation helpers colocated with the type module.
  - Add unit tests under `tests/unit/**`.
  - Clarify P1 harness/docs if needed.
- Forbidden changes extracted:
  - No CVK compiler, selector resolver backed by artifacts, router/provider registry, tool-call gate, prompt assembly, `CompressionArtifact` schema, host API, renderer, storage, or runtime behavior changes.
- Required tests extracted:
  - Focused Vitest contract tests for serialization and invalid ids/selectors/checksums/ranges/hard-claim evidence refs.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`.
  - `corepack pnpm run typecheck`.
  - `git diff --check -- <phase-owned-files>`.
- Short plan:
  1. Write a focused failing unit test for the Phase 1 protocol contract API.
  2. Confirm RED is missing contract implementation, not a test typo.
  3. Implement the minimum shared type/validation module.
  4. Run the focused test to GREEN.
  5. Run harness validation, typecheck, and diff whitespace checks.
  6. Review changed files for forbidden runtime behavior.
- Changed files:
  - `shared/types/context-runtime-kit.ts`: additive protocol types and pure validation/normalization helpers for `ResourceId`, `Selector`, `Chunk`, `CompactView`, `CvkEvidenceRef`, `RetrievalTraceEntry`, `PromptBundle`, and `VerificationResult`.
  - `tests/unit/context-runtime-kit-contracts.test.ts`: focused Phase 1 unit coverage for stable serialization, invalid ids/selectors/checksums/ranges, hard-claim evidence refs, and deterministic selector list normalization.
  - `docs/context-runtime-kit/goal-progress.md`: phase progress and evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../shared/types/context-runtime-kit"`, confirming the missing Phase 1 contract module.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 4 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- shared/types/context-runtime-kit.ts tests/unit/context-runtime-kit-contracts.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - No prompt, tool-call, host-api, renderer, storage, compaction, provider registry, selector resolver, compiler, or runtime behavior path was modified.
  - The module is additive and currently imported only by the focused unit test.
  - Existing untracked `docs/superpowers/specs/2026-07-06-p0-p1-remaining-multi-agent-design.md` is unrelated to this phase and was not modified.

## Phase 2: Tool / Skill / Project Rule Compiler

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-02-tool-skill-rule-compiler.md`.
- Allowed changes extracted:
  - Add a scoped compiler under `openclaw_runtime/src/context-engine/cvk/**`.
  - Add fixture sources under `tests/fixtures/context-runtime-kit/**`.
  - Add focused unit tests under `tests/unit/**`.
  - Add build report helpers/types needed by the compiler.
- Forbidden changes extracted:
  - No prompt assembly integration, provider registry activation, tool-call blocking, runtime artifact persistence outside fixtures, LLM extraction, or runtime mutation of skills/tools/rules/project docs.
- Required tests extracted:
  - Failing fixture tests for SC = 100%, RRR = 100%, AR = 100%, no LLM dependency, deterministic selector names, and changed source checksum behavior.
  - `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`.
  - `corepack pnpm run typecheck`.
  - `git diff --check -- <phase-owned-files>`.
- Short plan:
  1. Add fixture data for tool schema, skill, and project rule sources.
  2. Write a focused failing compiler test against the desired fixture-level API.
  3. Confirm RED is missing compiler implementation.
  4. Implement the minimum deterministic fixture compiler.
  5. Run the focused compiler test to GREEN.
  6. Run harness validation, typecheck, and diff checks.
  7. Review changed files for forbidden runtime behavior.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/compiler.ts`: pure fixture compiler that emits resources, chunks, selector index entries, checksums, compact views, and a build report without live runtime integration.
  - `tests/fixtures/context-runtime-kit/compiler.fixture.json`: deterministic fixture source data for tool schema, skill, AGENTS-style project rules, and selected harness boundary rules.
  - `tests/unit/context-runtime-kit-compiler.test.ts`: focused compiler tests for SC/RRR/AR, no LLM dependency, deterministic selectors, and checksum/source drift.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-compiler.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/compiler"`, confirming the missing fixture compiler.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-compiler.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 2 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts --reporter=verbose`
  - Result: passed, 2 test files, 6 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/compiler.ts tests/fixtures/context-runtime-kit/compiler.fixture.json tests/unit/context-runtime-kit-compiler.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - No prompt assembly, provider registry, live tool-call path, runtime artifact persistence, LLM extraction, or runtime mutation path was modified.
  - Compiler output is returned in memory for fixture tests only.
  - Compact views are navigation-only and expose hard selectors; they are not consumed by any live runtime path.

## Phase 3: Selector Resolver and Checksum Verifier

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-03-selector-resolver.md`.
- Allowed changes extracted:
  - Add resolver module inside the scoped CRK/CVK implementation area.
  - Add resolver diagnostics and result types.
  - Add unit tests and fixtures for selector resolution.
- Forbidden changes extracted:
  - No active prompt retrieval, active tool-call blocking, runtime storage migration, CompressionArtifact integration, or UI exposure.
- Required tests extracted:
  - Valid selector resolution.
  - Missing selector.
  - Stale selector.
  - Ambiguous selector.
  - Wrong resource id.
  - Checksum mismatch.
  - Batch resolution order and per-item diagnostics.
- Short plan:
  1. Write focused resolver tests against compiler fixture artifacts.
  2. Confirm RED is missing resolver implementation.
  3. Implement in-memory selector resolution and checksum verification only.
  4. Run resolver and CRK regression tests to GREEN.
  5. Run required typecheck and phase diff checks, plus harness validation for continuity.
  6. Review for no prompt/tool/runtime consumption.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/resolver.ts`: in-memory selector resolver and checksum verifier with deterministic fail-closed diagnostics.
  - `tests/unit/context-runtime-kit-resolver.test.ts`: focused tests for valid, missing, stale, ambiguous, wrong-resource, checksum mismatch, hard-claim missing checksum, and batch order behavior.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-resolver.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/resolver"`, confirming the missing resolver.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-resolver.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 3 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts --reporter=verbose`
  - Result: passed, 3 test files, 9 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/resolver.ts tests/unit/context-runtime-kit-resolver.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - Resolver consumes in-memory fixture artifacts only; no prompt retrieval, tool blocking, storage migration, CompressionArtifact integration, or UI exposure was added.
  - Hard claims without checksums fail closed.
  - Batch resolution preserves caller order and returns per-item diagnostics.

## Phase 4: View Generator and Lazy Exposure

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-04-view-generator.md`.
- Allowed changes extracted:
  - Add view generation module in the scoped CRK/CVK area.
  - Add fixture resources for tools, skills, and rules.
  - Add unit tests for view content and deterministic token estimates.
- Forbidden changes extracted:
  - No default prompt replacement, active lazy skill/tool exposure in live runs, tool-call enforcement, or runtime provider registry activation except test-only construction.
- Required tests extracted:
  - Navigation-only marker on every view.
  - Source-backed selectors for hard facts.
  - Tool compact views include all required selector families.
  - 50-skill fixture exposes registry view only by default.
  - Selected skill expands only required workflow selectors.
  - Token estimate is deterministic.
- Short plan:
  1. Write focused view generator tests against fixture compiler artifacts.
  2. Confirm RED is missing view generator implementation.
  3. Implement registry/compact/raw-selector projection helpers without runtime routing.
  4. Run focused view tests and CRK regression tests to GREEN.
  5. Run required typecheck, harness validation, and diff checks.
  6. Review for no prompt/tool/runtime exposure.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/views.ts`: registry, compact, and raw chunk selector projection helpers for fixture artifacts.
  - `tests/unit/context-runtime-kit-views.test.ts`: focused tests for navigation-only views, checksum-backed hard selectors, tool selector families, 50-skill registry-only default, selected-skill workflow expansion, and deterministic token estimates.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-views.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/views"`, confirming the missing view generator.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-views.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 3 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts tests/unit/context-runtime-kit-views.test.ts --reporter=verbose`
  - Result: passed, 4 test files, 12 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/views.ts tests/unit/context-runtime-kit-views.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - View generation is an in-memory helper only; no default prompt replacement, live lazy exposure, tool-call enforcement, or provider registry activation was added.
  - Default skill exposure is registry-only for the 50-skill fixture.
  - Selected skill compact exposure includes only `skill:required_workflow` selectors.
  - Raw chunk selectors remain excluded by default.

## Phase 5: Context Router Shadow Provider

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-05-shadow-router.md`.
- Allowed changes extracted:
  - Add context-engine shadow provider module.
  - Add provider registry registration behind default-off or test-only flags.
  - Add diagnostics for resource map, compact views, budget report, and retrieval plan.
  - Add tests for prompt parity and diagnostics.
- Forbidden changes extracted:
  - No active prompt replacement, tool-call blocking, user-visible behavior changes, host-api exposure, renderer/UI changes.
- Required tests extracted:
  - Flag-off prompt parity.
  - Shadow diagnostics without changing prompt messages.
  - Omitted resources and reasons in budget report.
  - Provider failure does not change legacy execution.
- Short plan:
  1. Write focused shadow provider tests against fixture artifacts and legacy message arrays.
  2. Confirm RED is missing shadow provider implementation.
  3. Implement a default-off/test-invoked CRK shadow provider and pilot runner.
  4. Run focused shadow tests and CRK regression tests to GREEN.
  5. Run harness validation, typecheck, and diff checks.
  6. Review for no live prompt/tool/UI/host exposure.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/shadow-provider.ts`: default-off/test-invoked Context Runtime Kit shadow provider and pilot runner that emits diagnostics only.
  - `tests/unit/context-runtime-kit-shadow-provider.test.ts`: focused tests for flag-off prompt parity, shadow diagnostics, budget omissions, and isolated provider failure.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-shadow-provider.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/shadow-provider"`, confirming the missing shadow provider.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-shadow-provider.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 4 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts tests/unit/context-runtime-kit-views.test.ts tests/unit/context-runtime-kit-shadow-provider.test.ts --reporter=verbose`
  - Result: passed, 5 test files, 16 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/shadow-provider.ts tests/unit/context-runtime-kit-shadow-provider.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - The CRK shadow provider is default-off and invoked only by tests/pilot helper; it is not registered into live prompt assembly.
  - Diagnostics include `shadowOnly: true`, `legacyAuthoritative: true`, resource map, compact views, budget report, and retrieval plan metadata.
  - Provider failure returns fallback diagnostics and preserves legacy message/prompt references.
  - No host-api, renderer/UI, active tool-call, or user-visible behavior path was modified.

## Phase 6: Tool Call Gate

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-06-tool-call-gate.md`.
- Allowed changes extracted:
  - Add tool gate policy and report-only verifier.
  - Add tests and fixtures for tool schemas.
  - Add diagnostics for missing selectors.
  - Active blocking only with explicit evidence/rollback; not planned for this phase implementation.
- Forbidden changes extracted:
  - No silent tool-call blocking, tool permission expansion, MCP tool list changes, spawn arg/fallback/approval/retry/transport changes, or UI changes.
- Required selector families:
  - required, enum, type, default, nullable, permission, side-effect.
- Required tests extracted:
  - Report-only missing selector diagnostics for every required family.
  - All selectors present pass.
  - Missing selectors are returned in deterministic order.
- Short plan:
  1. Write focused report-only tool gate tests against the tool schema fixture.
  2. Confirm RED is missing gate implementation.
  3. Implement deterministic selector-family policy and report-only verifier.
  4. Run focused gate tests and CRK regression tests to GREEN.
  5. Run harness validation, typecheck, and diff checks.
  6. Review for no active tool/MCP behavior changes.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts`: pure report-only selector-family verifier that produces deterministic would-block diagnostics.
  - `tests/unit/context-runtime-kit-tool-call-gate.test.ts`: focused tests for missing required/enum/type/default/nullable/permission/side-effect selectors, all-selectors pass, and deterministic missing order.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-tool-call-gate.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/tool-call-gate"`, confirming the missing report-only gate.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-tool-call-gate.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 9 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts tests/unit/context-runtime-kit-views.test.ts tests/unit/context-runtime-kit-shadow-provider.test.ts tests/unit/context-runtime-kit-tool-call-gate.test.ts --reporter=verbose`
  - Result: passed, 6 test files, 25 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts tests/unit/context-runtime-kit-tool-call-gate.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - Gate mode is `report_only` only; no active blocking path was implemented.
  - No MCP tool list, permission expansion, spawn args, fallback, approval, retry, transport, host-api, renderer, or UI path was modified.
  - Missing selectors are ordered by required family order: required, enum, type, default, nullable, permission, side-effect.

## Phase 7: CompressionArtifact Integration

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-07-compression-artifact-integration.md`.
- Allowed changes extracted:
  - Add additive artifact fields.
  - Add compatibility tests.
  - Add projection logic for evidence refs, blockers, failed attempts, unverified claims, and required selectors.
  - Add recovery fixtures.
- Forbidden changes extracted:
  - No removing/renaming existing artifact fields, no authoritative summary text, no embedding large durable facts when selector refs are available, no auto-mutation of Task Ledger/ClawGraph/Memory/Knowledge/workflow state.
- Required additive fields:
  - Retrieved context refs, required selectors, capability activations, unverified claims, stale references, retrieval traces.
- Required tests extracted:
  - Old artifact fixtures deserialize.
  - New fields are optional.
  - Evidence refs survive compaction.
  - Unverified claims remain visibly uncertain.
  - Failed attempts and blockers survive projection.
  - Large chunks are not embedded when selector refs are available.
  - Stale refs are marked.
- Short plan:
  1. Write focused compression artifact CRK tests around existing artifact functions.
  2. Confirm RED shows missing additive field behavior.
  3. Add optional CRK fields and normalization/projection helpers without breaking v1.
  4. Run existing compression artifact tests plus CRK tests to GREEN.
  5. Run harness validation, typecheck, and diff checks.
  6. Review for no durable owner mutation or large fact absorption.
- Changed files:
  - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`: additive optional CRK evidence/ref fields, retrieval traces, capability activations, stale refs, retention metric helper, and projection sections.
  - `tests/unit/context-runtime-kit-compression-artifact.test.ts`: focused compatibility/projection tests for optional fields, refs, uncertainty, blockers, failed attempts, stale refs, and no large durable fact embedding.
  - `tests/unit/context-compression-eval.test.ts`: evidence-retention eval compatibility test added because the required test path was absent in the current tree.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-compression-artifact.test.ts --reporter=verbose`
  - Result: failed with `calculateCompressionEvidenceRetentionRate is not a function`, confirming missing CRK artifact retention support.
  - Additional required eval RED: `corepack pnpm exec vitest run tests/unit/context-compression-eval.test.ts --reporter=verbose`
  - Result: failed with `No test files found`, confirming the required eval compatibility test path was absent.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-compression-artifact.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 2 tests.
  - Command: `corepack pnpm exec vitest run tests/unit/context-compression-eval.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 2 tests.
  - Required compression bundle: `corepack pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts --reporter=verbose`
  - Result: passed, 3 test files, 7 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-compression-eval.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors; Git emitted an LF-to-CRLF warning for the touched compaction file.
- Review notes:
  - Existing `CompressionArtifact v1` fields were not removed or renamed.
  - New CRK fields are optional and old artifact payloads normalize without them.
  - Projection shows selectors, uncertainty, blockers, failed attempts, stale references, and retrieval traces; it does not embed `largeDurableFacts`.
  - No Task Ledger, ClawGraph, Memory, Knowledge, host-api, renderer, or workflow mutation path was added.

## Phase 8: Recovery Context Integration

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-08-recovery-context.md`.
- Allowed changes extracted:
  - Add recovery projection builder.
  - Add recovery verifier.
  - Add recovery tests and benchmark fixtures.
  - Add report-only recovery diagnostics before active recovery behavior.
- Forbidden changes extracted:
  - No silent stale ref trust, no global transcript replay replacement without pilot flag, no hidden missing required selectors, no durable task truth mutation from compact summaries.
- Required projection content:
  - Resource map, required selectors, unresolved/unverified claims, blockers, failed attempts, next action, stale/missing reference diagnostics.
- Required tests extracted:
  - Recovery succeeds from compact projection plus selectors.
  - Recovery fails visibly when required selectors are missing.
  - Stale code/doc refs are marked.
  - Failed attempts are not repeated.
  - Uncertainty survives recovery.
- Short plan:
  1. Write focused recovery context tests using compression artifacts and fixture CVK artifacts.
  2. Confirm RED is missing recovery implementation.
  3. Implement report-only recovery projection/verifier with rollback metadata.
  4. Run focused recovery tests and required eval tests to GREEN.
  5. Run harness validation, typecheck, and diff checks.
  6. Review for no global recovery replacement or durable truth mutation.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/recovery.ts`: report-only recovery projection and verifier from `CompressionArtifact` plus CVK selectors, with rollback metadata.
  - `tests/unit/context-runtime-kit-recovery-context.test.ts`: focused tests for selector-backed recovery, visible missing selector failure, stale document/code reference marking, failed-attempt avoidance, and uncertainty retention.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-recovery-context.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/recovery"`, confirming the missing recovery module.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-recovery-context.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 3 tests.
  - Required eval/recovery command: `corepack pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts --reporter=verbose`
  - Result: passed, 2 test files, 5 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/recovery.ts tests/unit/context-runtime-kit-recovery-context.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - Recovery integration is report-only and does not replace existing transcript replay globally.
  - Missing/stale selectors are visible diagnostics, not silently trusted.
  - Projection includes resource map, required selectors, blockers, failed attempts, unverified claims, next action, and rollback strategy.
  - No durable task truth or external owner is mutated from compact summaries.

## Phase 9: Codebase Index MVP

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-09-codebase-index.md`.
- Allowed changes extracted:
  - Add codebase index module.
  - Add fixture repositories/files.
  - Add unit tests for symbol and line-range selectors.
  - Add staleness tracking based on content hash or commit hash.
- Forbidden changes extracted:
  - No full semantic call graph requirement, LLM extraction, active prompt routing without later flag, or cross-language SDK work.
- Required selectors:
  - `code:file.<path>#L<start>-L<end>`, `code:symbol.<symbol_name>`, cheap import hints, deterministic related-test selectors.
- Required tests extracted:
  - File line-range selector resolution.
  - Symbol selector resolution.
  - Stable selectors across identical input builds.
  - Changed source marks old refs stale or creates a new resource version.
  - Related-test mapping deterministic when available.
  - Missing symbols fail closed.
- Short plan:
  1. Write focused codebase index tests using small in-memory fixture files.
  2. Confirm RED is missing codebase index implementation.
  3. Implement deterministic file/symbol/import/related-test indexing and resolver.
  4. Run focused codebase index tests and CRK regression tests to GREEN.
  5. Run harness validation, typecheck, and diff checks.
  6. Review for no active routing or full graph expansion.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/codebase-index.ts`: deterministic in-memory codebase index for file ranges, symbols, import hints, related-test selectors, and stale resource detection.
  - `tests/unit/context-runtime-kit-codebase-index.test.ts`: focused tests for line-range resolution, symbol resolution, selector stability, source-change staleness, deterministic related-test mapping, and missing-symbol fail-closed behavior.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-codebase-index.test.ts --reporter=verbose`
  - Result: failed before implementation with `Failed to resolve import "../../openclaw_runtime/src/context-engine/cvk/codebase-index"`, confirming the missing codebase index.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-codebase-index.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 4 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-codebase-index.test.ts tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts tests/unit/context-runtime-kit-views.test.ts tests/unit/context-runtime-kit-shadow-provider.test.ts tests/unit/context-runtime-kit-tool-call-gate.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts --reporter=verbose`
  - Result: passed, 9 test files, 34 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git diff --check -- openclaw_runtime/src/context-engine/cvk/codebase-index.ts tests/unit/context-runtime-kit-codebase-index.test.ts docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - Indexing is deterministic and fixture/in-memory only; no active prompt routing or live context injection was added.
  - Source changes create a new resource version and old refs fail with `stale_resource`.
  - Missing symbols fail closed.
  - No full semantic call graph, language server daemon, cross-language SDK, or LLM extraction was added.

## Phase 10: Eval and Reporting

- Status: complete and ready for review.
- Constraint file read: `docs/context-runtime-kit/phase-constraints/phase-10-eval-reporting.md`.
- Allowed changes extracted:
  - Add evaluation fixtures, metric calculators, report generation helpers/scripts, report shape tests, and secret scan integration for generated artifacts.
- Forbidden changes extracted:
  - No active-behavior promotion solely from token savings, no hiding worst cases behind averages, no happy-path-only report, no default-on rollout without Level 2 gates.
- Required benchmarks:
  - Tool schema, skill routing, project rule, codebase, compact recovery.
- Required tests extracted:
  - Metric formulas.
  - Worst-case failures included.
  - Acceptance gate summaries included.
  - Secret scan catches generated secret-like content.
  - Level 1/2/3 status computed from thresholds.
  - Evidence metrics take priority over TSR.
- Short plan:
  1. Write focused eval/report tests for metrics, gates, worst cases, secret scan, and evidence priority.
  2. Confirm RED is missing eval report implementation.
  3. Implement deterministic eval/report helper with Level 1/2/3 gate decisions.
  4. Run focused eval tests and full CRK regression tests to GREEN.
  5. Run harness validation, typecheck, and diff checks.
  6. Review for no active/default-on promotion.
- Changed files:
  - `openclaw_runtime/src/context-engine/cvk/eval-report.ts`: deterministic metric calculators, required benchmark coverage checks, worst-case failure reporting, Level 1/2/3 gate decisions, evidence-priority gating, and generated artifact secret scanning.
  - `tests/unit/context-runtime-kit-eval-report.test.ts`: focused tests for metric formulas, worst-case failures, acceptance summaries, missing benchmark coverage, secret scanning, Level 1/2/3 decisions, and evidence priority over token savings.
  - `docs/context-runtime-kit/goal-progress.md`: phase evidence ledger.
- RED evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-eval-report.test.ts --reporter=verbose`
  - Result: failed after adding the missing-benchmark acceptance test with `failures: []` instead of `Required benchmark compact_recovery was not provided.`, confirming the report did not name missing required benchmarks.
- GREEN evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-eval-report.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 5 tests.
  - Additional CRK regression command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts tests/unit/context-runtime-kit-views.test.ts tests/unit/context-runtime-kit-shadow-provider.test.ts tests/unit/context-runtime-kit-tool-call-gate.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-codebase-index.test.ts tests/unit/context-runtime-kit-eval-report.test.ts tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts --reporter=verbose`
  - Result: passed, 12 test files, 44 tests.
- Verification evidence:
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git -c core.autocrlf=false diff --check --no-index -- <empty-temp-file> <phase-owned-file>` for `openclaw_runtime/src/context-engine/cvk/eval-report.ts`, `tests/unit/context-runtime-kit-eval-report.test.ts`, and `docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Review notes:
  - Reports include all required benchmarks in acceptance summaries and fail closed when a required benchmark is missing.
  - Gate decisions use worst-case metrics so averages cannot hide a failing fixture.
  - Secret findings block gates before rollout decisions.
  - Evidence metric failures block Level 1 even when token savings are high.
  - No active runtime behavior, default-on rollout, prompt routing, tool execution, host-api, renderer, storage, or communication path was modified.

## Final Completion Audit

- Phase status summary:
  - Phase 1 Protocol Types: complete and ready for review.
  - Phase 2 Tool / Skill / Project Rule Compiler: complete and ready for review.
  - Phase 3 Selector Resolver and Checksum Verifier: complete and ready for review.
  - Phase 4 View Generator and Lazy Exposure: complete and ready for review.
  - Phase 5 Context Router Shadow Provider: complete and ready for review.
  - Phase 6 Tool Call Gate: complete and ready for review.
  - Phase 7 CompressionArtifact Integration: complete and ready for review.
  - Phase 8 Recovery Context Integration: complete and ready for review.
  - Phase 9 Codebase Index MVP: complete and ready for review.
  - Phase 10 Eval and Reporting: complete and ready for review.
- Final verification evidence:
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-eval-report.test.ts --reporter=verbose`
  - Result: passed, 1 test file, 5 tests.
  - Command: `corepack pnpm exec vitest run tests/unit/context-runtime-kit-contracts.test.ts tests/unit/context-runtime-kit-compiler.test.ts tests/unit/context-runtime-kit-resolver.test.ts tests/unit/context-runtime-kit-views.test.ts tests/unit/context-runtime-kit-shadow-provider.test.ts tests/unit/context-runtime-kit-tool-call-gate.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-codebase-index.test.ts tests/unit/context-runtime-kit-eval-report.test.ts tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts --reporter=verbose`
  - Result: passed, 12 test files, 44 tests.
  - Command: `corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md`
  - Result: passed with `Spec is valid: harness\specs\tasks\context-runtime-kit.md`.
  - Command: `corepack pnpm run typecheck`
  - Result: passed for `typecheck:node` and `typecheck:web`.
  - Command: `git -c core.autocrlf=false diff --check --no-index -- <empty-temp-file> <phase-owned-file>` for `openclaw_runtime/src/context-engine/cvk/eval-report.ts`, `tests/unit/context-runtime-kit-eval-report.test.ts`, and `docs/context-runtime-kit/goal-progress.md`
  - Result: passed with no whitespace errors.
- Unresolved blockers: none.
- Unrelated dirty changes left untouched:
  - `docs/enhancements/sekb-mvp.md`
  - `harness/specs/tasks/sekb-mvp.md`
  - `docs/enhancements/sekb-runtime-roadmap.md`
  - `harness/specs/guides/sekb-long-task-stages.md`
  - `harness/specs/rules/sekb-runtime-development-loop.md`
  - `harness/specs/tasks/sekb-runtime-long-task-development.md`
  - `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`
  - `openclaw_runtime/src/knowledge/sekb/harness-integration.ts`
- Completion decision: Context Runtime Kit Phase 1-10 now has a complete RED -> GREEN -> verification -> review ledger, with fresh focused, regression, harness, typecheck, and diff-check evidence.
