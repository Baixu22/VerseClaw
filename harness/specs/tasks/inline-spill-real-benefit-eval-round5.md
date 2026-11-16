---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round5
title: Inline/Spill 第五轮低推理完成行为与收益对照
scenario: context-family
taskType: runtime-bridge
diffBase: 811bdab408bef0dacd894a1e1b5cc6421523fef2
intent: 在同一模型、语料、页预算和900输出上限下显式使用低推理，测量自主回读能否完成真实任务，并保留完整失败与成本口径。
touchedAreas:
  - harness/specs/tasks/inline-spill-real-benefit-eval-round5.md
  - harness/specs/fixtures/context-inline-spill-benefit-round5/**
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-round5-verify.mjs
  - scripts/context-inline-spill-benefit-round5-recompute.mjs
  - tests/unit/context-inline-spill-benefit-input.test.ts
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
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
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-benefit-r5 --repeats 1 --max-turns 8
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round5.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval-round5.md --dry-run
acceptance:
  - 实际请求在四臂均使用同一工具定义、temperature=0、900输出token与显式低推理；96次运行和逐次响应落盘。
  - 复算正确率、配对、输入/输出token、延迟、incomplete和成本；B1-B7阈值与原规则一致。
  - 证据/控制任务和归档选择分开报告，无oracle输入旁路，凭据不进入证据。
  - 原始记录和摘要、SHA256可回读；dirty标记、复算失败、transport error及超页均保留，不改写为通过。
  - 若真实收益不成立，执行节点按完成的实验收口，TF-0749保持未完成；不修改产品默认值或发布授权。
docs:
  required: true
  files:
    - docs/modules/context-and-memory.md
    - docs/context-family/goal-progress.md
---

第五轮使用生产投影和真实模型工具调用，显式低推理仅属于本次评测输入。原模型、900输出预算、样本、四臂和B1-B7保持可比。所有证据为agent驱动，不声称真人参与。
