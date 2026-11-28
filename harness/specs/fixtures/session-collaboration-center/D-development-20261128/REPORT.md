# D 消耗、资源与测量开发验收

候选 `1a9fac9a0efd64eb98cd36f72260b91d7c20e2c7` 通过星驰 `ccs-ai/gpt-6.1-sol` 代码审查与独立开发验收。

协作详情按需读取原会话、任务和运行的模型用量、资源及预算，区分spent、held和未知数据。资源与用量在最后一次异步读取后复核当前身份和权限。材料注入保持原工具结果的字符、UTF-8和序列化预算。D4绑定固定输入和实际provider任务，D5拒绝重复身份、错误结果及不完整指标。

18 文件的 198 项定向回归全部通过，代码提交树等于测试树。D5复算回归、契约、四语、通信回放/对比、Harness validate/dry-run、Electron用例收集和定向ESLint通过。完整类型、构建、Electron实跑、CI、A5/D4规模测量以及D5索引裁定按用户安排延期。

source-binding.json绑定原字节SHA、LF规范化SHA及Git blob；unit-results.json保存逐条断言；checks.json记录最终干净候选检查；历史失败和审查结果保留原候选。自动证据均标为agent驱动。
