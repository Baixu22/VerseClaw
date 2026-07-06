# Implementation Spec Template

Use this template for every follow-up implementation slice. Do not implement multiple lanes in one spec unless the acceptance criteria prove a single vertical slice needs them together.

```yaml
---
id: runtime-<lane>-<slice>
title: Runtime <Lane> <Slice>
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: <one sentence describing the narrow behavior or schema change>
ownedPaths:
  - harness/specs/tasks/runtime-<lane>-<slice>.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/<new-or-existing-file>.ts
  - tests/unit/<focused-test>.test.ts
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - With all new flags omitted or disabled, behavior remains byte/shape compatible with the legacy path.
  - The slice is <schema-only | passive-shadow | advisory-only | active-narrow-guard>.
requiredProfiles:
  - fast
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - docs-sync
  - workspace-harness-single-source
forbiddenPatterns:
  - active provider transport changes, Gateway request changes, prompt assembly changes, TaskLoop decisions, approval/retry/rollback changes, or tool blocking unless explicitly accepted by this spec
  - evidence authority above `none`
  - raw persistent prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - second runtime service, daemon, listener, local server, database, exporter, or always-on sidecar
featureFlags:
  - runtime.<lane>.<slice> defaults off by omission.
rollback:
  - Disable runtime.<lane>.<slice> to restore legacy behavior without data migration.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-<lane>-<slice>.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-<lane>-<slice>.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/<focused-test>.test.ts
acceptance:
  - Flag-off behavior remains unchanged.
  - New contracts fail closed on malformed, missing, expired, unredacted, out-of-scope, or low-confidence inputs.
  - No forbidden authority, persistence, service, renderer-direct transport, provider transport, Gateway payload, or prompt path is introduced.
  - Rollback is flag disablement or deletion only.
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/<updated-doc>.md
---
```

## Required Questions Before Writing Code

Answer these in the implementation spec:

1. Is this slice schema-only, passive-shadow, advisory-only, or active?
2. Which exact runtime decision is unchanged when flags are omitted?
3. What evidence, if any, is produced?
4. Who can consume that evidence?
5. What makes the evidence fail closed?
6. Where does replay fixture data live?
7. What proves rollback?
8. What hard veto would stop promotion?

## Slice Naming

Prefer names like:

- `runtime-failure-intelligence-schema-spike`
- `runtime-evidence-envelope-validator`
- `runtime-replay-harness-core-fixtures`
- `runtime-outcome-scorecard-replay-adapter`
- `runtime-tool-governance-repeated-failure-advisory`

Avoid names like:

- `runtime-intelligence-platform`
- `runtime-autopilot-governance`
- `runtime-evidence-default-on`
- `runtime-replay-and-governance-all`

Names should make the blast radius boring and obvious.
