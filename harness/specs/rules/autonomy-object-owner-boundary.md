---
id: autonomy-object-owner-boundary
title: 自治对象引用保留既有 owner 和完成权威
type: ai-coding-rule
severity: error
---

新自治边界复用 identity-scope 的品牌身份和 owner 回读的会话代。必须显式传入
project/workspace/session/generation，不能从标题、ID 字符串或静态 manifest 推断。
Task Forest 外部引用是单向关联：execution anchor 的 Ledger ID 不成为 Forest 完成权威。

System/Project/Session 是 AgentSummary/RoleContract 的职责范围，不是新 principal。
语义合同只校验字段与来源；授权、工具效果和资源生命周期仍由既有 Main/runtime owner 执行。
拒绝未知或混合 owner、裸 taskId、完成/授权字段、跨 scope 和陈旧 generation。
合法的引用不等于可用能力；owner 不存在或不可读时不得生成 grant 或副作用。
