---
lifecycleStatus: archived
id: windows-high-concurrency-stability-v1
title: Windows high-concurrency stability orchestration v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add Windows-first resource leases for concurrent Chat/agent/subagent work so reads stay parallel while search, terminal execution, and filesystem mutations are bounded and observable.
touchedAreas:
  - harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - docs/clawx-design-overview.md
  - electron/services/terminal-api.ts
  - electron/services/resource-leases.ts
  - electron/services/terminal-session-manager.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.exec-types.ts
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts
  - openclaw_runtime/src/agents/sessions/tools/tool-contracts.ts
  - openclaw_runtime/src/agents/sessions/tools/grep.ts
  - openclaw_runtime/src/agents/sessions/tools/find.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sandbox/fs-bridge.ts
  - tests/unit/resource-leases.test.ts
  - tests/unit/terminal-api.test.ts
expectedUserBehavior:
  - Multiple conversations can run concurrently without unbounded terminal/search/file mutation contention.
  - Ordinary agent terminal commands are bounded by a workspace exec lease and return stable timeout diagnostics when saturated.
  - Long-running managed terminals are deduplicated by workspace plus name or command.
  - grep/find searches are bounded per workspace while read/ls remain parallel and output-capped.
  - File writes/edits retain same-file serialization, and subtree delete/rename/move paths are serialized against overlapping paths.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - pnpm exec vitest run tests/unit/resource-leases.test.ts tests/unit/terminal-api.test.ts tests/unit/workspace-permissions.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/agent-steering-team-bundle.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Resource leases are fair FIFO queues with bounded acquire timeout, reliable release in finally blocks, and deterministic wait metadata.
  - Windows path lease keys are case-insensitive and normalize slash variants; missing targets use parent realpath plus basename.
  - Same file mutations serialize; overlapping subtree mutations serialize; unrelated paths can proceed concurrently.
  - terminal.run uses a workspace exec lease before Gateway exec RPC attempts, and managed terminal open calls dedupe long-running commands.
  - grep/find acquire a workspace search lease and return queuedMs/lease metadata in tool details.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
---

This task does not introduce Docker/SSH isolation or new UI surfaces. It keeps policy-light as the default control-plane sandbox and prioritizes stability over maximum throughput.
