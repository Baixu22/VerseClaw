---
id: agent-harness-routing
title: Agent Harness Routing
type: guide
appliesTo:
  - all
---

The Verse Claw agent harness uses `AGENTS.md` as the short entry point and `harness/specs/**` as the durable project knowledge base.

Before implementation, load the smallest useful context:

1. Start with the task spec when one exists.
2. Read the referenced scenario and required rules.
3. Read layer specs selected by touched paths.
4. Read guides only when they apply to the task or all tasks.

Do not introduce another top-level agent framework directory as a parallel source of truth. New durable conventions should be promoted into `harness/specs/rules`, `harness/specs/guides`, or `harness/specs/layers`.
