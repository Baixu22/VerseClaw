# Scenarios

Scenarios describe user-visible or cross-layer workflows. Use them when a feature spans multiple files, services, tools, or runtime boundaries.

Suggested frontmatter:

```yaml
---
id: example-scenario
title: Example Scenario
type: scenario
ownedPaths:
  - src/**
requiredRules: []
requiredProfiles: []
---
```

Include the flow, important invariants, failure modes, and the minimum validation that should run when the scenario changes.

