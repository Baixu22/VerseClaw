---
id: runtime-authority-convergence-program
title: Runtime Authority Convergence Program Control Pack
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Persist the planning, ownership, sequencing, and acceptance contract for converging ClawX onto existing OpenClaw runtime and plugin standards while treating TaskFlow as a conditional workflow candidate until RC-06A proof, without changing runtime behavior or creating a new authority; every implementation package must add its own narrower Harness task spec.
ownedPaths:
  - harness/specs/tasks/runtime-authority-convergence-program.md
  - harness/specs/rules/runtime-authority-convergence-boundary.md
  - .agent-workbench/task-forest/proposals/TFP-runtime-authority-convergence-20260802.json
  - docs/dev/unified-agent-system/runtime-convergence/**
  - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
  - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
  - docs/dev/Sustained-Development-Playbook.md
  - docs/dev/handoffs/LATEST.md
touchedAreas:
  - harness/specs/**
  - docs/dev/**
  - .agent-workbench/task-forest/proposals/TFP-runtime-authority-convergence-20260802.json
  - tests/unit/runtime-authority-convergence-control-pack.test.ts
expectedUserBehavior:
  - No runtime, renderer, Main, Gateway, provider, channel, approval, effect, memory, context, tool, telemetry, default, or readiness behavior changes.
  - A fresh Agent receives one authoritative document entry point, one serial work-package sequence, one metadata-only status, and one final human-acceptance phase.
  - Existing UAS and runtime-family evidence remains historical; it cannot authorize future expansion.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-authority-convergence-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - docs-sync
humanEvidence: not-required
forbiddenPatterns:
  - production runtime implementation in this planning task
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - applying a Task Forest proposal without user confirmation
  - marking the program done before final user acceptance
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Revert the control-pack documentation and Harness planning spec.
  - No runtime, schema, data, configuration, or migration rollback is required because this task changes no product behavior.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-authority-convergence-program.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-program.md
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
acceptance:
  - The proposed control pack has a single index, activation locks, ownership matrix, serial work packages, engineering acceptance contract, final-only human acceptance, metadata-only status, and fresh-agent entry.
  - The authority order distinguishes Task Forest status, Harness implementation gates, architecture decisions, and status metadata without creating a second task truth.
  - The plan evaluates TaskFlow/TaskRegistry through RC-06A before per-domain cutover, and reuses one memory slot, one contextEngine slot, MCP, OTel, existing domain journals, and existing provider/channel/subagent runtime; RC-01 must prove rather than assume the receipt persistence owner.
  - RuntimeTaskEventLog remains a default-off/prunable candidate and cannot promote diagnostic replay/reducer/runtime-spine paths; the npm fallback cannot claim source-runtime receipt capability.
  - Durable approval and effect reconciliation is completed before the Operator restart vertical slice.
  - RC-00 repairs the proven acceptance fail-open paths and produces a real green isolated Verifier/final report before RC-01 starts.
  - The plan freezes runtime-family diagnostic expansion and forbids promotion of runtime-spine.
  - The plan reopens the UAS-02 full-payload residual instead of treating prior enhancement-candidate coverage as complete provider-bound authority.
  - Every future implementation package is required to add a narrower Harness task spec and pass independent Agent Engineering Acceptance.
  - Program done requires a mutually bound final manifest, green independent Verifier report, and user-authored human verdict; status strings alone are insufficient.
  - Human provider/channel/recovery validation occurs only after final engineering acceptance and is the only action that can permit program done.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/README.md
    - docs/dev/unified-agent-system/runtime-convergence/CHARTER.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
    - docs/dev/handoffs/LATEST.md
---

# Runtime Authority Convergence Program

This task is planning and governance only. It authorizes no runtime implementation. The first implementation activity is RC-00, and RC-00 must receive a separate scoped Harness task spec after the Task Forest proposal is confirmed and applied.
