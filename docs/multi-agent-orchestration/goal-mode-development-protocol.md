# Role-First Multi-Agent Goal-Mode Development Protocol

## Purpose

This protocol keeps long Goal-mode development auditable. It prevents a worker from widening P0 into scheduler, Agency import, blackboard, synthesizer, or UI work.

## Binding Inputs

A Goal-mode worker must read:

- repository instructions: `AGENTS.md`
- runtime subtree instructions: `openclaw_runtime/AGENTS.md`
- current architecture baseline: `docs/role-first-design.md`
- global multi-agent constraint document: `docs/multi-agent-orchestration-development-plan.md`
- this control pack: `docs/multi-agent-orchestration/**`
- active phase constraint file: `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md`
- active implementation plan: `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md`
- active harness task: `harness/specs/tasks/role-first-p0-verification-loop.md`

If any binding input is missing, the worker must stop before implementation.

## One-Phase Rule

Each Goal run owns one phase.

Allowed:

- Completing all P0 acceptance criteria.
- Adding or updating tests required by P0.
- Updating docs that explain P0 behavior.
- Adding follow-up notes for P1-P4 without implementing them.

Forbidden:

- Implementing later-phase deliverables.
- Creating a second durable architecture source of truth.
- Replacing RoleContract with prompt/persona routing.
- Letting worker output write long-term memory directly.
- Adding open worker-to-worker chat.
- Adding UI unless a separate Goal explicitly authorizes UI and i18n/E2E scope.

## TDD and Evidence Rule

For production behavior, the worker must:

1. Write a focused failing test.
2. Run it and record the expected failure.
3. Implement the smallest change.
4. Rerun the focused test to green.
5. Run the phase gate suite.

For docs/spec edits, the worker must:

1. Run harness context/validate when possible before editing.
2. Edit only the relevant docs/specs.
3. Rerun harness validation.

When the workspace already contains unrelated dirty files, use `pnpm harness validate --spec <spec> --no-diff` only as preflight structural validation. Full validation without `--no-diff` is required before completion in a clean/isolated diff, or the final report must explicitly state that unrelated files blocked full diff validation.

Completion claims require fresh command output from the current Goal run.

## Source-of-Truth Boundaries

Durable policy belongs in:

- `AGENTS.md`
- `openclaw_runtime/AGENTS.md`
- `harness/specs/**`
- `docs/multi-agent-orchestration-development-plan.md`
- `docs/multi-agent-orchestration/**`
- `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md`

Do not add a parallel `.trellis/`, `.agency-runtime/`, or hidden durable planning store.

## Runtime Boundaries

P0 must preserve these boundaries:

- `RoleContract` remains the only runtime role channel.
- Tool and permission authority remains in runtime policy, not prompt text.
- Renderer remains behind host-api/api-client boundaries if any renderer path is touched.
- Worker completion text is runtime evidence, not user instruction and not system instruction.
- Memory candidates are proposals only; they do not bypass Gatekeeper.
- Repair/replan is bounded to one automatic attempt per orchestration run.

## Existing Code Anchors

P0 should work with these existing anchors:

- Planning and task graph: `openclaw_runtime/src/agents/orchestrator.ts`, `openclaw_runtime/src/agents/orchestration-protocol.ts`
- Spawn execution: `openclaw_runtime/src/agents/orchestrator-run.ts`
- Observed execution and trace: `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
- Completion aggregation: `openclaw_runtime/src/agents/agent-steering-queue.ts`
- Tool entrypoint: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- Metadata shape: `openclaw_runtime/src/agents/subagent-registry.types.ts`
- Gateway RPC handlers: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`

P0 should add focused files for result bundle and gates rather than growing one large orchestration file.

## Dirty Worktree Rule

The repository may contain unrelated local changes.

The worker must:

- inspect `git status --short` before edits,
- identify phase-owned files,
- avoid reset, checkout, or revert of user changes,
- stage only phase-owned files when explicitly asked to stage,
- call out unrelated dirty files in the final report.

## Required End-of-Phase Report

The final report must include:

- active phase name,
- files changed and responsibilities,
- tests run and exact results,
- RED -> GREEN evidence,
- acceptance checklist with pass/fail status,
- explicit list of P1-P4 non-goals not implemented,
- unrelated failures or dirty files,
- whether the phase is ready for review.
