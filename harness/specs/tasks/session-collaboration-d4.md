---
lifecycleStatus: active
id: session-collaboration-d4
title: D4 运行成对协作测量并复算收益
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 388c562c755c1c9d29766fdbb266d6ac2f3e8afe
intent: 固定任务、输入、模型和资源范围，配对比较直接读取与共享材料复用。
touchedAreas:
  - tests/e2e/session-collaboration-benefit.spec.ts
  - harness/specs/fixtures/session-collaboration-center/D4/benchmark.json
  - harness/specs/fixtures/session-collaboration-center/D4/summarize.mjs
  - harness/specs/tasks/session-collaboration-d4.md
  - harness/specs/guides/session-collaboration-center-plan.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm run test:e2e tests/e2e/session-collaboration-benefit.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-d4.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-d4.md --dry-run
acceptance:
  - 固定输入与任务判据，交替运行五组成对的 baseline 和 collaboration，保留两个会话的原领取和运行。
  - 记录正确结果、重复读取、派发至运行启动、终态通知、Main RSS 样本、协调用量和原价格版本。
  - 汇总报告保留未知、不完整、首次错误和配对覆盖率。计算 p50/p95 时仅采用同对有效值。
  - 脚本化 provider 与 live 观察分别标识。最终裁决引用已运行的原始证据。
docs:
  required: true
  files:
    - harness/specs/guides/session-collaboration-center-plan.md
---
# D4 协作对照

每组在同一工作区先准备独立会话和同一任务规格。基线直接重新读取文件，协作组通过原消息入口接收同一输入并引用已发布材料。任务结果要求返回原记录中的完整校验值。重复读取只计算原 provider 日志中发给原文件的 read 调用。

原始记录包含绝对时间和单调持续时间、真实 owner 回执、Main RSS 的采样时刻与模型调用证据。派发到启动包含适配层延迟。Task Trace 的任务排队时间另列。脚本型样本可以验证链路和计算，live 模型收益需要单独的同候选运行。
