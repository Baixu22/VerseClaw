---
id: harness-gap-trace-cost-sampling
title: 关联每次模型调用成本与有界脱敏轨迹采样
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: O02沿真实model.call诊断生产者和唯一diagnostics-otel出口补齐关联/usage/价格与可重放采样；不另造usage服务，不改账单、默认配置或产品锁。
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - openclaw_runtime/src/infra/diagnostic-events.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-call-usage.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/service.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/cost-sampling.ts
  - openclaw_runtime/extensions/diagnostics-otel/api.ts
  - tests/unit/harness-gap-trace-cost-sampling.test.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/cost-sampling.test.ts
  - harness/specs/tasks/harness-gap-trace-cost-sampling.md
  - harness/specs/rules/trace-cost-sampling-boundary.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/dev/harness-gap-closure/o02-trace-cost-sampling.md
  - docs/dev/harness-gap-closure/o02-acceptance.json
  - docs/dev/harness-gap-closure/O02-SHA256SUMS
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
ownedPaths:
  - .gitignore
  - scripts/repository-artifacts.json
  - openclaw_runtime/src/infra/diagnostic-events.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-call-usage.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/service.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/cost-sampling.ts
  - openclaw_runtime/extensions/diagnostics-otel/api.ts
  - tests/unit/harness-gap-trace-cost-sampling.test.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/cost-sampling.test.ts
  - harness/specs/tasks/harness-gap-trace-cost-sampling.md
  - harness/specs/rules/trace-cost-sampling-boundary.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/dev/harness-gap-closure/o02-trace-cost-sampling.md
  - docs/dev/harness-gap-closure/o02-acceptance.json
  - docs/dev/harness-gap-closure/O02-SHA256SUMS
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - trace-cost-sampling-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/harness-gap-trace-cost-sampling.test.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/cost-sampling.test.ts
  - tests/unit/runtime-trace-context-contracts.test.ts
  - tests/unit/trace-truncation.test.ts
  - tests/unit/rc08b-otel-observability-convergence.test.ts
  - openclaw_runtime/src/observability/rc08b-otel.test.ts
acceptance:
  - 显式选择已有diagnostics.flags中的trace.cost-sampling且原OTel服务开启时才启用O02；默认/关闭路径保留原事件及导出行为，不改schema/default/账单。
  - 模型调用的host requestId与attempt trace身份稳定，重试callId复用也不碰撞；run/session/request/attempt以带域SHA256去标识，模型产出的toolCallId摘要连接实际tool span，effect保留已有OTel parent链与原生span身份，不伪造domain receipt。
  - 仅消费最终done/error消息的结构化usage；缓存与非缓存token分别记录；重复终态不累加、乱序partial不覆盖终态、缺终态/取消/缺usage/非法值显式缺测，不改变流的值、调用次数、异常或取消结果。
  - 价格为本次runtime模型目录的USD每百万token费率快照与内容摘要版本；缺失/非法/全零未知价格costUsd=null，不将未知价冒充免费，不修改原始usage.cost。
  - 唯一OTel出口内部结束时采样，固定seed和traceId决定成功样本；错误/拒绝/恢复不被概率采样丢弃；每个保留样本包含选择原因/概率/策略版本，未采样总分母与缺失/未知/重复/丢弃各自记录，不把样本集冒充总体。
  - 单出口队列最多1024项、批次最多512、保留300000ms，优先淘汰普通成功项；满关键项/过期/导出失败显式计数并保留不足声明，不承诺无限负载永不丢失；dedupe历史最多4096项/300000ms，退役水位拒绝旧重复，不重复计费。
  - 本地确定性fixture在无预算溢出时关联率100%、重复计费0；同一脱敏OTLP事件集独立重算相同已测成本；新轨迹不含prompt/tool正文/认证头/原始标识。
  - 真实模型流包装器与真实插件服务通过本地中立HTTP OTLP collector贯通；成功/错误/拒绝/恢复/取消/重复/乱序/过期/预算/导出故障及关闭回滚都有原件和continuation。
  - 干净候选完整fast/comms、所列定向门、无缓存类型/适用lint、独立核验、摘要及凭据扫描通过才收口；B00/O01历史来源字节不改，不宣称真实provider/真人/全局GA。
expectedUserBehavior:
  - 显式O02诊断模式导出可归因的单次调用估价和有界脱敏样本；未知和缺失状态保留，不替代账单。
  - 无此flag或原OTel关闭时行为不变；移除flag恢复原出口，不执行数据迁移。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/o02-trace-cost-sampling.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

# O02冻结实施边界

B00的候选路径只是定位，不是必须改造的架构。当前源码证明ObservabilityTraceRecorder仅被role-first-observer直接使用；真实调用由attempt.model-diagnostic-events与diagnostics-otel导出。依RC-08B只扩展这个唯一出口，不向Main引入重复计数、不新建trace/usage持久store。

复用现有flag选择器，不增加配置键。试用策略固定seed=openclaw.trace.cost-sampling.v1；成功概率复用diagnostics.otel.sampleRate（未填=1）；延迟复用flushIntervalMs（未填=5000ms）。O02使用AlwaysOn本地记录后按终态选择，才能保留后发生的错误。预加载外部SDK无法接管采样时明确报告不支持O02，不静默声称策略生效。

所有总体统计在采样前计数；已知成本合计/未知数量/总体分母与保留样本重算是两种不同口径。OTel数值属性不能表达null时以cost.state=unknown和缺席数值表示未知；原始typed诊断中costUsd保持null。固定保留期限和容量是诊断预算，不是安全阈值。超预算关键样本缺口必须显式报告，不以概率选择掩盖；关闭清空队列、计数/去重状态均不回写产品账本。

仅在既有生产terminal上附加诊断数据；abort/缺terminal不得生造成功usage，不改模型回调和工具批准语义。生产者新增字段走已有DiagnosticEventPayload公开类型；插件仅从plugin-sdk导入core，测试从插件public barrel/本地源码入口。
