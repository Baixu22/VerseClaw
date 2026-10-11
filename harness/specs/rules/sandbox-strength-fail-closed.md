---
id: sandbox-strength-fail-closed
title: Explicit Strong Sandbox Requests Fail Closed
type: rule
severity: error
driven_by: agent
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - electron/utils/sandbox-policy-resolver.ts
  - electron/utils/sandbox-high-risk-gate.ts
  - electron/utils/active-sandbox-high-risk-policy.ts
  - tests/unit/sandbox-explicit-strong-156.test.ts
requiredTests:
  - pnpm exec vitest run tests/unit/sandbox-explicit-strong-156.test.ts
---

# Rule: an explicit strong sandbox request fails closed

The sandbox policy has two providers with a real isolation boundary:
`docker-strong` and `ssh-strong` (`runtimeLevel: 'strong'`). `policy-light` and
`windows-light` are control layers, not container/VM isolation. When a strong
provider is unavailable, the default resolver degrades to `policy-light` and
marks the policy `degraded`. That degradation is correct for *automatic*
selection, but it must never silently satisfy an *explicit* strong request —
otherwise high-risk exec/browser/cron run on the host while the operator
believes they are containerized. Issue #156 tracks that boundary.

## Requirements

- A caller that explicitly requires strong isolation MUST signal it (the
  resolver takes `requireStrong`). With that signal set and a strong provider
  requested, an unavailable provider MUST raise
  `SandboxStrengthUnavailableError` instead of returning a `policy-light`
  policy. Automatic/startup resolution MUST NOT set the signal, so today's
  degrade-with-warning path is unchanged.
- The execution-boundary high-risk gate MUST deny (`allowed: false`,
  `requiresApproval: false`) when the policy snapshot reports
  `strengthRequired: true` and the effective `runtimeLevel` is not `strong`.
  A per-action approval MUST NOT authorize the fallback the operator did not
  request.
- An explicit `policy-light` choice is acknowledged light isolation and MUST
  NOT be treated as a strength requirement.
- The gate MUST re-detect provider capabilities at the execution boundary for a
  strong request rather than trusting a stale detection cache, so a provider
  that disappeared after selection cannot be reported as still strong.
- Status/explain output MUST distinguish "strong requested but unavailable"
  from "strong requested and satisfied" and from an acknowledged downgrade, and
  MUST report requested vs effective provider truthfully.

## Boundaries

- This rule does not decide product defaults or make Docker a hard dependency.
  The automatic fallback and the `policy-light` default are unchanged.
- This rule does not add a new sandbox provider, a second approval plane, or a
  scheduler; it strengthens the existing gate for the explicit-strong case only.
- Job Object hard limits (#155) and outbound concurrency budgets (#154) are
  separate issues and are not satisfied by this rule.

## Validation

- `pnpm exec vitest run tests/unit/sandbox-explicit-strong-156.test.ts`
- `pnpm exec vitest run tests/unit/sandbox-high-risk-gate-p2-004.test.ts tests/unit/sandbox-api.test.ts`
