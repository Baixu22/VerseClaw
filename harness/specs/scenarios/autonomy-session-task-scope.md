---
id: autonomy-session-task-scope
title: 从会话进入任务执行时的显式作用域
type: scenario
requiredRules:
  - identity-scope-boundary
  - autonomy-session-task-scope-boundary
  - durable-task-system-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
---

1. 普通讨论会话没有任务时保持 empty，不因标题或历史文本创建任务。
2. 明确执行意图由现有任务 owner 建立或选择 task，并通过同 session 的 sessionLink 暴露 nodeId。
3. 执行前读取 coordinator binding、workspace、generation、taskRef；不一致时拒绝副作用并保留诊断。
4. Fork 读取同一任务但不继承写 claim；Handoff 使用新 generation 重新绑定。
5. 重新授予写 claim 前回读原 run、工具效果和后台进程的静止状态；准入已接收、缓存过期或任务状态本身不释放 claim。
6. 所有验证产物标 `driven_by: agent`，不声称真人证据或发布批准。
7. Main 在 fork/handoff 中持久化源会话当前显式业务 task 链接；不复制 turn check、缺失任务、其他会话或陈旧 generation 的链接。Renderer 只调用该入口。
8. Fork 与 Handoff 的链接记录其独立运行时 generation。Handoff 先通过 runtime owner 创建并核实父关系，再关联 Workspace 和任务；同一操作恢复时复用 child 和首发 key。
9. 明确执行由 `task_control.start` 原子建立或选择带验收条件的持久合同；首个非纯读工具效果通过专用 runtime → Main 准入复用该 TaskID 和执行 epoch。未知工具需要准入；缺合同、只读引用、陈旧 owner 或没有实际效果 owner 时拒绝写操作。
10. worker 在派发时保存 requester generation 和只读任务引用；父会话后来选择另一任务不改变该来源。worker 后续运行通过原 child 记录重新核验。
