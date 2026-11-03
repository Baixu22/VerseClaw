---
lifecycleStatus: active
id: context-inline-spill-default-path
title: 默认路径 Inline/Spill 引用闭合与回读稳定性
scenario: context-family
taskType: runtime-bridge
intent: 以 Inline/Spill 的可见性、可达性和稳定性为诊断尺子，补齐当前 main 默认 tool-result 截断路径的 ArchiveHandle 引用投影，并用确定性 paired eval 与第三方模型 live-provider eval 证明质量、证据和成本边界；不改变 observationMasking、Tool Search、compaction 或产品默认值。
touchedAreas:
  - harness/specs/tasks/context-inline-spill-default-path.md
  - harness/specs/fixtures/context-inline-spill/**
  - openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/context-truncation-notice.ts
  - tests/unit/context-inline-spill-truncation.test.ts
  - tests/unit/native-raw-output-archive-reuse.test.ts
  - scripts/context-inline-spill-eval.mts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - 默认 oversized/aggregate tool-result 截断发生时，模型能在可见文本中拿到可验证的 archive_uri、checksum、byte_length 和回读方法，而不是只知道“内容被截断”。
  - 未截断、未归档或 archive 创建失败的路径保持现有行为；不会伪造 handle，也不会阻断 turn。
  - 确定性 eval 同时报告质量、主上下文、总 token 代理、延迟、证据可达性和失败分类；第三方模型结果与 deterministic 结果分开记录。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - backend-communication-boundary
  - disk-temp-policy
  - docs-sync
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/context-inline-spill-truncation.test.ts tests/unit/native-raw-output-archive-reuse.test.ts tests/unit/context-archive-recall.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-eval
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness context --spec harness/specs/tasks/context-inline-spill-default-path.md
  - pnpm harness validate --spec harness/specs/tasks/context-inline-spill-default-path.md
acceptance:
  - 默认 truncation replacement 的模型可见文本包含 archive_uri、checksum、byte_length 和 context_archive_recall 指令；handle 缺字段或不可读时不声称可回读。
  - 引用加入后仍遵守既有单条/aggregate 字符预算；tool-call 结构、head+tail 截断语义和现有 lifecycle metadata 不变。
  - 不修改 observationMasking、Tool Search、compaction 阈值、产品锁或冻结默认值；flag/enablement 行为与当前 main 一致。
  - deterministic paired eval 至少比较 baseline、reference-visible 两种策略，质量 oracle 通过、证据可达率 100%、负例不被写成通过，并同时记录上下文、token、延迟和失败分类。
  - live-provider eval 使用 explicit provider/model/endpoint 类型，记录当前模型、样本数、成功率、usage、延迟和失败原因；没有端点时明确 not-run，不把 deterministic fake provider 标成 live。
  - 所有证据标 driven_by: agent 和具体 actor；不声称真人、产品批准或 GA。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/context-and-memory.md
---

# 默认路径 Inline/Spill 引用闭合

本任务不是重建上下文系统，而是验证并修补当前默认路径上的一个具体断点：

```text
tool result 过大
  -> 被截断并归档
  -> lifecycle metadata 有 handle
  -> 模型可见文本没有 handle
  -> 模型无法主动读回
```

内联部分（近期工作记忆、工具摘要、budget）已有 owner；本任务只补 Spill 后的引用可见性和 eval 证据。

## 边界

- 复用 `ArchiveHandle`、`context_archive_recall`、现有 truncation/replacement 链。
- 不开启 observation masking，不开启 Tool Search，不改 compaction 默认值。
- 不新增第二套持久化 authority。
- retention stability 作为同一父线的下一叶，不在本叶伪装成已完成。

## 确定性 eval

基线 `baseline` 只看到当前“内容被截断”的提示；`reference-visible` 看到可验证 archive 引用。评测要求：

1. 同一输入、同一 oracle、同一决策问题；
2. reference-visible 能定位并读取正确原文；
3. baseline 无法定位，计为显式失败而非未知；
4. 二者都不得泄露未授权 session 的 archive；
5. 结果同时报告质量、原文字符、可见字符、token 代理、延迟和失败分类。

live-provider 只作为第二层证据，不改变 deterministic 层结论。
