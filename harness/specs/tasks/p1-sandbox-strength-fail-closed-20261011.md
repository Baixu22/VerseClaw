---
id: p1-sandbox-strength-fail-closed-20261011
title: Fail closed when an explicit strong sandbox request cannot be honored
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close issue #156 by carrying an explicit strong-sandbox requirement from the resolver through the execution-boundary gate, so an unmet strong request denies high-risk actions instead of silently running them on the host/policy-light path, while automatic selection keeps the existing degradable behavior.
expectedUserBehavior:
  - A profile that explicitly selected docker-strong/ssh-strong no longer runs high-risk exec/browser/cron on policy-light when the strong provider is unavailable; the action is denied and the reason names requested vs effective strength.
  - Automatic (non-explicit) selection keeps today's degrade-with-warning behavior; an explicit policy-light choice is still acknowledged light isolation.
  - The sandbox status/explain surface reports the unmet strength requirement so the operator can tell "unavailable strong" apart from "acknowledged downgrade".
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - sandbox-strength-fail-closed
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - electron/utils/sandbox-policy-resolver.ts
  - electron/utils/sandbox-high-risk-gate.ts
  - electron/utils/active-sandbox-high-risk-policy.ts
  - tests/unit/sandbox-explicit-strong-156.test.ts
  - harness/specs/tasks/p1-sandbox-strength-fail-closed-20261011.md
  - harness/specs/rules/sandbox-strength-fail-closed.md
  - docs/dev/sandbox-strength-fail-closed-20261011.md
  - scripts/repository-artifacts.json
  - .gitignore
acceptance:
  - Issue #156 - resolveSandboxEffectivePolicy throws SandboxStrengthUnavailableError only when requireStrong is set, a strong provider was requested, and the effective runtime level is not strong; without requireStrong the same input still degrades to policy-light with a reason.
  - Issue #156 - decideSandboxHighRiskAction denies (allowed=false, requiresApproval=false) whenever the snapshot has strengthRequired=true and runtimeLevel!=='strong', even with allowApproval=true; a policy-light profile and a satisfied strong profile are unaffected.
  - Issue #156 - getActiveSandboxHighRiskPolicy sets strengthRequired from the explicitly requested provider, re-detects capabilities at the execution boundary for strong requests, and reports requested/effective/runtimeLevel truthfully on failure.
  - No product default, frozen lock or permission default changes; the automatic/startup fallback path is unchanged. No paid provider call or human action is part of the verification.
docs:
  required: true
  paths:
    - docs/dev/sandbox-strength-fail-closed-20261011.md
---

# Fail closed on an explicit strong sandbox request

Issue #156 found that the resolver silently degrades an unavailable strong
sandbox (`docker-strong` / `ssh-strong`) to `policy-light` and reports
`degraded`, but nothing at the execution boundary distinguishes an *explicit*
strong request from the automatic default. The result is a profile that asked
for container isolation running high-risk exec/browser/cron on the host while
the UI still shows a strong badge.

This change threads a single `requireStrong` signal through the existing
resolver and the existing high-risk gate. It does not add a scheduler, a second
approval plane or a new provider: it makes the existing gate stricter only for
the case the operator explicitly asked for strength, and leaves the automatic
degradation path (and an explicit `policy-light` choice) exactly as it was.
