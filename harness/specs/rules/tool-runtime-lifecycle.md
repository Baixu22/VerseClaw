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

工具执行成功或失败后必须关闭该次调用的进度回调。异步策略拒绝、失败或结果观察器触发取消时，最终交付必须保留运行的取消原因；自动审批不能在取消后继续登记、批准或启动新的后台跟进。

远程 exec 的可见结果必须同时保留 stdout、stderr、错误原因和超时事实。直接执行、prepare 和审批路径均须传递发起消息的投递身份，不能丢失取值为 0 的 thread 标识。

process 的取消守卫必须先于写入、EOF、终止进程或消费待取输出。首次观察到进程退出的 poll 与后续 finished poll 必须保留一致的 exitCode 和 exitSignal；没有退出码不得伪造为成功码 0。

循环警告的首次投递不受十次限频桶的起点影响。同一个 run 内，工具调用结果优先通过 toolCallId 与原始请求关联，支持策略返回新参数和原地改写参数；无调用 ID 时才按参数匹配。sessionId 与 sessionKey 别名合并后的历史必须按发生时间排序，旧输出不能覆盖新的真实进展。
