# TF-0788 小依赖环验收

限定结论：**pass-for-TF-0788-scope**。全部执行均为 agent 驱动。

候选 `36b37acd405fc59d7aa2e92de1a06e750b108801`，tree `9b5d9235107a36243d701e0741381a76a76a6fb7`；21 项记录运行前后均无未提交改动。
基线 `dc7fbf3cc0a901b1ef413e7b91b86e4129fb795f`。逐项命令、原始输出、退出码与时间见 `gate-results.json`。

- 相关测试 **80/80**：主仓 49、runtime 21、context folding 10；失败/跳过均 0。静态图测试还覆盖 4 条反向边负例。
- 应用静态值依赖图：825 → 826 文件，环 **1 → 0**；context 两文件环 **1 → 0**。
- 原 runtime checker 的分量 **[23, 2] → [23]**；23 文件成员完全不变，门禁仍 **exit 1**，后续归 TF-0789。完整分量与源码哈希见 `runtime-cycles.json`。
- 其余 **20 项运行 exit 0**，包括完整 uncached node/web/test 类型、契约、两侧 scoped lint/格式、comms replay/compare、Harness 与保留策略。
- 4 个 sandbox 函数的搬移体、2 个同步函数的读取器替换均保持等价；12 个冻结输入文件一致。工具工厂继续导出原四个名称。
- Codex autoreview：完整实现与最终一行修正均无发现；目标与绑定限制见 `reviews.json`。四入口 bundle smoke 通过。

共享 sandbox 状态是原实现的搬移；workspace owner 在持久化后传入读取器；工具目录持有名称，工厂保留导出。未新增权限、API 或 runtime authority。生产行数增量主要来自既有 runtime 格式化和回调签名，存储实现没有复制为第二套。README 三语已复核，无用户行为变化需要更新。

`source-bindings.json` 将两个图的所有输入逐一绑定到基线/候选 Git blob，允许的差异仅 LF/CRLF。`reproduction.json` 保留一次性分析器原文、环境和原始通讯事件哈希；它们是冻结的测量来源，不是新增产品框架。原始大图和失败跑次留在 `private-provenance.json` 指定的本地归档。

已保留基线只读断言错误、资源耗尽、review 启动/容量失败、JSON-only 测试无输出 watchdog、SDK 准备权限错误的记录。只读断言改为既有 mapper 的 ro，未改变权限默认；lint 只跳过无关 SDK 生成，规则与 deny-warnings 未放宽。

未运行全仓单测、Electron E2E、完整桌面/runtime 构建或完整 runtime:source:check。本轮不声称全图无环、全仓通过、真人证据、性能收益或 GA。哈希清单与凭据扫描需逐文件读回后方可关闭本叶子。
