---
id: harness-gap-closure-plan
title: Harness缺口闭环规划与本地任务DAG
intent: 校正缺口摘要中的实现判断，定义30个可执行工作包的开发、测试、验收和回滚，并通过Task Forest CLI保存应用；不在本任务实施运行时功能或改变产品锁。
touchedAreas:
  - docs/dev/harness-gap-closure/design.md
  - harness/specs/tasks/harness-gap-closure-plan.md
ownedPaths:
  - docs/dev/harness-gap-closure/design.md
  - harness/specs/tasks/harness-gap-closure-plan.md
requiredProfiles:
  - fast
requiredRules:
  - task-forest-autoclose-and-roles
  - docs-sync
humanEvidence: not-required
requiredTests:
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
acceptance:
  - 30个来源槽位均有唯一主责任包，HG22与HG27明确来源不全，不虚构原文或能力。
  - 6阶段30工作包包含明确依赖、开发、定向测试、生产入口验证、验收、回滚与证据合同。
  - 保留已有窄sink策略、局部ablation和Working Context实现，不重复立项；classification-only不被误解为全部路径无拦截。
  - 一次ablation不替代安全验收、六个pilot各自门限或产品授权；默认值和产品锁不变。
  - 本地Task Forest proposal-save/apply/validate/export通过，无新增done实现节点；详细状态仅在本地任务图维护。
  - 本次规划结构验证与未执行的产品测试分开报告；dirty范围冲突不得用no-diff掩盖。
  - 后续通信改动从独立task spec开始并引用gateway-backend-communication；本规格不授权全运行时写入。
expectedUserBehavior:
  - 接力agent从首个ready包核准基线开始，按依赖一次推进一个工作包，每包具有可核验完成标准。
  - 模拟执行如实标driven_by=agent和actor，缺少真人操作或数据不成为验收前置。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/design.md
  note: 本次仅新增规划合同，没有产品行为或接口变化；已复核README及中日翻译，产品宣传不变。
---

# 范围

持久设计见 [开发—测试—验收合同](../../../docs/dev/harness-gap-closure/design.md)。
本任务只验证规划结构，requiredTests不代表运行时缺口已通过。
Task Forest、提案、原始规划检查与会话交接保持本地，不作为干净检出构建前提。
新功能落地时复用或补充本包窄task spec，不能用本规格的文档范围覆盖其他改动。
