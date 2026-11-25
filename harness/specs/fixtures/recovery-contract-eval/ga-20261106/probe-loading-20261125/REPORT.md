# G3 readiness 探测加载修复（2026-11-25）

源码 `cb7b9c98eea55f6ed0775fe56944fddcff019684`，基线 `93199c6b0`；所有操作与验证均由 agent 执行。

旧连接处理器在发送 challenge 后立即导入完整鉴权/RPC 模块，连只接收 challenge 后退出的 readiness 探测也会触发。现在首个请求帧才启动导入。原队列处理集中在 `message-handler-loader.ts`，保留 16 帧上限、串行处理、异常传播与已认证 presence 权限；关闭连接会清理排队帧，阻止迟到的 handler 挂载。

真实编译产物 + loopback WebSocket 对照：探测额外加载模块 **128 → 0**，响应单样本 **971.8 → 8.3 ms**。这个指标测量 challenge 探测；完整重启恢复另需验收。超大首帧 65,537 字节被既有 64 KiB 限制以 1009 拒绝，仍为 0 额外模块。

验证已完成：

- 46 项回归通过：Runtime 10、桌面连接与设备令牌 36；旧代码复现 2 项失败。
- 修改源码/测试依赖类型、3 文件严格 lint、Runtime 六项源码检查、通信回放/比较、目标 Harness validate/dry-run 通过。
- Runtime 生产构建和 Gateway 启动通过。真实 Electron 鉴权、health RPC、重新连接、进程退出通过；ready 13.083 s，完整测试 53.250 s。源码稳定与自有进程清理通过。
- WorkBuddy `ccs-workbuddy/deepseek-v4.1-flash` 纯文本最终复核无可操作缺陷。第一轮两项疑虑由实际 server 构造、ws Receiver 和鉴权时限所有者代码核验并交回复核。

本轮故障恢复矩阵未完成：意图、效果与子任务三个窗口的 `taskkill.exe` 注入均失败；存储写失败窗口通过；连续重启缺最终回执。运行器随后消失，未生成聚合/正式 teardown。已按该轮 PID+创建时间检查，记录的 Electron 自有进程无存活。独立创建的 Node 子进程也连续复现 `taskkill` 超时，诊断产物保留。另一个初始 Electron 跑次与 lint 准备中断，最终独立跑次已通过。

**GA 保持 NO_GO**。上一批完整矩阵的连续三次重启为 37.840 s，仍高于冻结的 15 s 尾时延目标；本轮没有新的完整恢复时延结论。两臂重复、live-provider 与完整发布门禁继续待完成。

`report.json` 绑定 8 份源码/文档，`evidence.json.gz` 保留 101 份原始记录，含失败回执和审查输入输出；每项有 SHA256。原始目录 `D:/tmp/g3-probe-loading-20261125-r45`。

复核命令：`python D:/tmp/g3-probe-loading-20261125-r45/plain-review-r2.py`。原则参考上轮 VerseSearch 的 [Electron 官方性能指南](https://www.electronjs.org/docs/latest/tutorial/performance)；本轮实现取舍由本地复现和真实依赖源码验证。
