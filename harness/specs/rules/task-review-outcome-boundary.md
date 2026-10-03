---
id: task-review-outcome-boundary
title: Task Review Outcome Boundary
type: ai-coding-rule
appliesTo:
  - task-forest-review-outcomes
---

`review_needed` 表示等待作出复核结论，不是已经结束工作的永久状态。

- 实际验收通过后写入 `done`，记录通过的范围与证据。
- 发现可执行缺陷时写入 `in_progress`，直接修复并复验，不以重复交接代替处理。
- 只有确实依赖外部条件、真人证据或必要凭据时使用 `blocked`，列明具体解除条件。
- API-only 撤下决策、清理任务与新增生产能力按各自验收条件判断；决策完成不表示原先撤下的能力已实现。
- 旧的降级裁决和半径读数保留为历史事实，不得借状态收口改预算、改验收条件或解锁生产能力。
- 已通过的局部修复可记录为 `done` 子任务；全局门禁未通过的父节点不能一起标记完成。
- 已绑定的验收矩阵只要含失败或未运行项，就不能声称 `done`；哈希匹配只证明文件一致，不证明验收通过。
- Task Forest 只能通过 CLI 更新。复核结束后应给出明确状态和可验证结果。
