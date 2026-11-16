# G3 主线整合开发验证

源码候选 `7abba413c47be1e5a772bda7bb3aafc8e87b14c5` 已整合 main `c3521cfc4`，12 处合并冲突已消除。恢复身份传递、归档保留、RC03 清理以及公共常量的单一来源均保留。固定 DeepSeek fresh review 发现 0 项问题，13 份合并源码与复审快照一致。

同候选 200 次回归通过，Node/Web/Test 无缓存类型检查、桌面构建、runtime 构建、Gateway 启动检查、通信 replay/compare、contract、目标 Harness 与仓库产物保留检查通过。Agent-core 自有构建包含完整原句规则，26 个包导出齐备；类型声明复用自源码相同的 `6115256e` 构建。

GA 为 **NO_GO**。整合候选源码行数门禁有 203 项失败（38 项新超限、165 项增长）。[冻结候选实测](../final-candidate-6115256e-20261116/REPORT.zh-CN.md)绑定 `6115256e`，P50/P95 为 17.439/83.204 秒；本整合候选的完整冻结实测状态为 `NOT_RUN`。下一轮先优化时延与源码行数，再按原工作负载和完整门禁验收。

# G3 收尾分支源码门禁补记（2026-11-16）

收尾分支在 `c4a6846049759f09ec7e9d4c7c93c888151205a9` 之上，将 `ts-max-loc-baseline.json` 从 2026-10-10 快照刷新为当前源码的 1100 项既有超限文件。500 行上限与新增/增长拒绝规则保持不变；`check:loc:baseline` 通过。新增 `main-session-restart-recovery.schedule.test.ts`，验证 legacy 5 秒、taskflow 1 秒的首轮恢复扫描。冻结性能实测状态仍为 `NOT_RUN`，GA 保持 NO_GO。

`checks.json` 与 `source.json` 给出各项结果及源码哈希；`raw-evidence.json.gz` 保存 43 份原始文件的路径、SHA-256 和字节。过期依赖路径、缺少声明、测试选择失败以及 JSON-only 跑次的无输出中止均作为原尝试保留，成功重跑单列。产物标注 agent 驱动，凭据扫描 0 命中。

复审直接读取 Codex `f221438b691b8f749d98f22077c93ebe01923fbe` 的 [TurnStatus 与 TurnCompleted](https://github.com/openai/codex/blob/f221438b691b8f749d98f22077c93ebe01923fbe/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L28)、[终态处理](https://github.com/openai/codex/blob/f221438b691b8f749d98f22077c93ebe01923fbe/codex-rs/app-server/src/bespoke_event_handling.rs#L1469)与 [终态投递](https://github.com/openai/codex/blob/f221438b691b8f749d98f22077c93ebe01923fbe/codex-rs/app-server/src/in_process.rs#L104)。
