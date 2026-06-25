---
id: agent-task-loop-mvp
title: Agent self-check task loop MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a runtime-first bounded task loop that orchestrates role subagents, records self-check evidence, emits lifecycle events, and blocks instead of pretending completion when evidence is insufficient.
touchedAreas:
  - harness/specs/tasks/agent-task-loop-mvp.md
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/task-loop-self-check.ts
  - openclaw_runtime/src/agents/tools/task-loop-tool.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - shared/host-events/contract.ts
  - electron/gateway/event-dispatch.ts
  - electron/main/index.ts
  - src/lib/host-events.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - Lead agents can call task_loop to run a bounded self-checking orchestration loop.
  - Operators can start task_loop.run through the existing Gateway RPC path and inspect task_loop.status.
  - Verse Claw receives task-loop lifecycle events through HostEvents without renderer direct Gateway transport.
  - The Roles panel shows task-loop phase, iteration, self-check decision, and terminal status.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/agent-task-loop-mvp.md
  - pnpm exec vitest run tests/unit/task-loop-controller.test.ts tests/unit/host-events.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - task_loop reuses runOrchestrationObserved/spawnSubagentDirect and does not add a new renderer transport.
  - task_loop defaults to quick-development and auto-selects security-audit for security/permission/auth/secret tasks.
  - self-check repair loops are capped and repeated repair evidence blocks the loop.
  - leaf subagents do not receive task_loop unless existing subagent spawn-depth policy grants orchestration tools.
  - task-loop lifecycle events flow Gateway broadcast -> Main -> HostEvents.
docs:
  required: true
  note: Review README files for public task-loop UI/RPC behavior.
---
