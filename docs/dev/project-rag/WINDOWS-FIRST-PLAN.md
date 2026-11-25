# G2 Windows 开发与测试顺序

2026-11-26 所有者调整执行顺序：先完成剩余开发，资源开放后再执行完整验收。开发依次补齐 RAG-16、RAG-17、RAG-18 与 RAG-19 的实现和可执行验证入口；RAG-A1 已有实现、冻结语料和定向回归可作为开发输入。各节点单独记录 implementation 与 acceptance 状态，前置节点的完整验收待执行不阻止后继代码开发。

日常只运行变更路径的定向测试、类型和 lint，以及通信改动需要的 replay/compare。Runtime/Vite 完整构建、Electron、真实模型质量实验、容量、安装包、72 小时和完整双角色验收暂缓；后续绑定最终候选重新冻结执行计划，原门槛保持。开发完成登记为 implemented / acceptance-deferred，只有全部原验收条件满足才关闭节点。

所有者于 2026-11-24 指定优先 Windows 开发测试，跨平台验证暂缓。当前资格范围为 `windows-only`，原生目标是 `win32-x64`。macOS/Linux 的四个目标记录为 `deferred`，进入独立补验节点。

| 顺序 | 原节点 | 当前交付 | 完成条件 |
|---|---|---|---|
| 前置 | RAG-A1 | 当前知识库评分、画像与单次检索质量基线 | 评分负例通过，实际 owner 快照与问题集冻结，单次检索配对消融及 DCS 后质量可复算 |
| 1 | RAG-16 / TF-0893 | Windows 基础回归与 Research 闭环 | 当前源码的持续回归、完整非缓存类型、真实 Electron/Gateway Research 旅程、取消和失败恢复通过；保留完整工程门禁 |
| 2 | RAG-17 / TF-0894 | Windows 检索诊断与离线策略晋级回滚 | Settings 诊断、原始证据重读、实际 owner 策略、CAS 晋级/回滚及撤销传播通过 |
| 3 | RAG-18 / TF-0895 | Windows 安装、离线运行与升级回滚 | 当前候选安装包的 SQLite/FTS/SDK/vector/model 探针、离线重启、低空间、半安装与升级回滚通过 |
| 4 | RAG-19 / TF-0896 | Windows 质量、费用与稳定性收口 | 固定 240 查询、540 任务槽、20k/100k 容量、真实 72 小时观察和同候选 Executor/Verifier 证据满足原门槛 |
| 暂缓 | 跨平台补验 | macOS/Linux 原生验证 | 恢复该范围后，用新候选和实际目标补齐四平台安装、模型、容量及升级证据 |

开发使用 RAG-A1 已冻结的接口和语料，串行完成四个原节点；资源开放后按依赖顺序补齐验收证据。四个原节点和历史证据保留。暂缓补验节点不作为当前 Windows 节点的执行依赖。任务图登记当前状态和候选；本文件保存执行范围、顺序和完成条件。

开发先运行变更路径的原生检查、定向类型和 lint，然后在匹配资源窗口运行持续 Vitest、真实 Electron 和当前候选的完整基线。G2 的原 7 步基线、2400 秒总窗、4 GiB/no-heavy 准入、原 25 门加 release-baseline-validate（共 26 门）、四 requiredTests 及双角色预算保持。节点重规划的 Task Forest 应用与历史导出使用单独资源段。

`ProjectRagAcceptanceManifest/v1` 的 `qualificationScope: "windows-only"` 选择当前 Windows 资格验证。读回返回该范围、`requiredPlatforms: ["win32-x64"]` 和四个状态为 `deferred` 的其他目标。Windows 原件、候选身份、来源失败路径、容量、固定评测、费用、安全、完整工程及 72 小时条件保持。

完整五平台验证使用 `qualificationScope: "all-platforms"`；省略该字段沿用五平台合同。未知或空范围拒绝读回。恢复跨平台补验时生成新的完整范围 manifest，并重新绑定实际候选与原始证据。

2026-11-25 开发顺序补充：RAG-A1 完成评分与真实语料基线；RAG-16 补齐语义覆盖和预算内远端检索；RAG-17 完成分阶段诊断及晋级回滚；随后完成 Windows 交付和最终验收。日常修改运行对应开发回归，质量实验绑定数据和预算，集成候选保留原完整工程门禁。源码或规格更新后重新冻结执行计划，旧候选的 grant 不能用于新输入。
