---
id: error-governance-boundary
title: Fixture rule without a surface block
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
driven_by: agent
---

# Fixture rule without a surface block

This fixture deliberately omits the `json error-governance-surface` block. The
check must fail closed instead of treating the rule as ungoverned prose.

Validation: node scripts/check-error-governance.mjs
