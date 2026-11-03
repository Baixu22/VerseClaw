---
id: autonomy-session-task-scope-boundary
title: 会话任务作用域只能从显式 owner 绑定解析
type: rule
appliesTo:
  - autonomy-session-task-scope
  - autonomous-project-system
---

# 会话任务作用域边界

1. 任务身份必须来自显式 active task node 与同 session 的 Task Ledger sessionLink；不得从标题、ID 字符串或他人链接推断。
2. coordinator binding、workspace、generation 与 taskRef 必须一致；缺失、陈旧、跨项目或不可读时 fail closed。
3. 本解析只读。它不创建任务、不改状态、不建立第二任务账本，也不授予完成权威。
4. Fork 可读取已链接任务，但必须重新取得写 claim；不得继承父会话的写 lease。
5. Handoff 后旧 generation 的写 claim 失效；重新绑定后才能产生副作用。
6. 任务未变化时绑定已有任务不得改动其完成状态；连续普通讨论不创建业务 task。
7. 外部 Forest 任务只能作为 execution anchor 的 externalRef；不得把 externalRef 当作 Task Ledger done。
