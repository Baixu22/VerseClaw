**源码候选 `6117f2c093f864686246f325052624ccff48c933` 已实现持久目标与本机任务领取的首个可运行切片。** 实施工作树：`D:/ClawX-work/durable-task-system-20261107`；分支：`codex/durable-task-system-20261107`。全部证据由 agent 驱动。

规划与设计见 `docs/dev/durable-task-system/PLAN.md` 和 `DESIGN.md`。研发 Task Forest 的 TF-0843 跟踪完整目标，产品运行不依赖该 skill。

验证结果：

- 核心任务测试 28/28、Main/账本/派发回归 56/56、Runtime 回归 7/7，共 91 项通过。
- 真实 Electron 场景 1/1，退出 0：Renderer → Main → SQLite 创建目标，刷新后恢复同一任务；任务卡片在视口内，截图已回读。
- node/web/test 三套类型、桌面构建、contract、四语、通讯 replay/compare、Harness 和源码保留检查通过。
- 两棵真实 Git 工作树、16 个独立进程竞争同一任务：1 个领取成功，15 个拒绝。
- 1 万任务下本次领取 p95 为 4.65 ms，目标上下文读取 p95 为 0.29 ms；100 对实际文件写入中，受管写入 p95 为 9.73 ms，裸写入 p95 为 0.60 ms。这是本机控制面测量。

完整 Runtime 构建未通过：tsdown 内部 300 秒超时，日志随后记录 8 GiB V8 堆内存耗尽，最终退出 124。早期依赖启动失败、原生 tsgo 崩溃、已修复的回归失败，以及运行期间暂存源码触发的 Electron 源状态保护失败，均保留在原始证据索引中；最终成功重跑单独记录。

当前完成机制支持约定文件哈希和实际 exec 终态回执。通用业务 verifier/effect owner 适配、子代理 writer 转移与回收、更多外部效果的 unknown 核对、跨机器协调及长会话模型收益评测仍属于完整目标的后续工作。它们没有被本切片的测试升级为通过。

`report.json` 保存计数、退出码和剩余事项；`source-manifest.json` 固定源码字节；`raw-evidence-index.json` 记录原始证据位置与摘要；`SHA256SUMS` 校验本目录的精选产物。
