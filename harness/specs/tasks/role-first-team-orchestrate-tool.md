---
id: role-first-team-orchestrate-tool
title: Role-first team_orchestrate tool for stable multi-agent collaboration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add and deepen a runtime-first model-callable team_orchestrate tool that uses role contracts, team templates, existing subagent spawn/announce mechanics, completion-aware orchestration closure, and observability without adding a parallel communication channel.
touchedAreas:
  - artifacts/system-maturity/orchestration-gap-closure/**
  - artifacts/system-maturity/orchestration-gap-closure/ORCH-001/**
  - artifacts/system-maturity/orchestration-gap-closure/status-gate.json
  - harness/specs/rules/system-maturity-status-gate.md
  - harness/specs/tasks/role-first-team-orchestrate-tool.md
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/agents/orchestrator-run.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestration-quality-scorecard.ts
  - openclaw_runtime/src/agents/routing-memo.ts
  - openclaw_runtime/src/agents/team-template.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - plans/system-maturity/orchestration-gap-closure/ORCH-001.delivery.md
  - plans/system-maturity/orchestration-gap-closure/ORCH-003.delivery.md
  - plans/system-maturity/orchestration-gap-closure/ORCH-004.delivery.md
  - plans/system-maturity/orchestration-gap-closure/ORCHESTRATION_STATUS.json
  - scripts/validate-orchestration-gap-status.mjs
  - shared/capability-claims.ts
  - shared/product-semantics.ts
  - tests/unit/role-spawn.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/product-semantics.test.ts
  - tests/unit/routing-memo.test.ts
  - tests/unit/agent-steering-team-bundle.test.ts
  - tests/integration/p1-orchestration-boundary.integration.test.ts
expectedUserBehavior:
  - Lead agents can call team_orchestrate to spawn a role-scoped team using the existing subagent runtime.
  - team_orchestrate returns child handles and directs the lead to wait for push-based completion rather than polling.
  - Lead agents receive a single Team Result Bundle for a team run instead of unrelated worker completions.
  - teamTemplateId/templateId is a real planning input, not just listed metadata.
  - Unknown template ids fail with a clear invalid request/tool error.
  - Leaf subagents do not receive team_orchestrate by default.
  - Ordinary orchestration quality is explicitly shadow-only and cannot grant routing authority.
  - Active Routing Memo input is resolved server-side from a same-session Task Loop run and matching runtime scorecard.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - system-maturity-status-gate
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/role-first-team-orchestrate-tool.md
  - pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/routing-memo.test.ts tests/unit/product-semantics.test.ts tests/unit/capability-claims.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/integration/p1-orchestration-boundary.integration.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - team_orchestrate reuses runOrchestrationObserved/spawnSubagentDirect and does not add a new transport path.
  - templateId=security-audit produces template workers first and defers skeptic verifier until worker completion.
  - maxWorkers caps worker plans before spawn while existing subagent limits still enforce depth/children.
  - orchestration metadata persists on subagent records and Team Result Bundle aggregation is keyed by orchestrationRunId.
  - orchestrator.plan/run keep existing behavior when templateId/maxWorkers are omitted.
  - Caller-supplied qualityState fields never change routing; missing, cross-session, running, or scorecard-less Task Loop references fail closed.
  - team_orchestrate and orchestrator.run results identify result quality authority separately from whether prior quality authority affected routing.
docs:
  required: true
  note: Review README files for functional-flow changes; update only if the public user flow changes.
---
