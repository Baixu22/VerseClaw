# O02：请求成本与脱敏轨迹

本包沿已有model.call事件与diagnostics-otel插件接线；ObservabilityTraceRecorder不被改造成第二usage服务。完整实施/验收以o02-acceptance.json为准，未产生前不声称完成。

## 显式试用

在已有diagnostics.flags中选择trace.cost-sampling，且保持原diagnostics.otel.enabled=true。成功样本概率复用diagnostics.otel.sampleRate；省略概率为1。移除flag或关闭原OTel即回滚，不改账单/审批/产品锁。外部预加载SDK不能保证接管终态采样时报告不支持，而不是静默通过。

## 口径

run/session/request/attempt使用域分离SHA256；工具通过原toolCallId摘要关联，effect使用既有OTel span/parent身份而非捏造EffectReceipt。仅最终结构化usage参与单次调用估价；目录费率是USD/百万token，随内容摘要版本记录。全零目录常为未知占位，不能冒充免费；未知成本null（OTLP用状态和缺席数值）。

总体计数先于采样，保留样本重算仅代表样本，不是总体账单。固定seed=openclaw.trace.cost-sampling.v1；错误/拒绝/恢复不受概率丢弃。队列1024/批512/TTL五分钟，dedupe4096/五分钟；预算/过期/导出丢失单列。不会声称有限预算支持无限关键样本。无正文或原始身份持久化，无新增store或默认启用。
