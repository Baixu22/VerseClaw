---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round6
title: Inline/Spill 第六轮 clean 候选收益复核
scenario: context-family
taskType: runtime-bridge
diffBase: fcfd0721129c935df94a501ee4858622c38fa497
intent: 在预先提交的冻结设计和 clean 候选上复跑第五轮四臂协议，保留失败并由磁盘原始证据复算 B1–B7。
touchedAreas:
  - .gitattributes
  - harness/specs/tasks/inline-spill-real-benefit-eval-round6.md
  - harness/specs/fixtures/context-inline-spill-benefit-round6/**
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/scenarios/context-family.md
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-round5-verify.mjs
  - scripts/context-inline-spill-benefit-round5-recompute.mjs
  - scripts/context-inline-spill-benefit-round6-verify.mjs
  - tests/unit/context-inline-spill-benefit-clean-candidate.test.ts
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
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-clean-candidate.test.ts tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/g7-inline-spill-benefit-round6 --repeats 1 --max-turns 8 --max-output-tokens 900 --freeze harness/specs/fixtures/context-inline-spill-benefit-round6/design.freeze.json --actor codex-g7-inline-spill-tf0749-01a1d34c
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round6.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval-round6.md --dry-run
acceptance:
  - 设计在候选实现与实际 provider 调用前独立提交；900 输出 token、低推理、8 轮、5500 字符页及 B1–B7 阈值固定。
  - 开跑与结束的实际 commit/tree/branch/dirty、源码及冻结文件摘要可回读；dirty 或候选漂移保留拒绝与失败。
  - 同一模型、语料、工具定义、投影与压力消息执行 96 次四臂运行，全部请求、响应、工具结果、usage、失败和归档落盘。
  - 原目标与其他归档、页覆盖、原工具 oracle 命中和完成行为分别统计；任务判分仅依据最终精确 value。
  - deterministic 对照保持独立模式；B1–B7 从磁盘复算，clean 候选由 verifier 校验实际 Git blob、清单和原始记录。
  - 第五轮全部字节与失败保留；收益任一必需门失败时 TF-0749 保持原状态，产品默认值、锁和发布状态保持原样。
docs:
  required: true
  files:
    - docs/modules/context-and-memory.md
    - docs/context-family/goal-progress.md
---

冻结设计位于 `harness/specs/fixtures/context-inline-spill-benefit-round6/design.freeze.json`。
先提交设计，再提交评测候选，最后在 clean 候选上执行。所有产物标记
`driven_by: agent`、`actor: codex-g7-inline-spill-tf0749-01a1d34c`、
`realHumanEvidence: false`。

本轮沿用第五轮 recall 策略。证据链修复记录开跑身份、明确 incomplete/轮预算耗尽失败，
修正 verifier 的复算入口并核对归档原始字节。真实收益仍由冻结 B1–B7 决定。
