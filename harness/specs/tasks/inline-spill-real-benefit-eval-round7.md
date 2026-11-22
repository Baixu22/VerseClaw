---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round7
title: Inline/Spill 原归档锚定与工具日志压力修复
scenario: context-family
taskType: runtime-bridge
diffBase: 1a16bc17a6545bc5fd9a29dd7d314964d97493f3
intent: 修复第六轮归档选择与压测日志来源，先验证确定性对照，再冻结设计并在 clean 候选上取得 B1–B7 同候选通过证据。
touchedAreas:
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-round6-verify.mjs
  - scripts/context-inline-spill-benefit-round7-verify.mjs
  - scripts/context-inline-spill-benefit-strategy.mts
  - tests/unit/context-inline-spill-benefit-strategy.test.ts
  - harness/specs/tasks/inline-spill-real-benefit-eval-round7.md
  - harness/specs/tasks/audit-wiring-quick-fixes.md
  - harness/specs/tasks/audit-wiring-remainder.md
  - harness/specs/tasks/committed-branch-integration-20261109.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/fixtures/context-inline-spill-benefit-round7/**
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
  - .gitattributes
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - disk-temp-policy
  - agent-engineering-acceptance-boundary
  - inline-spill-benefit-quantification
  - inline-spill-eval-projected-input
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-strategy.test.ts tests/unit/context-inline-spill-benefit-clean-candidate.test.ts tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/g7-round7-deterministic --repeats 1 --max-turns 8 --max-output-tokens 900 --strategy anchored --pressure-source tool --provider-timeout-ms 240000 --freeze harness/specs/fixtures/context-inline-spill-benefit-round7/design.freeze.json --actor codex-g7-inline-spill-tf0749-01a1d34c
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round7.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval-round7.md --dry-run
acceptance:
  - 原模型、四臂、语料、oracle、重复数、900 输出 token、5500 字符页与 B1–B7 阈值保持原值；第五、六轮原始证据和失败原字节保留。
  - 两种压力来源对照使用相同健康检查日志字节与回合节奏；工具来源修复增加受同一 16000 工具聚合预算管理的压力，不裁掉日志。
  - anchored 工具说明在四臂一致，模型从初始可见 exec 归档自行选择 URI/checksum 并分页；deterministic 策略仅从可见输入取值，oracle 不进入策略参数。
  - deterministic 独立报告来源、回读与保留正负对照；真实收益以独立冻结后 clean 候选的 96 次 live 与 verifier 为准。
  - 240000ms 单次请求期限在开跑前冻结，四臂相同；无自动重试，错误、incomplete 与全部 usage 保留。
  - B1–B7 全通过、verifier 接受 clean 候选、全部节点验收证据可回读且 base_graph_hash 匹配时自动应用收口提案并 validate/export。
docs:
  required: true
  files:
    - docs/modules/context-and-memory.md
    - docs/context-family/goal-progress.md
---

第六轮的合成健康检查日志由 agent 产生，但作为受保护的 user 文本累积；工具剪枝只能
处理 toolResult。这使 token 成本主要反映被错误赋予 user 来源的日志量。
本轮保留相同日志字节和每次回读后的继续回合，将日志记为 exec 工具观测并保留简短的
user 继续指令。压力工具总量增加，既有工具聚合预算与回读保留窗口保持原值。

原归档锚定、分页与退出说明仅在本评测显式选择；生产 recall 默认值保持原样。
设计、源码、输入来源和旧轮次摘要均在 live 前固定，所有产物标记 agent 驱动。
