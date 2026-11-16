---
lifecycleStatus: active
id: inline-spill-real-benefit-closeout
title: Inline/Spill 封存收益证据复算与收口判定
scenario: context-family
taskType: documentation
diffBase: 8ad73dd4b552c2fd2465034eb2b06d51dc7a4388
intent: 从第二轮和第三轮封存产物复算收益判据，补齐候选归档、源码绑定和失败定位，按实际结果记录 TF-0749 状态。
touchedAreas:
  - harness/specs/tasks/inline-spill-real-benefit-closeout.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/fixtures/context-inline-spill-benefit-closeout-20261108/**
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
expectedUserBehavior:
  - 读者能从原始请求、响应、工具结果和归档复算 B1-B7，以及证据任务与控制任务的配对差异。
  - 只有完整收益验收满足时才关闭 TF-0749；失败结论同时给出可执行的下一轮最小实验。
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - disk-temp-policy
  - inline-spill-benefit-quantification
  - inline-spill-eval-projected-input
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-closeout.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-closeout.md --dry-run
acceptance:
  - 第二轮47文件、第三轮37文件以及旧机制105文件保持原字节，原始清单全部匹配；回读原始归档并验证校验和与长度。
  - 两个候选目录的未跟踪材料以及原工作树的四个冻结未跟踪文件先归档，恢复索引记录逐文件SHA256、压缩包SHA256和源码HEAD/dirty。
  - 第二轮和第三轮的deterministic/live结果由原始逐次记录复算，B1-B6、usage、配对和失败保留原评分值；B7从清单、归档和凭证扫描重新验证。
  - 第三轮B3原始flag及证据/控制配对分别记录，控制任务差异不能被写成证据回读收益。
  - 第三轮所有实际请求的模型、温度、900输出token预算、输入哈希和投影来源回读一致；不增加live调用。
  - 报告明确列出B2/B4/B5/B6与投影页/输出预算的具体缺口、复算入口和下一轮最小实验；不修改冻结的评分、oracle、四臂、压力或产品默认。
  - 相关单测、无缓存类型和所选Harness门禁有磁盘结果；完整包有SHA256SUMS与零命中的凭证扫描。
  - TF-0749收益标准未满足时保留既有字段，运行Task Forest validate/export并读回；收益满足时才通过proposal工作流更新节点。本地历史和交接保留本地。
---

服务于 TF-0749。执行顺序为候选归档、封存证据回放、源码绑定、相关门禁、判定与本地 Task Forest 读回。

本轮复用两个封存目录中的 `verify-evidence.mjs`、`recompute.mjs`、`verify-run.mjs` 和 `diagnose-run.mjs`。新的复核结果写入独立目录；原始运行的候选、评分和清单保持原样。

下一轮评测适配在独立 spec/proposal 中冻结后执行，具体设计见本轮证据目录的 `NEXT-EXPERIMENT.md`。
