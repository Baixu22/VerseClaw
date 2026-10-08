---
id: tf0074-real-use-acceptance
title: TF-0074 DCS、Goal/Loop、SEKB 真实投入使用工程验收
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  在 TF-0070 至 TF-0073 已完成后，使用当前源码和官方 runner 对 DCS
  agents/runtime-config/unit shards、并发隔离、持久化时序、runtime lineage、
  terminal trajectory 门控、Knowledge golden path 与 Knowledge Electron E2E
  进行一次可复跑的工程验收。工程证据必须与真人、真实 channel、产品批准和
  default-on 资格分开记录。
touchedAreas:
  - harness/specs/tasks/tf0074-real-use-acceptance.md
  - harness/specs/rules/runtime-lineage-boundary.md
  - harness/specs/rules/dcs-stage2-handoff-boundary.md
  - harness/specs/rules/dcs-stage5-sekb-closure-boundary.md
  - harness/specs/rules/renderer-main-boundary.md
  - harness/specs/rules/backend-communication-boundary.md
  - harness/specs/rules/api-client-transport-policy.md
  - harness/specs/rules/host-events-fallback-policy.md
  - harness/specs/rules/comms-regression.md
  - harness/specs/rules/docs-sync.md
  - harness/specs/rules/agent-engineering-acceptance-boundary.md
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/plugins/hook-types.ts
  - openclaw_runtime/src/runtime-core/**
  - electron/services/knowledge-api.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - shared/i18n/locales/**/knowledge.json
  - shared/verseshell/extraction.ts
  - shared/verseshell/facade.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/pages/Knowledge/index.tsx
  - tests/unit/**
  - tests/e2e/sekb-golden-path.spec.ts
  - tests/e2e/knowledge-hub.spec.ts
  - docs/dev/sekb-golden-path.md
  - docs/dev/dcs-visible-production/TF-0074-REAL-USE-ACCEPTANCE-EVIDENCE-2026-08-21.md
  - docs/dev/dcs-visible-production/STATUS.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - artifacts/tf0074-acceptance/**
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - DCS task-state and phase behavior remains on the real TaskLoop production path; single-turn chat is not presented as full lifecycle evidence.
  - Mission, Task Loop, DCS and SEKB records expose the same explicit runtime-lineage identifiers when available, without inferring missing IDs.
  - Terminal-only or incomplete trajectories never enter the suggestion pool, and repeated captures are idempotent.
  - Knowledge capture, suggestion, human confirmation, persistence and recall remain a bounded host/API path; suggestion alone never writes durable principles.
  - Renderer communication remains Main/host-api owned, and the communication regression profile is run for any touched communication path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lineage-boundary
  - dcs-stage2-handoff-boundary
  - dcs-stage5-sekb-closure-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
forbiddenPatterns:
  - flipping liveReady, productApproved, defaultOn, or any DCS/SEKB default flag
  - unattended SEKB writeback or treating suggest output as durable knowledge
  - inferring missionId, tick, sessionId, runId, or traceId from sessionKey alone
  - direct renderer IPC/Gateway transport or a second transport-switching policy
  - using fixture, surrogate, synthetic, or historical evidence as real-channel evidence
  - calling a green focused shard a full-system or product acceptance result
  - modifying or cleaning unrelated dirty-worktree files to make diff-aware validation green
featureFlags:
  - DCS and SEKB remain explicit opt-in and fail closed when disabled.
  - Runtime lineage remains correlation metadata only.
  - Product locks remain false throughout this task.
rollback:
  - This task is evidence-only unless a separately reviewed defect fix is required.
  - Any defect fix must use its own scoped change and rerun the affected gates.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/tf0074-real-use-acceptance.md
  - pnpm harness validate --spec harness/specs/tasks/tf0074-real-use-acceptance.md --no-diff
  - pnpm run test:dcs
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/embedded-agent-runner/extensions.task-state.test.ts src/agents/task-loop-controller.dcs-phase-producer.test.ts src/agents/mission-control/fenced-tick-wiring.test.ts src/agents/embedded-agent-runner/sekb-runtime.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/runtime-core/lineage.test.ts src/knowledge/sekb/terminal-trajectory-gating.test.ts src/knowledge/sekb/golden-path.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:dcs
  - pnpm run contract:check
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/sekb-golden-path.spec.ts tests/e2e/knowledge-hub.spec.ts --workers=1
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The DCS unit, runtime-config, and agent shards pass with explicit passed/failed/skipped counts; any skip is recorded rather than silently accepted.
  - Production-path tests prove run/session isolation, serialized phase side effects before TaskLoop completion, Mission-to-SEKB lineage persistence, terminal-only exclusion, and duplicate-capture idempotency.
  - The current built Electron app passes both `sekb-golden-path.spec.ts` and `knowledge-hub.spec.ts`; stale-build or fixture-only results do not count.
  - The evidence report records current command exits, source freshness, artifact paths, and all failures or environment limits.
  - STATUS/handoff/product-lock checks show `liveReady=false`, `productApproved=false`, `defaultOn=false`, and SEKB human-confirm/no-auto-writeback unchanged.
  - A dirty shared worktree or missing real channel is reported as an evidence boundary; neither is converted into product approval, live readiness, or default-on. A Task Forest done state, when earned by the scoped engineering evidence, closes only this engineering acceptance package.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/dcs-visible-production/STATUS.md
    - docs/dev/Sustained-Development-Playbook.md
---

# TF-0074 DCS、Goal/Loop、SEKB 真实投入使用工程验收

This is the scoped engineering acceptance entry for Task Forest node TF-0074. It
reuses the existing DCS, Mission/TaskLoop, SEKB, Host API, and Electron E2E
paths. It does not create a new runtime authority and it does not authorize a
real third-party channel, product approval, live readiness, or default-on.

The final evidence must separate:

1. current-source engineering results;
2. independent/formal acceptance prerequisites;
3. human/live/real-channel evidence;
4. product and rollout decisions.

The evidence report is incomplete until every required command has a current
exit/count record or an explicit blocked/未运行 reason.
