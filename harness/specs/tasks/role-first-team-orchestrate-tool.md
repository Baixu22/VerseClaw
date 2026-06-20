---
id: role-first-team-orchestrate-tool
title: Role-first team_orchestrate tool for stable multi-agent collaboration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add and deepen a runtime-first model-callable team_orchestrate tool that uses role contracts, team templates, existing subagent spawn/announce mechanics, completion-aware orchestration closure, and observability without adding a parallel communication channel.
touchedAreas:
  - harness/specs/tasks/role-first-team-orchestrate-tool.md
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/agents/orchestrator-run.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/team-template.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - tests/unit/role-spawn.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/agent-steering-team-bundle.test.ts
expectedUserBehavior:
  - Lead agents can call team_orchestrate to spawn a role-scoped team using the existing subagent runtime.
  - team_orchestrate returns child handles and directs the lead to wait for push-based completion rather than polling.
  - Lead agents receive a single Team Result Bundle for a team run instead of unrelated worker completions.
  - teamTemplateId/templateId is a real planning input, not just listed metadata.
  - Unknown template ids fail with a clear invalid request/tool error.
  - Leaf subagents do not receive team_orchestrate by default.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/role-first-team-orchestrate-tool.md
  - pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/agent-steering-team-bundle.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - team_orchestrate reuses runOrchestrationObserved/spawnSubagentDirect and does not add a new transport path.
  - templateId=security-audit produces template workers first and defers skeptic verifier until worker completion.
  - maxWorkers caps worker plans before spawn while existing subagent limits still enforce depth/children.
  - orchestration metadata persists on subagent records and Team Result Bundle aggregation is keyed by orchestrationRunId.
  - orchestrator.plan/run keep existing behavior when templateId/maxWorkers are omitted.
docs:
  required: true
  note: Review README files for functional-flow changes; update only if the public user flow changes.
---
