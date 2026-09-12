---
id: tool-runtime-lifecycle
title: 工具运行生命周期
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
---

工具被取消后，尚未启动的副作用不得启动；已经交接给后台所有者的进程保留既有后台语义。

前台 exec 的心跳、输出与最终结果必须遵守同一运行生命周期。取消或进程退出后不得向已结束的消费者发进度。

工具提示只推荐当前授权且可用的后续操作。前台模式不得引导调用被禁用的 process 工具。

critical 工具循环是运行时终止原因，不能被当成 Provider 错误重新尝试其他模型。warning 保持非终止语义。

运行和会话隔离必须使用实际调用者提供的身份；缺省 sessionKey 但存在 sessionId 的调用同样受循环守卫约束。循环历史按 run 独立裁剪。取消产生的错误和已取消调用的晚到成功结果不得当作循环证据或有效完成。process poll/log 的 idle 时长提示不得当作进展。
