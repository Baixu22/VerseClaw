# E3 协作故障恢复开发验收

候选 `4a7362a1cbc2daae319bcafaa9ccbf359066ab56` 通过星驰 `ccs-ai/gpt-6.1-sol` 代码审查与独立开发验收。

同窗口重载恢复有界草稿和已确认订阅游标。发送前保存原意图，发送中重载转unknown并自动回读原ID；存储失败不派发。原代次草稿可查询原回执并明确清除，终态消息使用新草稿ID。订阅保存失败暂停并提示；重复状态转换不会遗漏。材料失效事件及失效回读清除旧正文，导航/重连经当前读取者和原owner重新核验。测试包括SQLite消息中断/重开、页面迟到响应和跨项目读取隔离。

8 文件的 107 项定向回归全部通过，代码提交树等于测试树。契约、四语、通信回放/对比、Harness validate/dry-run、Electron用例收集和定向ESLint通过。完整类型、构建、Electron实跑、CI以及D5索引裁定按用户安排延期。

source-binding.json绑定原字节SHA、LF规范化SHA及Git blob；unit-results.json保存逐条断言；checks.json记录最终干净候选检查；历史失败和审查结果保留原候选。自动证据均标为agent驱动。
