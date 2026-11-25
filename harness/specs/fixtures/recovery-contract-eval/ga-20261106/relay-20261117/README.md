# G3 接力验证（2026-11-17）

源码候选 `da1125874d0850833d2c358d28d9c867a4ec95b6`。actor: g3-relay；driven_by: agent；realHumanEvidence: false。GA 状态为 **NO_GO**。

本轮修复 Windows 插件 file URL 原生加载、冻结夹具的工作区与任务 owner、验收退出状态、Control UI 的 Lit 入口解析，以及连续重启跨过120秒任务租约后的同 owner 接续。租约接续递增 epoch；未决效果、暂停、会话代次变化与时钟回退仍拒绝。

193 项定向测试通过；Node/Web/Test 类型、定向 lint、通信 replay/compare、runtime source/LOC 和当前差异 Harness 通过。最终候选桌面及 runtime 构建通过。完整 `pnpm build` 在上一候选 d2e823f7b 通过，包含17个串行编译配置，并复用源码内容未变的 SDK 声明缓存。

## 实际窗口回执

| 候选 | 窗口 | 正确终态 | 丢失任务 | 重复效果 | 毫秒 |
|---|---|---:|---:|---:|---:|
| d2e823f7b | child-created-before-parent-advance-kill | True | 0 | 0 | 22221 |
| d2e823f7b | effect-before-receipt-kill | True | 0 | 0 | 24461 |
| d2e823f7b | intent-after-persist-kill | True | 0 | 0 | 38667 |
| d2e823f7b | repeated-restart | False | 1 | 0 | 122272 |
| d2e823f7b | store-write-failure | True | 0 | 0 | 334 |
| da1125874 | repeated-restart | True | 0 | 0 | 76466 |

d2e823f7b 的五窗口回读为4项正确、连续重启1项失败；da1125874 单独复测连续重启并正确完成，耗时短于120秒租约。过期分支另外使用原生进程与SQLite核验：用前移121秒的seed时钟构造过期租约，后续进程使用真实墙钟；epoch从1到2、效果一次、旧凭据与重复操作拒绝、unknown效果保留。

最终候选连续重启耗时 76466 ms；桌面构建 63724 ms（硬限58000 ms）。当前候选的完整冻结45样本/臂未运行，原P50/P95=5000/15000 ms门槛保持。完整矩阵、第二轮legacy一致性、当前候选发布门禁与独立复审仍需完成。

`report.json` 保存结论和源码哈希，`raw-evidence.json.gz` 保存逐文件原字节及SHA256，包含失败和修复后的窗口。可解压JSON、逐个base64解码files条目并核对sha256。全部原始跑次仍位于 `D:/tmp/g3-relay-20261117/`。
