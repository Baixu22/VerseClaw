# Tasks

Tasks are implementation contracts. Create a task spec before substantial work, risky refactors, or changes that cross subsystem boundaries.

Suggested frontmatter:

```yaml
---
id: example-task
title: Example Task
type: task
scenario: example-scenario
intent: Explain the desired outcome in one or two sentences.
touchedAreas:
  - src/**
requiredRules: []
requiredTests: []
acceptance:
  - The expected behavior is implemented.
docs:
  required: false
---
```

Keep task specs concrete. They should tell an agent what to read, what to preserve, and how to know the task is done.

Mirror substantial task specs in Task Ledger first. `../../workspace/task-index.md` is only a human-readable bridge or bootstrap checklist.
