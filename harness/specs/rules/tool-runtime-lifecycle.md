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

before_tool_call 与插件审批等待被 AbortSignal 取消时，必须重新抛出取消原因，不能改写成 blocked/failure。工具适配器必须把 signal 传入策略链。本地等待 `node.invoke` 时取消不得交付随后成功。process remove 不得终止非后台会话；send-keys 在 stdin 写入完成后仍须检查取消；首次 poll 必须观察已经退出的 child。乒乓警告与 critical 一样需要无进展证据。别名合并只在同一活动周期合并 stuck/long-running 告警年龄；新进展必须保持告警重置，刚创建的空别名不得刷新既有停滞时钟。结果观察器的非取消异常不得把成功工具结果改成失败。

未包装工具适配器也必须在准备、执行和终态处维护取消与进度生命周期。客户端工具委托在预取消时不得预约，预约或完成阶段取消时必须清理预约，不返回 pending 委托。异步 trusted policy 与 hook 返回后先检查取消，再运行下一阶段。

插件审批的登记阶段与决策等待阶段都必须响应取消；取消后的晚到批准不能通知 allow-once/allow-always。process 的 write、send-keys、submit、paste 与 EOF 回调等待必须能取消并清理监听器；取消只结束本地等待，不能假称已经撤回写入。

child 的 exitCode/signalCode 已设置不代表 stdout/stderr 已读完。轮询必须保留未结束的输出流，并沿用执行所有者记录的终态、退出原因与结束时间。已移除进程的晚到退出不得重新登记 finished 条目。

同一 run 的同一 toolCallId 终态投递必须幂等，不能增加循环计数；历史裁剪和会话别名合并后仍须保留去重信息，不同 run 的调用仍须隔离。去重仅保存身份摘要，由既有诊断会话状态统一清理。乒乓无进展证据要求两侧各有至少两次稳定结果，不能把首次观察当作重复；启用该检测器时实际历史窗口至少容纳四条完成记录。
