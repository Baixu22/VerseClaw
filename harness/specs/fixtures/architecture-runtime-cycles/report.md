# TF-0789 runtime 反向依赖验收

限定结论：**pass-for-runtime-cycle-removal-with-inherited-loc-residual**。全部执行均为 agent 驱动。

候选 `b834bf3e1164544e8fde5c41b715d611c5dd4bf7`，tree `0eadb5e2e4a770fa8be10745f7e835aa8615bd48`；26 项正式记录运行前后均为干净工作区。
基线 `e2ba2aa36814409b6ac7de042008ba9bb9527bb9`。命令、输出、时间与退出码见 `gate-results.json`。

- 原 runtime 循环检查 **exit 0**：9158 → 9159 文件，23 文件分量 → 0 个分量。每个图输入都已绑定 Git 字节。
- 新增 3 项实际导入负例在原源码上全部失败，在候选通过；相关行为测试 **58/58**（9 + 19 + 30），失败/跳过 0。
- **24 项记录运行 exit 0**，含完整 uncached node/web/test 类型、契约、scoped lint、格式、comms、Harness、五入口 bundle 与原循环门禁。
- 完整 `runtime:source:check` 已走完六个子门禁，前五项通过；最后 LOC 检查仍 **exit 1**。单独运行该检查同样 exit 1。
- 干净基线复现的 LOC 报告与候选逐字一致：23 个未登记超 500 行文件、110 个超过既有基线的文件。本轮触及的 chat-turn-vtoken-injection 在基线和候选均为 508 行，未新增或加重超限项，未修改基线或 allowlist。

三处修复：registry 从身份叶读取现有 CVK ID，engine 继续原导出；kill-switch 和 VToken 配置解析直接导入原 `runtime-core/types` 的 `isRecord`。不改变 plugin/provider 加载策略、工具 schema、权限、默认值、注册时序或回退。四个模块的非 import AST 保持等价，18 个保护输入保持一致；行数增长主要是原 oxfmt 展开格式。README 三语已复核。

Codex autoreview 返回零发现。五入口 bundle 证明原 engine ID 导出保留，registry 不加载 engine，配置入口不加载 runtime-core 总出口；它不代表完整构建。干净基线完整 runtime 构建在 tsdown 因 JS heap OOM 退出 **134**；Crabbox 启动能力检查退出 **2**；候选完整构建未运行。根项目完整类型通过不等于 runtime 全域类型通过。

前期组合测试的原超时与最终独立成功均如实记录，未增大 timeout 或改断言。`attempts-and-limits.json` 保存限制；全量原图和本地日志索引见 `private-provenance.json`，可复现分析器与事件输入见 `reproduction.json`。最终证据须读回全部哈希与零命中凭据扫描后才能收口。

本结论只接受 TF-0789 的去环范围。全仓单测、Electron、完整发行构建、真实 provider 效果和整体 GA 均未验收；TF-0790 继续处理陈旧权威声明。
