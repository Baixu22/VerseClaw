---
id: permission-effect-contract
title: Unified permission, authorization and effect contract
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Make every side-effect component converge on one final action+resource+scope authorization checkpoint while preserving each existing policy owner, CapabilityGrant, ApprovalLedger and EffectReceipt authority.
expectedUserBehavior:
  - A component declaration never grants permission.
  - Every side-effect executes only after its owning policy allows and the final checkpoint matches actor, workspace, task branch, action, resource, purpose, grant TTL and revocation state.
  - Actor/session/task, resource/action, policy digest, expiry, revocation and stale-snapshot mismatches fail closed before effects.
touchedAreas:
  - harness/specs/tasks/permission-effect-contract.md
  - harness/specs/fixtures/permission-effect-contract/current-20261022/SHA256SUMS
  - harness/specs/fixtures/permission-effect-contract/current-20261022/SUMMARY.md
  - harness/specs/fixtures/permission-effect-contract/current-20261022/gates.json
  - harness/specs/fixtures/permission-effect-contract/current-20261022/status.json
  - shared/permission-effect-contract.ts
  - tests/unit/permission-effect-contract.test.ts
  - tests/unit/permission-effect-wiring.test.ts
  - electron/gateway/agent-browser-bridge.ts
  - electron/services/agent-browser-api.ts
  - electron/services/knowledge-api.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.exec-permission.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-gateway.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
  - openclaw_runtime/src/agents/stage4-tool-guard.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec-runtime.test.ts
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/src/memory/memory-store.ts
requiredRules:
  - runtime-authority-convergence-boundary
  - context-family-boundary
  - capability-owner-resolution
  - error-governance-boundary
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/permission-effect-contract.test.ts
  - tests/unit/permission-effect-wiring.test.ts
  - tests/unit/component-authority-manifest.test.ts
  - tests/unit/agent-browser-gateway-bridge.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - openclaw_runtime/src/agents/tools/context-agent-tools.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec-runtime.test.ts
  - openclaw_runtime/src/agents/stage4-capability-grant.test.ts
  - openclaw_runtime/src/agents/stage4-tool-guard.test.ts
  - pnpm contract:check
acceptance:
  - All side-effect components map to one permission/effect contract with one final authority owner per action+resource+scope.
  - Component manifest or declaration attempts to widen permission fail tests.
  - Actor, session, workspace, task branch, action, resource and purpose mismatches are rejected before effects.
  - Expired or revoked grants, a revocation after snapshot, and stale policy/revocation epochs fail closed.
  - Browser, exec, knowledge apply, fact tools, memory write and coding control use the same final checkpoint.
docs:
  required: false
---
# Unified permission/effect contract

This task does not create a second permission database, approval ledger or grant store. The
existing owner policy remains the decision source, and `CapabilityGrant` remains the derived
execution credential. The new contract only standardizes the final checkpoint and the negative
evidence required before an effect executes.

## Ownership model

1. Each side-effect component keeps its existing policy owner.
2. The owner produces a decision snapshot with policy digest, approval/grant references and the
   current revocation epoch.
3. The final checkpoint verifies the snapshot against the current grant and the actual request.
4. Execution receives an allow only if every identity, scope, TTL, revocation and idempotency
   condition still matches.
5. Effect outcome remains `applied | not_applied | unknown`; unknown outcomes are never replayed
   as a different backend.

## Required component bindings

- Browser effect
- Process exec
- Knowledge apply
- Fact tools
- Memory write
- Coding control

Each binding names one final authority owner and one effect class. The pure contract tests reject
missing, duplicate or component-invented authority.
## Evidence

The current agent-driven gate and wiring evidence is stored under
`harness/specs/fixtures/permission-effect-contract/current-20261022/`.