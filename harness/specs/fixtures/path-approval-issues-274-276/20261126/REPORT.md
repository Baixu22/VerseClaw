# 工作区路径、写入批准与恢复目标

候选 `456ee94e330ccab40b440053ea1c6ab9d5565ffb` 修复 #274–#276：工作区预检和创建一致展开 `~`，外部文件批准绑定 UTF-8 内容 SHA256，写入 journal、锁、读取摘要和撤销使用实际文件目标。file URL 解码后的特殊空格与绝对路径内的字面 `~` 目录保持原目标。

最终候选完成 Host 36 项、Runtime 86 项回归、Runtime NodeNext 类型检查、七项静态与通信检查、桌面及 Runtime 完整构建，以及 1 项真实 Electron 场景。Main/Web/Test 类型检查通过于集成候选 824e6e177；后续仅补共享类型 import 的 .js 扩展并更新 spec，TypeScript 实测运行时代码字节一致，类型来源与转移依据保留在 report.json。Electron 场景验证 home 根拒绝、硬链接拒绝、普通与字面路径保存、相同长度内容替换拒绝、原批准有效且只消费一次。全部产物标记为 agent 驱动。

WorkBuddy 审查 r9 返回 2 条意见；逐条复核后，采纳 0 条、否决 2 条，剩余可执行问题 0。原始模型判定及逐条源码依据分别保留在 review.json 和 review-adjudication.json。审查候选为 824e6e177，后续差异仅为上述类型路径与 spec；原 wrapper 因匹配结论中的 pending 一词退出 4，完整报告经复核有效，该原始回执仍保留。

完整仓库 Harness CI 在 59 项测试、重复资源、文档和目录检查通过后，于 Agent Dev 审计退出 1：主线既有 Workbench/quality/deep-test 证据已过期，2026-11-18 的性能记录中 typecheck 为 68533ms（门槛 45000ms）、Playwright 为 46635ms（40000ms）、contract 为 3388ms（3000ms）。这些输入与 main 638b2cb 的 Git 字节相同；链路末尾的 evidence refs 与 test coverage 检查已另行实际通过。GitHub Actions 因账户付款或消费额度限制未启动。验证复用了已安装依赖，运行计划和原始回执均保留。

运行 `python verify.py --repo <checkout>` 核对证据及固定候选的 Git 源码字节。原始日志和历次失败留在本地 `D:/tmp/path-approval-closeout-20261125`。
