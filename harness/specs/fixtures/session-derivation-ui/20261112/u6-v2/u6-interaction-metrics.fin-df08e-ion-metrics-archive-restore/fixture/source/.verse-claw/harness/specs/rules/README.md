# Rules

Rules are mandatory constraints. Add one rule per file when the behavior should be enforced in reviews, scripts, or agent checklists.

Suggested frontmatter:

```yaml
---
id: example-rule
title: Example Rule
type: rule
severity: error
appliesTo:
  - all
---
```

Write rules as clear obligations:

- What must or must not happen.
- Which paths or workflows are affected.
- How to verify the rule when practical.

