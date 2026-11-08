**TF-0869 已交付 WorktreeService 写入占用与维护围栏，源码候选 `e424f0b129f73725b82b8d6dd53dca56f8a32eea`。**

同一原生检出只允许一个持久 writer，凭证绑定 scoped run、会话代次、捕获的 binding revision、checkout generation/incarnation 和单调 epoch。退休请求、旧凭证、过期和时钟回退均拒绝新操作。在途或未知操作阻止释放；相同完成回执可回读，冲突回执拒绝。

原有 merge、candidate freeze 和 cleanup 已消费同一资源资格。维护先取得所有输入/输出根，再进入文件效果；未使用占用可补偿释放。实际文件效果中断保留unknown；原生删除后结果提交失败可按原cleanup与路径缺失事实结清。准备后、permit前的进程崩溃仅在maintenance/零操作/原进程代次结束三条件同时成立时恢复。

两组共 **59 次测试执行，47 个不同用例，0 失败/跳过**。Node/Web/Test类型、定向lint、contract、comms replay/compare、Harness validate/dry-run均退出0。真实Git、独立Node进程、SQLite重开和exit23覆盖实际owner路径。依赖通过现有junction复用；没有运行完整Runtime构建或Electron产品旅程。

TF-0865 的 TaskSystemStore、实时session/binding/Mission和真实工具入口联合准入仍未完成。本子叶提供并验证资源资格，未把预留本身当作任务或权限授权。独立DeepSeek定向复核的P1已修复，当前无同范围P1/P2。

三语README和owner契约已同步。失败历史在failure-index.json；源码与产物摘要在report.json和manifest.json。复核：`python harness/specs/fixtures/checkout-writer-ownership/20261109/verify.py`。
