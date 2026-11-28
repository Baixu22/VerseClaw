---
lifecycleStatus: active
id: session-collaboration-e5
title: E5 完成会话协作的同候选整链验收
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ac18e34df1ce17d47584b2822b67e1a8c1ba156b
intent: 在可合并候选上验证发现、消息、材料复用、资源归因和恢复的完整用户路径。
touchedAreas:
  - tests/e2e/session-collaboration-center.spec.ts
  - tests/e2e/fixtures/session-collaboration.ts
  - harness/specs/fixtures/session-collaboration-center/E5/**
  - harness/specs/fixtures/session-collaboration-center/E5-development-20261128/**
  - docs/modules/sessions.md
  - docs/modules/multi-agent-and-tasks.md
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-e5.md
  - harness/specs/scenarios/session-collaboration-center.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
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
expectedUserBehavior:
  - 两独立会话与子代理协作时可回看原目标、消息、材料、使用量及恢复后的当前状态。
  - 用户在系统和项目入口打开同一组原 owner 详情，并按实际回执判断等待与完成。
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration- --maxWorkers=1 --no-file-parallelism
  - pnpm run build:runtime
  - pnpm run test:e2e tests/e2e/session-collaboration- --workers=1 --retries=0
  - pnpm run harness:ci
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-e5.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-e5.md --dry-run
acceptance:
  - 在绑定当前主线且干净的候选上完成 A–E 合同、全部相关单测与 Electron 旅程以及原入口回归。
  - 两独立会话和子代理完成发现、订阅、消息、材料复用、资源回读及恢复，错误关联、重复效果和越界接受为零。
  - 同候选 A5 规模和 D4 配对样本可重算，D5 决定与输入、owner 回执、用量和价格来源一致。
  - 四语、明暗、宽窄布局和键盘回读通过。真实本地 Gateway 及 agent 驱动 provider 的输入和结果留下原始证据。
  - 阶段审查使用星驰 ccs-ai/gpt-6.1-sol，独立回读实际测试、输入、事件、价格与用量、哈希和负例。
  - 文档与产品行为同步。Task Forest 提案按当前图哈希应用，并完成 validate、当前进度更新与最终回读。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
    - docs/modules/resources-and-observability.md
---

# E5 完成会话协作的同候选整链验收

前置为 E4。固定候选、树、主线基线、输入、工具版本和运行窗口。使用原 Host、Gateway、TaskSystem 和资源 owner 收集证据。

按能力、性能和恢复回读实际命令、产物哈希和负例，保留首轮失败。核对阶段审查和 Task Forest 状态后沿已有主线流程落地。

回退时撤回有问题的消费入口或触发，保留原消息、任务和资源回执。

精选证据写入 `harness/specs/fixtures/session-collaboration-center/E5/`，原始跑次留在 D 盘并标记 driven_by 为 agent。

开发交付新增同候选整链场景，沿用原Host、Gateway、消息与材料owner。开发阶段执行定向回归、contract/i18n/comms/Harness、Electron用例收集和星驰审查；完整类型/构建/CI/真实桌面及A5-D4测量、D5裁定按用户安排延期，运行后才填写最终能力和性能结论。
