---
id: sekb-long-task-stages
title: SEKB Long Task Stages
type: guide
appliesTo:
  - sekb-runtime-long-task-development
  - sekb-mvp
---

Use this guide when a `/goal` run continues SEKB after the v0.2 runtime
knowledge baseline.

## Stage 0: Context And Branch Hygiene

Read `harness/specs/tasks/sekb-runtime-long-task-development.md`,
`harness/specs/rules/sekb-runtime-development-loop.md`,
`docs/enhancements/sekb-mvp.md`, and
`docs/enhancements/sekb-runtime-roadmap.md`. Run the harness context command for
the active task spec, then read any additional files it returns.

Confirm the branch and working tree before editing:

```powershell
git status --short --branch
git log --oneline --decorate -5
```

Exit this stage with a short written status that names the branch, unrelated
dirty files, active SEKB scope, and required validation commands.

## Stage 1: Scope Mapping

Map the user request to one SEKB work category:

- Runtime capture: L3 trajectory start, step logging, finish, compression, cost,
  and error signatures.
- Knowledge store: L2 principle writes, L1 index maintenance, Kysely state
  schema, and lifecycle fields.
- Retrieval: task retrieval, error retrieval, lexical fallback, optional
  embeddings, and advisory injection formatting.
- Distillation: manual suggestions, confirmation, rejection records, and
  operator reports.
- Runtime integration: AgentHarness hooks, explicit install, no-op default,
  visible advice, and failure isolation.
- Operator surface: read-only reports, future CLI/API surfaces, and docs.
- Desktop UI: host-api only, locale coverage, design tokens, and Electron E2E.

Stop and ask the user before adding any autonomous behavior, external service,
renderer UI, config/env surface, or default-on runtime behavior.

## Stage 2: Test-First Design

For each stage, write the expected tests before implementation. Keep tests close
to the touched surface:

- SEKB unit tests in `openclaw_runtime/src/knowledge/sekb/*.test.ts`.
- Schema verification through `node scripts/generate-kysely-types.mjs --verify`
  after state schema edits.
- Harness validation through
  `pnpm harness validate --spec harness/specs/tasks/sekb-runtime-long-task-development.md`.
- Communication replay and compare only when Gateway, channel, runtime
  send/receive, host-api, api-client, or fallback behavior changes.
- Electron E2E only when a user-visible desktop workflow changes.

Record the expected failing assertion before writing production code.

## Stage 3: Implementation

Keep changes bounded to the selected category. Prefer existing SEKB modules,
OpenClaw SQLite state patterns, Kysely helpers, and current AgentHarness hook
seams. Keep public exports narrow and local helpers private unless another
module immediately consumes them.

SEKB runtime code must preserve these invariants:

- Optional and nullable embeddings; lexical retrieval must still work.
- L1 index contains active principles and stays under the approximate 2K token
  budget.
- `confirm_and_save` is the only path that writes confirmed L2 principles or
  marks trajectories distilled.
- Hook failures are swallowed and reported only through an optional diagnostic
  callback.
- Advice is visible model context, not hidden correction or automatic retry.

## Stage 4: Integration Proof

When runtime hooks or call sites change, prove the complete path:

1. A task start event creates an L3 trajectory and injects bounded task advice.
2. Tool call/result events record visible steps.
3. Error results derive or reuse an `error_signature` and append visible error
   advice.
4. Agent end marks success or failure.
5. Abort marks partial.
6. SEKB failures do not fail the agent run.

The proof may be a focused runtime integration test if no desktop workflow is
involved.

## Stage 5: Documentation And Operator Contract

Update `docs/enhancements/sekb-mvp.md` or
`docs/enhancements/sekb-runtime-roadmap.md` when behavior, architecture, or
stage boundaries change. Keep reusable AI coding constraints under
`harness/specs/**`; do not create a parallel planning source of truth.

Every functional change must state whether README translation updates are
required. Runtime-only advisory changes with no visible desktop workflow can
usually document why README translations are not required.

## Stage 6: Closure Gate

Before finishing a `/goal` run, rerun the focused proof for touched surfaces,
run harness validation, inspect the final diff, and check the working tree.
Report exact commands and whether each passed or was intentionally skipped with
rationale.

The task is not complete if any planned item is unimplemented without a tracked
deferral, if unrelated files are staged, if required generated schema files are
stale, or if the final response lacks verification evidence.
