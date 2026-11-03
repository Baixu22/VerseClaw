---
lifecycleStatus: active
id: context-inline-spill-default-path
title: 默认路径 Inline/Spill 引用闭合与回读稳定性
scenario: context-family
taskType: runtime-bridge
diffBase: 10dd6c472419437800bde7a07ff8e3440929bfc2
intent: 补齐默认 tool-result 截断的 ArchiveHandle 引用，并在显式 opt-in 下为已校验的 archive recall 结果提供有界短期保留；通过带 retention-off 负例的确定性和第三方模型 paired eval 验证回读稳定性、质量、预算与证据边界，不改变既有产品默认值。
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/context-inline-spill-default-path.md
  - harness/specs/fixtures/context-inline-spill/**
  - openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/context-truncation-notice.ts
  - openclaw_runtime/src/agents/archive-recall-retention.ts
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/agent-hooks/context-pruning/**
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/tool-result-context-guard.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.llm-boundary.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/replay-history.ts
  - openclaw_runtime/src/agents/session-transcript-repair.ts
  - openclaw_runtime/src/agents/tool-call-id.ts
  - openclaw_runtime/src/agents/embedded-agent-helpers/openai.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - tests/unit/context-inline-spill-truncation.test.ts
  - tests/unit/context-inline-spill-retention.test.ts
  - tests/unit/context-inline-spill-eval-provider.test.ts
  - tests/unit/config-schema-parity.test.ts
  - tests/unit/native-raw-output-archive-reuse.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
  - tests/unit/runtime-memory-eval-budget-pressure.test.ts
  - tests/unit/runtime-memory-eval-conflict-resolution.test.ts
  - tests/unit/runtime-memory-eval-temporal-evolution.test.ts
  - tests/unit/runtime-memory-eval-topic-drift.test.ts
  - tests/unit/runtime-memory-locomo-benchmark.test.ts
  - tests/unit/runtime-memory-proposal-shadow.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow.test.ts
  - scripts/context-inline-spill-eval.mts
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/rules/context-family-boundary.md
expectedUserBehavior:
  - 默认 oversized/aggregate tool-result 截断发生时，模型能在可见文本中拿到可验证的 archive_uri、checksum、byte_length 和回读方法，而不是只知道“内容被截断”。
  - 未截断、未归档或 archive 创建失败的路径保持现有行为；不会伪造 handle，也不会阻断 turn。
  - 只有显式启用 archiveRecallRetention 时，当前 session 刚回读且来源已校验的结果在四个后续 assistant 轮以内受到保护；达到四轮或超出字符/既有预算后恢复原裁剪路径。
  - 确定性 eval 比较 baseline、reference-visible、recall-stable 和 retention-off negative control，同时报告质量、主上下文、总 token、延迟、成本或 not-run、证据可达性与失败分类；live 证据单独记录。
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
  - pnpm exec vitest run tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts tests/unit/context-pruning-would-trim.test.ts tests/unit/config-schema-parity.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx --expose-gc scripts/context-inline-spill-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-eval
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
  - retention 默认关闭，仅识别 context_archive_recall 成功结果中的匹配 session、非空且非空白的 toolCallId、非负安全整数分页 offset 和 archive identity 来源标记；缺失绑定不得在 ID 重写时被修复为有效来源，普通工具、用户内容、assistant reasoning 和未回读 archive 不获得额外保护。
  - 已校验来源能通过真实 guarded transcript 写入与磁盘重载，details 不复制回读原文且遵守既有 8192-byte 上限；内部 session replay 和 precheck 保留最小来源标记。转换前选择已校验来源，convertToLlm 后按最终可见文本规划 provider truncation，再去除仅用于规划的标记；最终 provider 消息不含 details。评测必须经过这些实际边界，不得绕过持久化或归一化。
  - 单条字符上限按每个回读结果分别判断，总保留量按 16000 字符和 aggregate 剩余空间判断；多个同时符合预算的回读结果不能误用单条上限作为总上限。
  - 保留窗口为 ageTurns < 4，所有受保护模型可见文本总计不超过 16000 字符；重复投影不刷新年龄、不重复注入，不建立持久队列或新 owner store。
  - GC 后 5000 次重复投影保持同一消息数组与内容，heap 增长不超过预登记 2097152 bytes；这属于该有界投影路径的工程测量，不外推为长期产品 soak。
  - 当前默认 pruner 的 retention-off 负例真实移出证据，retention-on 在窗口内保留同一证据，过期后恢复旧路径；严格的单条/aggregate 预算仍优先，容纳不了保留文本时不得放宽预算。
  - 按实际截断结果判断 aggregate 占用，不为完整保留项预扣无用 notice；只有预算无法满足时按最旧到最新释放保留项重新使用既有计划，直至恢复无保留原路径。不得继续返回超出预算的新增保留投影。
  - 转换器新增的可见文本仍受最终 single/aggregate 上限约束；observation-masking 替换在启用保留时也经过正常转换和标记移除，不恢复内部 details。
  - off-mode 的 tool result、pruner、truncation、reduction estimate 和 compaction routing 与实现前冻结产物逐字节比较，未启用时维持旧行为。
  - deterministic paired eval 比较 baseline、reference-visible、recall-stable、retention-off，正臂质量 oracle 通过、引用可达率 100%、缺失/checksum/session/stale 负例 fail closed，同时记录上下文、token、延迟、成本或 not-run、raw transcript 和失败分类。
  - live-provider eval 使用 explicit provider/model/endpoint 类型，记录当前模型、样本数、成功率、usage、延迟和失败原因；没有端点时明确 not-run，不把 deterministic fake provider 标成 live。
  - live-provider 的模型答案无法解析时，仍保留脱敏原始响应、HTTP 状态和提供方已返回的 usage，失败测量不得丢失来源。
  - 所有证据标 driven_by: agent 和具体 actor；不声称真人、产品批准或 GA。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/context-and-memory.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
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
- retention stability 对应同一父线 TF-0704；TF-0703 必须在它完成后补齐负例与稳定回读评测，不能用早期 visibility 结果替代。
- 后端交互遵循 [gateway-backend-communication](../scenarios/gateway-backend-communication.md)，不改变 Main/Host API 与 Gateway 的所有权。
- 完整 fast profile 的既有 lint 错误以删除已退休 Runtime Memory 测试中的未使用声明收复；仅清理无调用的 imports、常量、类型和本地 helper，测试与断言保持原样，不放宽 lint 或恢复退休功能。

## 短期保留契约与回滚

显式开关为 `runtime.contextFamily.archiveRecallRetention.enabled=true`，省略或设为 `false` 均沿旧路径。保留是已有 transcript/tool-result 的短期投影策略，不读写新的原文存储，不启用 observation masking、Tool Search，也不改变 compaction 阈值。

来源标记只在工具完成 archive checksum 与当前 session 校验之后产生，记载 session、archive URI/checksum、分页 offset 和 toolCallId；`recalledTurn`/`ageTurns` 从当前消息序列的 assistant 轮推导。重复调用 pruner 不延长窗口，相同 archive 页只为最近一次回读提供保护。

窗口上限固定为四个后续 assistant 轮（`ageTurns < 4`），总保留文本上限为 16000 字符。预算不足时以现有单条/aggregate 限制为先；全量摘要 compaction 和硬上下文溢出继续由现有 owner 决定，不能通过 retention 无限驻留或绕过这些限制。

实现前的负例与 off-mode 基线单独冻结并保留 source commit、原始命令和 digest，不能用实现后的结果回填旧基线。保留开启、关闭、过期与重复投影均须从磁盘读取 raw transcript 复验。

## 确定性 eval

基线 `baseline` 只看到旧截断提示；`reference-visible` 看到引用并经 agent 驱动调用真实回读工具；`recall-stable` 在同一 pruner 压力下启用保留；`retention-off` 是相同回读输入关闭保留的负对照。评测要求：

1. 同一输入、同一 oracle、同一决策问题；
2. reference-visible 能定位并读取正确原文，recall-stable 能在保护窗口内继续使用它；
3. baseline 无法定位，计为显式失败而非未知；
4. 二者都不得泄露未授权 session 的 archive；
5. retention-off 必须实际再次移出证据，过期正臂必须恢复原裁剪；
6. 结果同时报告质量、主上下文字符/token 代理、真实 provider usage（如有）、总 token、延迟、成本或 not-run、证据 refs resolution、scope/stale、raw transcript 与失败分类；
7. live 请求不包含 oracle 的私有答案或隐藏 details，模型只能依赖实际可见文本。回读由 agent 驱动，不能声称模型自主选择 recall 或完整 agent loop。

live-provider 只作为第二层证据，不改变 deterministic 层结论。
