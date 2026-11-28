# D 进程身份修复限定审查

核验日期：2026-11-28

## 检查绑定与状态

- 源码：D:/tmp/session-collaboration-mainline-20261126/E/source
- HEAD/base：25118d45eb3bdedefbbe45f8250cec7a2e735b41
- 暂存 tree：c4fb62bdaa9feddf108084be47529cec0ad496df
- 外部补丁：D:/tmp/session-collaboration-development-closeout-20261128/root-exit-identity.patch
- 补丁状态：尚未应用到上述 source tree。本次只读审阅补丁和相关源码，没有修改源码、运行测试或复算完整开发验收。

## 结论

复读完整补丁后，先前报告的 token 回填 finding 不成立：补丁已将异步 creationToken 回填条件从 owned.canSignal() 改为 owned.rootActive()。已退出的 child 即使因继承 stdio 尚未 close、adapter.wait 仍 pending，也不会把异步捕获结果回填为原运行的进程身份。快照也使用同一个 rootActive 状态。

child adapter 以 childExitState、exitCode、signalCode、waitResult 和 waitError 识别其观察到的退出/错误状态；pty adapter 以 onExit 设置的 waitResult 判断。supervisor 对缺少 isRootActive 的 adapter 采用 fail-closed 语义。该设计解决 adapter.wait 完成晚于 root exit 时的活跃状态滞后，并将 token 回填、生命周期快照和成功结果门控统一到 root 活跃状态。

资源采样侧已按 supervisor run 的 PID 与 creationToken 绑定根进程；Bash handle 还需与同一 runId 和 PID 对应的 supervisor run 匹配。身份缺失、变化或句柄不稳定会将投影置为 unknown。

## 测试覆盖提示

补丁当前新增测试先让首次 creationToken capture 完成，再将 mock rootActive 设为 false。因此它验证退出后快照变为 inactive，但没有直接覆盖“首次 token capture 延迟返回，期间 root 退出”的回填门控竞态。建议补一个该次序的断言；主线已计划随补丁应用加入。该项是测试覆盖提示，不是当前补丁中的代码 finding。

## 审查结论

对限定的 root-exit 与进程身份修复，待应用补丁没有发现剩余代码缺陷；应用后仍需运行对应测试确认新测试与实际适配器接口吻合。当前 c4fb62b 暂存候选尚不包含此补丁。