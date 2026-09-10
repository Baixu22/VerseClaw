---
id: exec-default-safety
title: Safe default execution policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

When `tools.exec` is absent or incomplete, the canonical runtime defaults must be:

- `security=allowlist`
- `ask=on-miss`
- `askFallback=allowlist`

Missing or expired approval must never broaden an unconfigured command to `security=full`.
Explicit operator-selected policies, including the ClawX `fullAccess` workspace mode, remain
valid and must not be silently rewritten by this rule. Runtime resolution and effective-policy
diagnostics must consume the same constants so the displayed policy cannot drift from execution.
