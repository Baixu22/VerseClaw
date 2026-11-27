---
lifecycleStatus: active
id: session-collaboration-c2
title: C2 在原任务 owner 发布可引用成果
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ddc80d3c23eefcb3733a55ddbf3e13ae4762d54e
intent: 复用 Blackboard 类型和 TaskSystem 事件保存有版本、原 run 与证据的共享材料。
touchedAreas:
  - shared/types/session-collaboration-material.ts
  - shared/task-system/store.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - tests/unit/session-collaboration-shared-material.test.ts
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/tasks/session-collaboration-c2.md
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-shared-material.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-c2.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-c2.md --dry-run
acceptance:
  - 材料保存原 task/revision、source scope/run、内容哈希、证据、时间和适用条件。
  - fact/claim/decision/artifact/conflict/handoff 类型复用原 Blackboard，确认由证据 owner 决定。
  - 事实摘要与原证据文件绑定同一字节哈希，结论或产物引用不匹配时保留主张或拒绝。
  - 保留唯一发布回执，拒绝伪造来源、失效证据、旧代及跨工作区原文读取。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# C2 原任务事件

`task_control.publishMaterial` 核对当前 writer 和运行来源，发布前再次核对会话代次与检出。稳定材料 ID 保留首次来源和时间。TaskSystem 核对证据回执对应的任务修订、领取代次和文件哈希，并把材料保存在原任务事件中；通用历史、事件流和追溯入口跳过材料正文。
