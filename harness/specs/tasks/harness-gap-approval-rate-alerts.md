---
id: harness-gap-approval-rate-alerts
title: 审批分类率的受控诊断告警与清除
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 在现有运行时分类计数与diagnosticLogger间连接有限窗口告警；只做O01，不生成审批、不把分类计数当真人/UI提示次数、不改配置默认或产品锁。
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - openclaw_runtime/src/context-engine/coding-observability.ts
  - openclaw_runtime/src/agents/write-destructive-tier.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - tests/unit/harness-gap-approval-rate-alerts.test.ts
  - harness/specs/tasks/harness-gap-approval-rate-alerts.md
  - harness/specs/rules/coding-approval-rate-diagnostics.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/dev/harness-gap-closure/o01-approval-rate.md
  - docs/dev/harness-gap-closure/o01-acceptance.json
  - docs/dev/harness-gap-closure/O01-SHA256SUMS
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
ownedPaths:
  - .gitignore
  - scripts/repository-artifacts.json
  - openclaw_runtime/src/context-engine/coding-observability.ts
  - openclaw_runtime/src/agents/write-destructive-tier.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - tests/unit/harness-gap-approval-rate-alerts.test.ts
  - harness/specs/tasks/harness-gap-approval-rate-alerts.md
  - harness/specs/rules/coding-approval-rate-diagnostics.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/dev/harness-gap-closure/o01-approval-rate.md
  - docs/dev/harness-gap-closure/o01-acceptance.json
  - docs/dev/harness-gap-closure/O01-SHA256SUMS
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
  - coding-approval-rate-diagnostics
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/harness-gap-approval-rate-alerts.test.ts
  - tests/unit/harness-gap-baseline.test.ts
  - openclaw_runtime/src/agents/tools/write-destructive-tier.test.ts
acceptance:
  - 真实工具工厂只在config.diagnostics.enabled显式true时传递监测选择，进程诊断关闭仍否决；省略和false保持仅累计计数，不产生新告警。
  - 监测窗口最多100个布尔分类/时间戳，每20个新有效分类评估，至少20样本；rate为requires-approval分类次数除以总分类次数，绝不声称UI提示或真人审批次数。
  - 连续两次窗口rate大于等于0.5触发，已告警状态只有连续两次rate小于等于0.3才清除；重复读取不增加连续窗或重复日志。
  - 五分钟TTL、零或不足样本、无效或回退时钟返回unavailable且rate为null；历史窗口不能制造正常/清除。
  - 工具分类到窗口到已有诊断日志的真实链路有高率、清除、缺测和恢复证据；日志包含样本、窗口、范围、原因和建议，不含工具参数或用户内容。
  - 日志消费者抛错不得影响工具结果或分类累计；下一次观察可重试，关闭后恢复旧行为且不重放旧窗口。
  - classifier函数、原snapshot/rates语义、配置schema/default、产品锁不变；无Main重复单例、后台定时器、持久store或新指标服务。
  - 干净候选的必需门、真实文件日志回读、独立核验、摘要和凭据扫描通过才收口，不修改B00历史来源摘要或旧失败来制造通过。
expectedUserBehavior:
  - 显式开启现有运行时诊断时，可在已有诊断日志中查看分类率告警/清除；关闭或缺省时不启用此监测。
  - 这些诊断不批准、不拒绝、不重复执行任何工具；未测窗口不显示为健康。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/o01-approval-rate.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
  note: 日志诊断行为增加，四语言说明同步；没有新增UI或host API。
---

# O01预登记边界

参照docs/dev/harness-gap-closure/design.md。进程内生产路径是agent-tools.ts创建工具→write-destructive-tier.ts分类→codingObservability→现有diagnosticLogger/log.record；不在Electron Main再导入一份单例冒充运行时计数。

内部诊断试用参数固定为100/20/20、0.5与0.3两窗、TTL=300000ms；只在显式诊断选择下使用，不是安全/审批阈值，不新增配置键或修改冻结默认。记录连续监测调用，旧累计prompts/skips无损保留；未监测调用不回填历史。

缺测不自动清除成健康；没有后台定时器，过期在下一次观察或读取时识别，日志携带expiresAt以免把静态旧记录当实时健康。作用域是单运行时进程，不声称per-run或跨进程聚合。

本包不涉及UI、真实模型、pilot、速率熔断或全系统GA。回滚通过关闭已有diagnostics或省略显式选择验证，保留原累计计数和执行行为。

接力恢复仅增加证据trace的工具名/分类详情，以及四份README和精准留存清单。B00已跟踪的七个基线文档只补齐retainedFiles登记，文件及历史摘要字节不变；不扩展本包产品行为。

TTL边界的精确补样允许连续确认；任何正持续时间的不足样本区间，即使到达样本把数量恢复到20，也使旧确认失效。按到达前的TTL覆盖推断，不新增后台定时器。
