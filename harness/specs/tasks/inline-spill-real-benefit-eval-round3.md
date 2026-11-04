---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round3
title: Inline/Spill 第三轮投影输入与配对对照修复
scenario: context-family
taskType: runtime-bridge
diffBase: 622bb5e04c787b55999fb06ed50aadb4784d0875
intent: 修复第二轮评测中未投影工具历史的旁路、两压力臂的输入身份差异与主上下文计量错误，再按原冻结口径执行第三轮；不保证收益判据通过。
touchedAreas:
  - harness/specs/tasks/inline-spill-real-benefit-eval-round3.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/fixtures/context-inline-spill-benefit-round3/**
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-input.mts
  - tests/unit/context-inline-spill-benefit-input.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - 已被生产投影淘汰的回读内容不能通过额外 function_call_output 再进入模型输入。
  - 两压力臂首轮完整请求逐字节相同，后续差异来自模型行动与 retention 的投影效果。
  - 实际发送输入、usage 与正确率共同决定结果，失败不得被调阈值消除。
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - disk-temp-policy
  - agent-engineering-acceptance-boundary
  - inline-spill-benefit-quantification
  - inline-spill-eval-projected-input
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-benefit-r3 --repeats 1 --max-turns 8
  - pnpm exec vitest run tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round3.md
acceptance:
  - provider 的每个 function_call_output 只能从当轮生产投影的对应 toolResult 生成；不存在原始工具历史回退，正文与协议输出不重复携带回读文本。
  - 模型返回的 function_call 与实际回传的 output 保留 call_id 对应关系；脚本不替模型决定是否 recall。
  - 24 对 live 首轮完整请求 SHA256 相同，固定语料、oracle、温度与压力消息保持不变；不得声称后续模型响应也逐字节相同。
  - mainContextChars 从实际发送的 input JSON 字符数求得；完整请求字符数、UTF8字节、逐次原始请求和响应另外保留。
  - deterministic 复现 baseline 0/6、两正臂6/6、retention-off低于recall-stable，控制任务全部通过。
  - live 覆盖4臂乘8任务乘3次，统计与B1-B7由原始产物复算，费用允许明确not-run，任何未通过项原样保留。
  - 新证据单独封存在 context-inline-spill-benefit-round3；第二轮47文件与旧机制105文件不修改；SHA256全匹配，凭证扫描0命中。
  - 产品代码、产品锁、默认值、compaction、B1-B7阈值、四臂开关、语料、压力内容、评分语义、max_output_tokens=900均保持不变；retention仍显式opt-in。
  - 全部产物标记driven_by为agent与具体actor；不声称real-human、GA或release-approved。
---

# 第三轮仅修评测的输入边界

服务于 TF-0749，执行节点 TF-0755。第二轮已完成并封存，剩余问题有磁盘证据：原始工具历史绕过投影、配对URI/session不同、mainContextChars遗漏额外输入。

本轮复用同一生产 truncation/pruner/recall 组件。保留 function_call 元数据，但回传输出只从当轮生产投影取得；被遗漏的结果返回明确的 projection_omitted 诊断。prompt 正文不再重复列出已通过协议回传的回读结果。

recall-stable 与 retention-off 使用相同配对 session 身份。retention 无全局队列，来源为当前消息中的已校验 lineage；两臂各自构造消息，因此共享 archive 地址不复用另一臂的对话状态。

统计仍执行既有评分器与规则，第三轮允许结果为 mechanism-only/no-benefit/inconclusive，不通过预算时保持父节点未完成。输入装配与度量修复属于当前评测任务，不推广到 Electron/Gateway 产品回合。
