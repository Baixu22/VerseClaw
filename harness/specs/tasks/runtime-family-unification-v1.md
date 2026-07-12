---
id: runtime-family-unification-v1
title: Runtime Family Unification v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Establish the Runtime Family spine as a diagnostic-only runtime substrate plan before any implementation, preserving existing renderer, Main, Gateway, host-api, api-client, Memory, Context, AgentMap, CVK, and legacy runtime authority boundaries.
touchedAreas:
  - harness/specs/tasks/runtime-family-unification-v1.md
  - openclaw_runtime/src/runtime-spine/**
  - openclaw_runtime/src/agents/clawgraph/runtime.ts
  - openclaw_runtime/src/agents/clawgraph/compiler.ts
  - openclaw_runtime/src/gateway/server-methods/clawgraph-methods.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts
  - openclaw_runtime/src/runtime-core/registries.ts
  - openclaw_runtime/src/agents/tool-policy-pipeline.ts
  - openclaw_runtime/src/agents/tool-policy-audit.ts
  - openclaw_runtime/src/agents/tool-allowlist-guard.ts
  - openclaw_runtime/src/runtime-core/event-log.ts
  - openclaw_runtime/src/runtime-core/event-log-persistence.ts
  - openclaw_runtime/src/runtime-core/event-log-controlled-dual-read-resume-pilot.ts
  - openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts
  - openclaw_runtime/src/runtime-core/failure-evidence-replay-contracts.ts
  - openclaw_runtime/src/runtime-core/failure-replay-harness-core.ts
  - openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts
  - openclaw_runtime/src/runtime-core/failure-evidence-envelope-summary.ts
  - openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - openclaw_runtime/src/runtime-core/checkpoint-serializer.ts
  - openclaw_runtime/src/runtime-core/resume-shadow.ts
  - openclaw_runtime/src/runtime-core/shadow-safety-boundary.ts
expectedUserBehavior:
  - No user-visible runtime behavior changes during Phase 0.
  - Later Runtime Family work remains diagnostic-only until a follow-up task spec explicitly promotes authority.
  - Existing renderer, Main, Gateway transport, host-api, api-client, Memory, Context, AgentMap, CVK, ClawGraph, AST, tool, event-log, failure, verification, and checkpoint behavior remains authoritative.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-family-unification-v1.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-family-unification-v1.md --since knowledge-ux-polish
  - node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-family-unification-v1.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-family-unification-v1.md --since knowledge-ux-polish
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
acceptance:
  - Phase 0 only adds or updates harness spec files.
  - Phase 0 does not create `openclaw_runtime/src/runtime-spine/`.
  - Phase 0 confirms the current branch is `codex/runtime-substrate-lifecycle`.
  - Phase 0 confirms Runtime Family target files have no diff against `knowledge-ux-polish`.
  - Phase 0 records the hard constraints, WP1-WP5 work packages, target file inventory, acceptance checklist, repository adaptation notes, and staged execution plan.
  - All future Runtime Family v1 behavior is `diagnostic_only` unless a later task spec explicitly authorizes promotion.
---

# Runtime Family Unification v1

This task is the durable harness entry point for the Runtime Family Unification
v1 work order from
`C:/Users/27933/.codex/attachments/19a54900-4918-4b67-9440-37e0b2f5ea01/pasted-text.txt`.

Phase 0 is planning, specification, and audit only. It must not implement
`runtime-spine` business code.

## Baseline Audit

Phase 0 must record these checks before implementation phases begin:

- `git status --short --branch` must show branch `codex/runtime-substrate-lifecycle`.
- `openclaw_runtime/src/runtime-spine/` must not exist during Phase 0.
- Diff against `knowledge-ux-polish` for the Runtime Family target files must be empty.
- The worktree must not be switched to another branch.
- No new worktree may be created.
- No operation may be performed in the `knowledge-ux-polish` worktree.

## Hard Constraints

All phases inherit these constraints:

- Every new Runtime Family behavior must be `diagnostic_only`.
- Do not cut over active execution or make any spine/shadow/pilot component authoritative.
- Do not change renderer, Main, or Gateway transport behavior.
- Do not change `src/lib/host-api.ts` or `src/lib/api-client.ts`.
- Do not touch Memory, Context, AgentMap, or CVK files.
- Do not delete existing files.
- Do not modify existing public export signatures.
- Do not treat `mutation_evidence` as `completion_evidence`.
- Do not add direct renderer Gateway HTTP calls or direct renderer IPC invokes.
- Do not add internal try-catch-swallow behavior inside shadow/pilot components; use the shared shadow safety boundary adapter for diagnostic isolation.
- Do not use the `uuid` package for new spine code. Use `randomUUID()` from `node:crypto`.
- Every new `openclaw_runtime/src/runtime-spine/**` file must start with:

```ts
// @runtime-family v1.0
// @authority diagnostic_only
// @owner WPn
```

Existing files that are marked deprecated in later phases may only receive a
deprecation header and narrowly scoped diagnostic wiring allowed by this spec:

```ts
// @deprecated replaced-by <new runtime-spine path>
// @migration-guide <one-sentence migration note>
```

They must not be deleted and their internal authoritative logic must not be
rewritten.

## Repository Adaptation Notes

The attachment includes pseudocode that must be adapted to the actual codebase:

- Use `randomUUID()` from `node:crypto`; do not add or import `uuid`.
- `openclaw_runtime/src/runtime-core/shadow-safety-boundary.ts` exposes
  `runShadow()`. It is not the synchronous `shadowSafetyBoundary.execute()`
  object shown in the attachment pseudocode.
- Later implementation must add
  `openclaw_runtime/src/runtime-spine/shadow-safety-boundary-adapter.ts` to
  adapt spine code to `runShadow()` without modifying
  `openclaw_runtime/src/runtime-core/shadow-safety-boundary.ts`.
- Legacy runtime owners remain authoritative: ClawGraph in-memory run state,
  existing AST apply behavior, MCP/tool registry behavior, event-log storage,
  checkpoint serialization, failure intelligence shadows, and verification
  shadows.

## Runtime Spine File Inventory

Later phases must create these new files under
`openclaw_runtime/src/runtime-spine/`:

- `types.ts`
- `lifecycle-engine.ts`
- `event-bus.ts`
- `evidence-ledger.ts`
- `failure-contract.ts`
- `gate-engine.ts`
- `shadow-safety-boundary-adapter.ts`
- `index.ts`
- `checkers/tool-policy-checker.ts`
- `checkers/verification-checker.ts`
- `diagnostics/spine-health.ts`
- `diagnostics/spine-inventory.ts`
- `__tests__/lifecycle-engine.test.ts`
- `__tests__/event-bus.test.ts`
- `__tests__/evidence-ledger.test.ts`
- `__tests__/failure-contract.test.ts`
- `__tests__/gate-engine.test.ts`
- `__tests__/cross-component-flow.test.ts`

Later phases may only make narrowly scoped diagnostic additions to these
existing files:

- `openclaw_runtime/src/agents/clawgraph/runtime.ts`
- `openclaw_runtime/src/gateway/server-methods/clawgraph-methods.ts`
- `openclaw_runtime/src/runtime-core/ast-edit-plan.ts`
- `openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts`
- `openclaw_runtime/src/runtime-core/registries.ts`
- `openclaw_runtime/src/runtime-core/event-log-persistence.ts`
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
- `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts`

Later phases may add deprecation headers only to these existing files:

- `openclaw_runtime/src/runtime-core/event-log-controlled-dual-read-resume-pilot.ts`
- `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts`
- `openclaw_runtime/src/agents/tool-policy-audit.ts`
- `openclaw_runtime/src/agents/tool-allowlist-guard.ts`
- `openclaw_runtime/src/runtime-core/failure-replay-harness-core.ts`
- `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts`
- `openclaw_runtime/src/runtime-core/failure-evidence-envelope-summary.ts`
- `openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`
- `openclaw_runtime/src/runtime-core/resume-shadow.ts`

`openclaw_runtime/src/agents/clawgraph/compiler.ts`,
`openclaw_runtime/src/agents/tool-policy-pipeline.ts`,
`openclaw_runtime/src/runtime-core/event-log.ts`,
`openclaw_runtime/src/runtime-core/failure-evidence-replay-contracts.ts`, and
`openclaw_runtime/src/runtime-core/shadow-safety-boundary.ts` are inventory or
adapter reference points. They must not be changed unless a later phase states
an explicit diagnostic-only reason and preserves exports.

## Work Packages

### WP1: Spine Core

WP1 creates the core diagnostic-only spine modules:

- `types.ts`: lifecycle, event, evidence, failure, and gate contracts.
- `lifecycle-engine.ts`: in-memory lifecycle entities and allowed transitions.
- `event-bus.ts`: bounded diagnostic event buffer, handlers, and persistence adapter seam.
- `evidence-ledger.ts`: evidence envelopes and type guards that distinguish `mutation_evidence` from `completion_evidence`.
- `failure-contract.ts`: deterministic failure classification and routing contract.
- `gate-engine.ts`: diagnostic-only gate checks that never actively block legacy behavior.
- `shadow-safety-boundary-adapter.ts`: adapter over existing `runShadow()`.
- `index.ts`: additive spine exports only.

WP1 must finish before WP2, WP3, and WP4 start.

### WP2: ClawGraph Integration

WP2 adds diagnostic-only `[SPINE]` lifecycle/event/gate/failure observation to
ClawGraph runtime paths while leaving existing ClawGraph state and Gateway
methods authoritative.

Allowed target files:

- `openclaw_runtime/src/agents/clawgraph/runtime.ts`
- `openclaw_runtime/src/gateway/server-methods/clawgraph-methods.ts`

### WP3: AST and Tool Integration

WP3 connects AST edit plan and tool policy paths to diagnostic-only spine
records. AST apply remains legacy-authoritative. MCP/tool registry behavior and
response shapes remain unchanged.

Allowed target files:

- `openclaw_runtime/src/runtime-core/ast-edit-plan.ts`
- `openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts`
- `openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts`
- `openclaw_runtime/src/runtime-core/registries.ts`
- `openclaw_runtime/src/agents/tool-policy-pipeline.ts`
- `openclaw_runtime/src/agents/tool-policy-audit.ts`
- `openclaw_runtime/src/agents/tool-allowlist-guard.ts`
- `openclaw_runtime/src/runtime-spine/checkers/tool-policy-checker.ts`

### WP4: Event, Failure, Verification, and Checkpoint Closure

WP4 adds diagnostic-only spine observation around event persistence, failure
classification, verification checks, and checkpoint resume comparison. Legacy
event log, checkpoint, failure, and verification behavior remains
authoritative.

Allowed target files:

- `openclaw_runtime/src/runtime-core/event-log-persistence.ts`
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
- `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts`
- `openclaw_runtime/src/runtime-core/failure-evidence-replay-contracts.ts`
- `openclaw_runtime/src/runtime-core/failure-replay-harness-core.ts`
- `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts`
- `openclaw_runtime/src/runtime-core/failure-evidence-envelope-summary.ts`
- `openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`
- `openclaw_runtime/src/runtime-core/resume-shadow.ts`
- `openclaw_runtime/src/runtime-spine/checkers/verification-checker.ts`

### WP5: Integration Tests and Diagnostic Reports

WP5 adds spine unit tests, cross-component diagnostic-only flow tests, and
diagnostic inventory/health reports.

Required tests:

- `openclaw_runtime/src/runtime-spine/__tests__/lifecycle-engine.test.ts`
- `openclaw_runtime/src/runtime-spine/__tests__/event-bus.test.ts`
- `openclaw_runtime/src/runtime-spine/__tests__/evidence-ledger.test.ts`
- `openclaw_runtime/src/runtime-spine/__tests__/failure-contract.test.ts`
- `openclaw_runtime/src/runtime-spine/__tests__/gate-engine.test.ts`
- `openclaw_runtime/src/runtime-spine/__tests__/cross-component-flow.test.ts`

Required diagnostics:

- `openclaw_runtime/src/runtime-spine/diagnostics/spine-health.ts`
- `openclaw_runtime/src/runtime-spine/diagnostics/spine-inventory.ts`

## Development Phases

### Phase 0: Baseline and Guardrails

Allowed changes:

- Create or update this harness task spec.
- Run baseline audit commands.
- Do not create `openclaw_runtime/src/runtime-spine/`.
- Do not modify runtime, renderer, Main, Gateway, shared API, docs, or tests.

Validation:

```bash
pnpm harness context --spec harness/specs/tasks/runtime-family-unification-v1.md
pnpm harness validate --spec harness/specs/tasks/runtime-family-unification-v1.md --since knowledge-ux-polish
```

Fallback validation if the pnpm shim times out or fails:

```bash
node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-family-unification-v1.md
node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-family-unification-v1.md --since knowledge-ux-polish
```

### Phase 1: WP1 Spine Core

Entry conditions:

- Phase 0 validation has passed.
- `openclaw_runtime/src/runtime-spine/` still does not exist before the first
  Phase 1 implementation edit.
- The implementation branch is still `codex/runtime-substrate-lifecycle`.
- Target files remain aligned with `knowledge-ux-polish` or any drift has been
  explicitly reviewed before implementation.

Deliverables:

- Create WP1 spine core files.
- Use `randomUUID()` from `node:crypto`.
- Adapt to existing `runShadow()` through
  `runtime-spine/shadow-safety-boundary-adapter.ts`.
- Keep all behavior diagnostic-only.

### Phase 2: WP1 Unit Tests

Deliverables:

- Add focused tests for lifecycle, event bus, evidence ledger, failure
  contract, gate engine, and shadow boundary adapter behavior.
- Prove invalid lifecycle transitions return errors rather than throwing.
- Prove `mutation_evidence` cannot be used as `completion_evidence`.

### Phase 3: WP2 ClawGraph Integration

Deliverables:

- Add diagnostic-only `[SPINE]` observation to ClawGraph runtime and Gateway
  method paths.
- Preserve ClawGraph authoritative state, response shapes, and Gateway method
  contracts.
- Do not change renderer, Main, host-api, api-client, or transport policy.

### Phase 4: WP3 AST and Tool Integration

Deliverables:

- Add diagnostic-only AST scan/plan/apply events and mutation evidence.
- Add diagnostic-only tool invocation and policy gate records.
- Preserve existing AST apply, tool registry, MCP call, approval, retry, error,
  and return payload behavior.

### Phase 5: WP4 Event, Failure, Verification, and Checkpoint Closure

Deliverables:

- Add diagnostic-only event persistence adapter registration.
- Add diagnostic-only failure contract synchronization.
- Add diagnostic-only verification checker.
- Add diagnostic-only checkpoint event-bus rebuild comparison.
- Preserve legacy event log, failure intelligence, verification shadow, and
  checkpoint authority.

### Phase 6: WP5 Integration Tests and Diagnostic Reports

Deliverables:

- Add the WP5 unit and cross-component flow tests.
- Add `spine-health.ts` and `spine-inventory.ts`.
- Prove all new files include the required Runtime Family header.
- Prove diagnostic reports execute without changing runtime behavior.

### Phase 7: Final Verification and Closure

Required checks:

- `pnpm run typecheck`
- Focused Runtime Family unit and integration tests.
- `pnpm test` when practical for the touched runtime area.
- `pnpm run comms:replay` and `pnpm run comms:compare` if any communication
  path, Gateway event, runtime send/receive, delivery, or fallback behavior is
  touched.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; update them
  only if behavior, flows, interfaces, or user-visible docs changed.
- Verify no forbidden path categories changed.
- Verify no existing public export signatures changed.
- Verify no shadow/pilot component became authoritative.
- Verify `mutation_evidence` is never accepted where `completion_evidence` is
  required.

## Acceptance Checklist

Global final acceptance requires:

- All required runtime-spine files exist after implementation phases.
- All required WP5 tests pass.
- `spine-health.ts` can generate a report without runtime errors.
- `spine-inventory.ts` matches actual connected files.
- All new files include `@runtime-family v1.0` and
  `@authority diagnostic_only`.
- No production `console.log` is introduced.
- Memory, Context, AgentMap, and CVK files have zero changes.
- Renderer, Main, Gateway transport, host-api, and api-client behavior has zero
  changes unless a later explicit spec authorizes a separate bridge.
- Existing public export signatures have zero changes.
- No shadow/pilot component is promoted to authoritative behavior.
- `gate-engine.ts` defaults to `diagnostic_only`.
- Full project typecheck has zero errors.
- Required test suites have zero failures.
