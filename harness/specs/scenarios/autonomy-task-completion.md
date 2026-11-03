---
id: autonomy-task-completion
title: 自动完成声明从执行验证到任务 owner 的可回读提交
type: scenario
requiredRules:
  - identity-scope-boundary
  - autonomy-task-completion-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
---

1. Agent 对自动业务任务产生 `completed` 结果时，先读取该任务当前 generation 和 candidate digest。
2. Agent 读取 Evidence Verifier、TaskLoop/Workboard 与 effect owner 的同候选回执，不把模型自述当证据。
3. 所有 binding 一致、verifier approved 且 effect owner 为 applied 时，提交一个带 prior status 的 Task Ledger 完成事件。
4. 任一 binding 不一致或证据不足时拒绝，保留任务原状态并写出可回读诊断。
5. 撤销后恢复事件记录的 prior status；不由 UI 猜测或覆盖其他 owner 状态。
6. 所有产物标 `driven_by: agent`，不声称真人证据、发布批准或冻结默认变化。
