# TF-0773 MCP结果、取消和会话恢复验收

acceptance.json记录候选、判据和验证范围；commands.json记录52项定向测试、45项Runtime回归、类型/通信/Harness及构建出口。source-projection.json与projection-units.json证明仅跟踪源码的52项复验。sdk与projection-sdk包含实际HTTP/stdio、协议降级、客户端隔离、批量取消及过期恢复读回。

review.json是最后一轮修复审查，historical保留反例和先前失败；其中harness:ci因既有Agent Dev证据过期退出1。所有产物由agent驱动，工具输入为确定性夹具，传输和审批钩子真实执行。
