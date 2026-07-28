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
2. `docs/dev/handoffs/LATEST.md` (latest session state)
3. `.agent-workbench/task-forest/` via `$task-forest` todo/export

## Hard constraints

- One ready TF node per session by default
- No joint-system full GA while liveReady/productApproved remain false
- Durable rules go to `harness/specs/**`; progress goes to task-forest; do not create a parallel task truth source
- COMPASS skills: task-forest, session-handoff-prompt, task-clarifier, user-profile-keeper

## End-of-session gate

1. Update task-forest (proposal -> confirm -> apply -> validate -> export)
2. Refresh `docs/dev/handoffs/LATEST.md`
3. If behavior changed, update README locales and harness specs in the same change set
