---
id: audit-wiring-remainder
title: Connect verifier and trajectory consumers and retire duplicate implementations
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1ac356e98
intent: Finish audit items F04 through F08 using the current completion owner, raw trajectory supply, production chat entrypoint, and routed pages.
ownedPaths:
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/verifier-discipline.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/**/verifier*.test.ts
  - src/lib/trajectory-view/**
  - src/stores/session-activity.ts
  - src/stores/observability.ts
  - src/stores/chat/**
  - src/pages/Browser/index.tsx
  - src/pages/RemoteTasks/index.tsx
  - src/pages/Dreams/index.tsx
  - tests/unit/**
  - tests/e2e/session-activity-trajectory.spec.ts
  - tests/e2e/observability-trace-graph.spec.ts
  - tests/e2e/fakecoding-inbox-navigation.spec.ts
  - package.json
  - pnpm-lock.yaml
  - scripts/repository-artifacts.json
  - scripts/check-feature-leaf-consumers.mjs
  - artifacts/agent-dev-workbench/evidence.json
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/resources-and-observability.md
touchedAreas:
  - openclaw_runtime/src/agents/**
  - src/lib/trajectory-view/**
  - src/stores/session-activity.ts
  - src/stores/observability.ts
  - src/stores/chat/**
  - src/pages/Browser/index.tsx
  - src/pages/RemoteTasks/index.tsx
  - src/pages/Dreams/index.tsx
  - tests/unit/**
  - tests/e2e/session-activity-trajectory.spec.ts
  - tests/e2e/observability-trace-graph.spec.ts
  - tests/e2e/fakecoding-inbox-navigation.spec.ts
  - package.json
  - pnpm-lock.yaml
  - scripts/repository-artifacts.json
  - scripts/check-feature-leaf-consumers.mjs
  - artifacts/agent-dev-workbench/evidence.json
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/resources-and-observability.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - repository-artifact-retention
  - disk-temp-policy
  - lifecycle-projection-owner
expectedUserBehavior:
  - Verifier failures use the configured discipline and the existing bounded lead repair flow.
  - Session activity and Observability lifecycle consume raw v2 assembler output with session isolation and deterministic history/realtime handoff.
  - Existing Browser and Remote Tasks links retain their routed replacement behavior.
acceptance:
  - Configured verifier discipline changes actual failure continuation and never makes a verifier repair its own work.
  - Trajectory history pagination, duplicate suppression, gap repair, and stale-response rejection are verified; legacy or empty supply stays explicit idle/no-data.
  - Runtime notifications only request trajectory refresh for v2-covered lifecycle; Git, approvals, terminals, queue and subagents retain their current owners.
  - Disconnected chat action copies and retired page implementations are removed after archiving; retained tests exercise the actual store and routed surfaces.
  - react-virtuoso is removed from direct dependencies and lockfile entries while concurrent lockfile edits are preserved.
  - Focused unit, Electron, type, build, comms, retention and diff-aware Harness checks have file-readable results.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/audit-wiring-remainder.md
  - pnpm harness validate --spec harness/specs/tasks/audit-wiring-remainder.md
  - pnpm run comms:replay
  - pnpm run comms:compare
docs:
  required: true
  note: Explain v2 lifecycle projection and verifier failure ownership; update retired source/test references.
---

Reuse the existing TrajectoryAssembler and Main-owned trajectoryHistory/trajectoryEvent supply. Keep full retired source bytes and hashes in the local audit archive before removing duplicate implementations. Move behavior coverage to the production Chat/Inbox/Browser entries.
