---
id: autonomy-task-completion-boundary
title: 自动任务完成声明必须复用既有 owner 且 fail closed
type: rule
appliesTo:
  - autonomy-task-completion
  - autonomous-project-system
---

# 自动任务完成边界

1. 完成提交必须绑定同一个 task、candidate digest、generation、verifier receipt 和 effect receipt；任一不一致均拒绝。
2. `completed`、`repair`、`blocked`、`unavailable`、`accepted`、run 结束、exit 0 或模型文本都不能单独产生 `done`。
3. approved verifier 只有在同一 candidate/generation 的 effect owner receipt 也为 applied 时才可生成 node->done 转换；实际写入仍经 Task Ledger 既有事件投影。
4. 不得新增第二个 verifier、completion decision 服务、TaskLoop 状态机或独立 decision store。
5. Evidence 缺失、hash 不符、TTL 过期、task/generation 不符、伪造 reviewer 或缺失 artifact 时 fail closed。
6. 原始证据正文不进入完成事件；只保存 refs、digest、finding codes、candidate/generation 和 prior status。
7. 撤销必须回到事件记录的 prior status，不得猜测旧状态；已为 done 的任务不得重复提交。
8. 本节不授权发布、产品锁、默认值、凭据或跨 scope 权限变化。
