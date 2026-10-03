---
id: sustained-development-continuity
title: Sustained Development Continuity
type: guide
appliesTo:
  - all
---

# Sustained development continuity

Use this guide when multi-session maturity work risks losing progress.

## Required reads

1. `docs/dev/Sustained-Development-Playbook.md` (strategy + workflow)
2. `docs/dev/handoffs/LATEST.md`, if present (local latest session state)
3. `.agent-workbench/task-forest/` via the Task Forest CLI, if local history is present
4. `docs/dev/repository-artifact-retention.md` (source inputs and private archive recovery)

Task Forest and handoffs are local, not source checkout prerequisites. Restore a
private archive to continue its history; otherwise start from the active task spec.
Do not infer historical completion from a missing graph or merge colliding task IDs
by choosing one branch's JSON.

## Hard constraints

- One ready TF node per session by default
- No joint-system full GA while liveReady/productApproved remain false
- Durable rules go to `harness/specs/**`; progress goes to task-forest; do not create a parallel task truth source
- COMPASS skills: task-forest, session-handoff-prompt, task-clarifier, user-profile-keeper

## End-of-session gate

1. Update local Task Forest (proposal -> evidence gate -> apply -> validate -> export)
2. Refresh local `docs/dev/handoffs/LATEST.md`; neither local history is committed
3. If behavior changed, update README locales and harness specs in the same change set
4. Keep curated final evidence and stable fixtures tracked, not raw journals or screenshots
