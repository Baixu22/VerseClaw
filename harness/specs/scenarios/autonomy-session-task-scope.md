---
id: autonomy-session-task-scope
title: 从会话进入任务执行时的显式作用域
type: scenario
requiredRules:
  - identity-scope-boundary
  - autonomy-session-task-scope-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
---

1. 普通讨论会话没有任务时保持 empty，不因标题或历史文本创建任务。
2. 明确执行意图由现有任务 owner 建立或选择 task，并通过同 session 的 sessionLink 暴露 nodeId。
3. 执行前读取 coordinator binding、workspace、generation、taskRef；不一致时拒绝副作用并保留诊断。
4. Fork 读取同一任务但不继承写 claim；Handoff 使用新 generation 重新绑定。
5. 任务完成后写 claim 释放；观察者、验证者和协调者只读取各自获准的投影。
6. 所有验证产物标 `driven_by: agent`，不声称真人证据或发布批准。
