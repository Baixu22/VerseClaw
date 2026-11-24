# G2 Windows 开发与测试顺序

所有者于 2026-11-24 指定优先 Windows 开发测试，跨平台验证暂缓。当前资格范围为 `windows-only`，原生目标是 `win32-x64`。macOS/Linux 的四个目标记录为 `deferred`，进入独立补验节点。

| 顺序 | 原节点 | 当前交付 | 完成条件 |
|---|---|---|---|
| 1 | RAG-16 / TF-0893 | Windows 基础回归与 Research 闭环 | 当前源码的持续回归、完整非缓存类型、真实 Electron/Gateway Research 旅程、取消和失败恢复通过；保留完整工程门禁 |
| 2 | RAG-17 / TF-0894 | Windows 检索诊断与离线策略晋级回滚 | Settings 诊断、原始证据重读、实际 owner 策略、CAS 晋级/回滚及撤销传播通过 |
| 3 | RAG-18 / TF-0895 | Windows 安装、离线运行与升级回滚 | 当前候选安装包的 SQLite/FTS/SDK/vector/model 探针、离线重启、低空间、半安装与升级回滚通过 |
| 4 | RAG-19 / TF-0896 | Windows 质量、费用与稳定性收口 | 固定 240 查询、540 任务槽、20k/100k 容量、真实 72 小时观察和同候选 Executor/Verifier 证据满足原门槛 |
| 暂缓 | 跨平台补验 | macOS/Linux 原生验证 | 恢复该范围后，用新候选和实际目标补齐四平台安装、模型、容量及升级证据 |

四个原节点和历史证据保留，按上述顺序串行推进。暂缓补验节点不作为当前 Windows 节点的执行依赖。任务图登记当前状态和候选；本文件保存执行范围、顺序和完成条件。

开发先运行变更路径的原生检查、定向类型和 lint，然后在匹配资源窗口运行持续 Vitest、真实 Electron 和当前候选的完整基线。G2 的原 7 步基线、2400 秒总窗、4 GiB/no-heavy 准入、原 25 门加 release-baseline-validate（共 26 门）、四 requiredTests 及双角色预算保持。节点重规划的 Task Forest 应用与历史导出使用单独资源段。

`ProjectRagAcceptanceManifest/v1` 的 `qualificationScope: "windows-only"` 选择当前 Windows 资格验证。读回返回该范围、`requiredPlatforms: ["win32-x64"]` 和四个状态为 `deferred` 的其他目标。Windows 原件、候选身份、来源失败路径、容量、固定评测、费用、安全、完整工程及 72 小时条件保持。

完整五平台验证使用 `qualificationScope: "all-platforms"`；省略该字段沿用五平台合同。未知或空范围拒绝读回。恢复跨平台补验时生成新的完整范围 manifest，并重新绑定实际候选与原始证据。
