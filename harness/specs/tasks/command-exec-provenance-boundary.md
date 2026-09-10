---
id: command-exec-provenance-boundary
title: Command-exec provenance boundary check
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Consume the v1 ContentProvenance sidecar at exactly one sensitive sink,
  command execution, while preserving the existing allowlist, approval, and
  explicit fullAccess behavior.
touchedAreas:
  - harness/specs/tasks/command-exec-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/bash-tools.exec-types.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/sessions/input-provenance.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.integration.test.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
  - tests/unit/external-content-provenance.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - exec-default-safety
  - docs-sync
requiredTests:
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.integration.test.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.resolve-env.test.ts
  - openclaw_runtime/src/agents/rc04-exec-approval-wiring.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The command-exec sink recognizes present, missing, and invalid provenance explicitly.
  - Untrusted or derived-untrusted provenance cannot silently obtain an implicit full/off exec policy.
  - Missing or invalid provenance is fail-closed for bypass decisions but does not block ordinary allowlisted reads.
  - Explicit operator-selected fullAccess/full policy remains effective and is not rewritten by this adapter.
  - Existing approval, argv, cwd, environment, allowlist, and timeout bindings remain unchanged.
  - No additional approval is added for commands already allowed by the existing allowlist path.
  - No other sensitive sink is wired in this task.
  - No prompt rewrite, global taint engine, regex injection classifier, or dependency is introduced.
expectedUserBehavior:
  - Ordinary read-only and allowlisted coding commands continue to work.
  - A command whose provenance is untrusted, derived-untrusted, missing, or invalid cannot use an implicit approval bypass.
  - Explicit fullAccess remains an operator-controlled break-glass path.
docs:
  required: false
  note: >-
    This is a backend sidecar/policy-boundary change with no new user-visible
    flow or default permission selection.
---

# Implementation contract

This task adds one small command-exec decision helper. It consumes normalized
ContentProvenance status and only constrains implicit bypass. Existing command
parsing, allowlist matching, approval timing, host selection, environment
binding, and explicit fullAccess behavior remain authoritative.

The helper must treat missing and invalid provenance as an explicit unknown
state. Unknown state is not trusted, but ordinary allowlisted commands remain
usable because the existing allowlist path still decides them. The helper is
not a dynamic taint engine and does not classify prompt text.
