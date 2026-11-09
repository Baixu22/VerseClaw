**TF-0659 分支与续接意图已验证，候选 `6ec33a105ebe2f1ba2a2b91885af3f06bde373d8`。**

消息缺少 owner entryId 时仍显示禁用的 Fork 按钮及四语原因；用户消息只从其之前的 assistant 边界派生，保留原问题和草稿。模型普通文字不会创建会话，用户通过现有菜单进入同一预览，确认后才执行。

Handoff 继续使用既有 runtime 来源和 Workspace 持久操作。重试复用 child/send key；同 payload 的新合法 operationId 可独立创建。运行时确认的 generation 替代旧测试中的空 generation 期待。

**114 项不同单测、15 个不同 Electron 场景有通过记录。** 当前真实 Gateway 覆盖精确 Fork 边界、源草稿、一次显式首发、创建回包丢失、首发 unknown 与两次进程重启回读同一 child。两条 Host 故障场景验证迟到回包不覆盖另一个项目。四语缺边界状态、类型、接口、国际化、通信、构建和窄 Harness 检查通过。

原单测 fixture 缺口、旧 generation 期待、首轮整例超时和两次 worker 清理失败保留于 failures。现有进程身份清理器改为优先 PowerShell 7，仅程序不存在才回退；两项真实身份测试与最后整链退出均通过；回归批次的八条通过用例与其中失败用例分别记录。每条原验收标准、故障发生层级和候选差异见 report.json。

U4 由原会话继续开发；U5、U6 和整链验收继续。恢复上下文 RPC 注册缺口单独保留，当前预览使用已显示告警的 fallback。
