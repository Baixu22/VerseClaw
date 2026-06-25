# Graphiti Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\graphiti-main\tests`。

## 值得移植的测试形态

- mock LLM 下 add_episode 产生预期 nodes/edges。
- add_triplet 写入确定事实。
- edge/node save/delete。
- edge dedupe 与 invalidation。
- search filters，包括 group、date、valid_at、invalid_at。
- tracing/security tests，确保查询和回调不泄露不该暴露的数据。
- eval fixtures，检索结果质量对比。

## ClawX 应新增 fixture

- 用户先要求 A，后改成 B：A edge invalid_at，B edge valid_at。
- 一次测试失败写入 bug evidence，修复后写入 resolved evidence。
- 同一符号多次被不同 episode 提到：episode 支撑关系保留。
- 只查询当前有效事实，不返回已失效事实。
- 按 task run 查询相关事实子图。
