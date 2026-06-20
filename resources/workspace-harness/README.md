# ClawX Agent Harness

This directory is the workspace-local home for project instructions, task specs, and Task Ledger-aligned context routing.

ClawX uses this layout instead of `.trellis/` so project docs plug into the existing ClawX long-conversation stack instead of creating another task system:

- `specs/rules/` - hard rules that should be checked whenever practical.
- `specs/scenarios/` - user-visible or cross-layer workflows.
- `specs/tasks/` - concrete work contracts with intent, touched areas, required rules, tests, and acceptance criteria.
- `specs/guides/` - thinking guides and review checklists that are not hard rules.
- `specs/layers/` - subsystem conventions selected by touched paths.
- `workspace/` - Task Ledger bridge docs, context-pack recipes, and local working memory; private journals stay ignored by default.

Keep `AGENTS.md` as the short entry point. Put durable project knowledge here, and promote repeated lessons from `workspace/` into `specs/`.

## Alignment With Long Conversation State

ClawX already has first-class owners for long work:

- **Task Ledger** owns durable task state: goals, dependencies, blockers, review state, decisions, deviations, and session links.
- **ClawGraph** owns long-task execution state: DAG runs, node handoffs, audit results, and review items.
- **Context Pack** owns token-budgeted context injection for a run. It is not a durable source of truth.
- **This harness** owns project specs, task contracts, context-pack recipes, and human-readable bridge docs.

The workspace docs may mirror or bootstrap task information, but they must not silently compete with Task Ledger. If ClawX Task Ledger is available, update it first and use these files as references, exports, or review aids.

## Task Dimensions

- Goal: what outcome the task serves.
- Scenario: the user-visible or cross-layer workflow.
- Layer: the subsystem or path family being touched.
- Status: proposed, active, blocked, review, done, archived.
- Risk: low, medium, high.
- Context: the minimum specs, files, and notes an agent should read.
- Validation: commands, manual checks, and acceptance criteria.
- Decision: durable choices made while doing the work.

Use Task Ledger as the authoritative board. Use `workspace/task-index.md` only as a bootstrap checklist, human-readable mirror, or export target, then link each substantial task to a spec under `specs/tasks/`.

Before implementation, read the smallest useful context:

1. The task spec in `specs/tasks/`, when one exists.
2. Referenced scenarios and rules.
3. Layer specs that match the paths being touched.
4. Guides that apply to the task.
