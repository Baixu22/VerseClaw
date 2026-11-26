---
lifecycleStatus: active
id: session-collaboration-a5
title: A5 会话规模与查询基线的自动旅程
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 515a8006377c87b4f51a3a97f7a7add901d33bf9
intent: 为两工作区和子会话读取、2/20/100/500 合成规模及后续性能裁定提供可执行测量入口。
touchedAreas:
  - tests/e2e/fixtures/session-collaboration.ts
  - tests/e2e/session-collaboration-scale.spec.ts
  - harness/specs/tasks/session-collaboration-a5.md
  - harness/specs/guides/session-collaboration-center-plan.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm run test:e2e tests/e2e/session-collaboration-overview.spec.ts tests/e2e/session-collaboration-watch.spec.ts tests/e2e/session-collaboration-scale.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-a5.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-a5.md --dry-run
acceptance:
  - 两工作区、独立会话及原 owner 创建的子会话由真实 Host/Gateway 路径读取，读取前后 owner 和模型调用保持一致。
  - 2/20/100/500 合成规模记录查询次数、扫描行数、列表与详情 p50/p95、RSS 和原始样本；自动数据标 driven_by agent。
  - 后续查询、通知和缓存目标从实际基线固定；未测量值保留未知，原失败与候选身份保留。
docs:
  required: false
---
# A5 测量入口

新旅程只在独立 Electron fixture 中建立原 owner 数据。每个规模保留真实样本、模型调用前后计数及 session/task owner 的读前读后状态；合成规模与真实会话创建分开标记。

用户继续要求验收延期。本轮只开发可执行旅程；规模数值、延迟阈值和验收结论在恢复后的实际运行中产生。
