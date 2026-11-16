---
lifecycleStatus: active
id: coding-vg-sts-jj-convergence-plan
title: 编码缺陷修复与 VG STS JJ 联合评测节点合同
scenario: versegit-validation-layer-extension
taskType: planning
intent: 将 coding A1-A10 与 VG STS JJ VS 的实际能力和组合验证落实为现有 Windows 功能闭环下的串行节点，保留非 GA 边界。
touchedAreas:
  - harness/specs/tasks/coding-vg-sts-jj-convergence-plan.md
requiredRules:
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles: []
expectedUserBehavior:
  - 用户可查看有依赖与正反验收的编码修复及 VG STS JJ 联合评测计划，规划不改变当前产品行为。
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/coding-vg-sts-jj-convergence-plan.md
acceptance:
  - 本地新增一个程序五个阶段十九个执行叶，有目的范围依赖正反判据命令和证据出口。
  - A1-A10有唯一修复叶，VG STS JJ VS及同候选联合评测纳入，C0为本lane初始唯一ready叶。
  - 本次只完成规划，不把类型源码历史通过或分类作为实施完成及GA。
  - base_graph_hash匹配后CLI应用，validate/export和list/todo回读成立。
docs:
  required: false
---

# 编码缺陷修复与 VG / STS / JJ 联合评测

2026-11-04 · driven_by: agent · actor: codex-coding-vg-sts-jj-plan · realHumanEvidence: false

程序节点为 **TF-0758**，主父任务是TF-0571 Windows功能闭环补缺与自动验收。旧VG/CodingRun/组件毕业/写一致性历史验收不重开、不重签。TF-0585最终裁决新增依赖本程序。用户本次明确纳入VG/STS/JJ，不沿用D9的旧VG排除；默认值、三锁、M4和发布权限不随规划变化。

本文件是 planning 合同，只拥有本规格文件；后续触及 renderer/Main/Gateway/runtime 通信的执行叶必须另建或更新 taskType=runtime-bridge、scenario=gateway-backend-communication 的精确实现规格并运行相应门禁。这里不把规划文档伪装成已实施的通信变更。

原coding审计候选为 d8d1691a281b14d74096d50b4da16eb0148ffe87，本规划读取主线为 32236f49295fc73b7f63e1cbcb9216042f2ec359。原始报告、探针、JSON和摘要保存在本地 .agent-workbench/audits/coding-vg-sts-jj-20261104；先核对当前文件身份再重跑，绝不覆盖原失败证据。正式修复的可复用测试与精选证据由执行叶入源码。

## 实际组件边界

- VG源在D:/Projects/VerseGit，提交89af0c36216e64bb0f7430fc3fe21c39c485be7c；本轮实际核对宿主vg.exe摘要与resources/versegit/manifest.json一致，capabilities执行成功。原生能力清单不等于宿主授权。
- STS为VG同仓extensions/sts的smart-test-sorter / smart_sorter；Python/pytest选择面；契约1.1/2.0分别验证，选择默认关闭，selected不替代full。
- JJ为vg-jj使用的jj-lib 0.46.0；独立jj CLI oracle另固定版本，不宣称CLI全量平替。
- VS复用既有受控执行owner，VG standalone与ClawX host-mode职责分别验证。
- 同时覆盖Git/worktree、原生读写/undo、MCP、CodingRun、target runner、Python环境、Electron包和恢复窗口；其他实际可达编码依赖在C0登记。

## 共同验收

- 实施前核对当前源码/脏改动，创建或更新精确ownedPaths的实现task spec并运行harness context；本规划不授予全仓写权限。
- 本lane一次只推进一个ready叶；复用现有file/journal/Git/permission/Task Ledger/VS/Harness owner，不建并行执行或恢复权威。
- 保留历史候选/失败证据；当前source/tree、binary/schema、配置和输入绑定后重验，不以静态字符串检查代替真实效果。
- 界面审批/故障注入/评审由脚本或agent执行；产物标driven_by:agent、actor、realHumanEvidence:false，不等真人。
- 不自动改变产品锁、默认值、VG M4/land/admit权限或发布状态；大体积临时文件走D盘。
- 正常对照及所列负例均执行；命令、exit、count/skip、文件/进程/事件读回和SHA-256齐备，P0/P1不以残留说明代替修复。
- 模拟/spy、实际效果、真实模型和安装包证据分层；所有判据磁盘读回成立且base_graph_hash匹配后才自动收口。

核心功能在支持域失败必须修复复验；合法not-applicable、明确retired、性能无收益可以如实记录，但不能声称功能可用/提速或默认毕业。需要第三方模型时用既有资源自动执行，缺凭据只索取一次；没有等真人操作/数据/verdict的节点。

## 节点顺序

实际编号已由CLI分配：程序TF-0758、阶段TF-0759—0763、执行叶TF-0764—0782。表中的内部键用于关联实现合同。所有执行叶初始progress=0；仅C0 ready，其他proposed，依表串行depends_on。程序in_progress表示规划启动，不表示实现已完成。

|键 / Task Forest|阶段|交付节点|来源|
|---|---|---|---|
| C0 / TF-0764 | 建立同候选能力与反例基线 | 冻结编码、VG、STS、JJ 的实际能力与统一评测基线 | A1-A10；VG/STS/JJ |
| S1 / TF-0765 | 修复文件边界、隔离与恢复一致性 | 修复拒绝文件访问前仍生成可读快照的泄露 | A1 |
| S2 / TF-0766 | 修复文件边界、隔离与恢复一致性 | 让撤销和检查点恢复重新验证真实文件边界 | A2 |
| S3 / TF-0767 | 修复文件边界、隔离与恢复一致性 | 阻止工作树保留名和身份碰撞造成误删 | A3 |
| S4 / TF-0768 | 修复文件边界、隔离与恢复一致性 | 贯通编排隔离请求与已授权工作区身份 | A6 |
| S5 / TF-0769 | 修复文件边界、隔离与恢复一致性 | 让工作树回流完整保留删除并拒绝并发覆盖 | A4 |
| S6 / TF-0770 | 修复文件边界、隔离与恢复一致性 | 区分文件效果与 journal 终态持久化结果 | A5 |
| P1 / TF-0771 | 对齐工具协议、运行证据与退役行为 | 修复 CodingRun 导出、解析与运行身份绑定 | A7 |
| P2 / TF-0772 | 对齐工具协议、运行证据与退役行为 | 对齐 MCP 管理调用与 Gateway 实际工具入口 | A8 |
| P3 / TF-0773 | 对齐工具协议、运行证据与退役行为 | 统一 MCP 结果中的错误、媒体与取消语义 | A9 |
| P4 / TF-0774 | 对齐工具协议、运行证据与退役行为 | 让退役与默认能力声明匹配实际执行路径 | A10 |
| E1 / TF-0775 | 完成 VG、JJ、VS、STS 及组合编码评测 | 评测 VG 在编码流程中的真实观测、候选与反馈 | VG |
| E2 / TF-0776 | 完成 VG、JJ、VS、STS 及组合编码评测 | 评测 JJ 图语义、工作副本同步与操作恢复 | JJ |
| E3 / TF-0777 | 完成 VG、JJ、VS、STS 及组合编码评测 | 评测编码验证进程的 VS 执行、回执与清理 | VS |
| E4 / TF-0778 | 完成 VG、JJ、VS、STS 及组合编码评测 | 评测 STS 选择完整性、契约版本与真实净收益 | STS |
| E5 / TF-0779 | 完成 VG、JJ、VS、STS 及组合编码评测 | 执行 Git、VG、JJ、STS 的同候选组合编码对拍 | 联合评测 |
| F1 / TF-0780 | 验证崩溃恢复、Windows 包和成熟度结论 | 验证编码副作用跨进程崩溃与恢复入口的一致性 | 恢复 |
| F2 / TF-0781 | 验证崩溃恢复、Windows 包和成熟度结论 | 补齐 Windows 包内编码与 VG、STS、JJ 联合证据 | 打包 |
| F3 / TF-0782 | 验证崩溃恢复、Windows 包和成熟度结论 | 形成编码能力成熟度、残余风险和发布前结论 | 最终裁决 |

## 与已有任务接合

TF-0756继续拥有浏览器修复和其VG证据刷新；E1只复用身份匹配证据。TF-0679/0681/0682继续拥有准入/终端容量/跨工具回收，S3/S4/S5修当前coding反例，E3测其coding集成。TF-0707继续拥有恢复authority/driver，F1追加coding故障窗口。TF-0584拥有通用包/OAT，F2只补本链；TF-0585最终裁决依赖本程序。跨仓遵守目标AGENTS，只在原owner修已证实缺口，不复制活动任务图。

## C0

**冻结编码、VG、STS、JJ 的实际能力与统一评测基线**

目的：固定反例、跨仓身份和评测oracle，为修复和组合比较建立同一基准。

来源：A1-A10；VG/STS/JJ。

入口/受控范围：

- resources/versegit/manifest.json
- resources/verseshell/manifest.json
- shared/dcs/component-disposition-catalog.ts
- D:/Projects/VerseGit/extensions/sts/contracts/vg-sts
- D:/Projects/VerseGit/Cargo.lock

要求：

- 原审计候选d8d1691a2的A1-A10保留原verdict；当前HEAD已前进，逐文件比对内容身份，变动路径重跑反例。
- 冻结ClawX/VG/VS source/binary、STS代码/安装包/目标Python环境、jj-lib；独立jj CLI用于对照时另锁版本。
- 建立入口/owner/协议/权限/副作用/默认模式/支持域/证据能力表，包括coding tools、MCP、CodingRun、Git/worktree、VG、STS、JJ、VS、package；实际可达其他编码依赖按调用链追加。
- 提前冻结样本、oracle、负例、重复次数、超时和成本指标；STS仅Python/pytest，TypeScript/Vitest与Cargo用自己的完整runner。

验收（同时满足共同验收）：

- 10个发现各有当前复现或修复后的负例及唯一执行叶；原失败不重写。
- 分别列原生capabilities、宿主可调用和实际执行；当前vg0.1.0、STS1.1/2.0、jj-lib0.46.0由冻结输入核实。
- 锁定至少两个独立pytest项目、一个TypeScript非pytest项目及双worktree fixture；三臂共享candidate/依赖/最终full oracle。
- 后续叶明确命令、输出、判据及与TF-0756/0679/0681/0682/0707/0584重用边界。

执行入口（待执行，实施spec固定最终命令和产物）：

- 复用封存的probes.mts、boundary-probes.mts、routing-probes.mts、journal-commit-probe.mts在D盘隔离目录跑当前候选。
- pnpm run contract:check；VG capabilities --json；核验manifest/hash、Python import路径/分发摘要、jj-lib锁和jj oracle。

指标：finding映射10/10；支持域无无主能力；输入绑定100%。

## S1

**修复拒绝文件访问前仍生成可读快照的泄露**

目的：被workspaceOnly拒绝的外部文件字节不能进入可读journal或结果。

来源：A1。

入口/受控范围：

- openclaw_runtime/src/agents/agent-tools.ts
- openclaw_runtime/src/agents/tools/write-journal.ts
- openclaw_runtime/src/agents/tools/write-journal-core.ts
- openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts

要求：

- 读取pre-image/创建snapshot前执行真实路径与读取授权；可信来源不能覆盖限域。
- 覆盖write/edit真实装配+journal默认开启，不能只测关闭journal的裸工具。

验收（同时满足共同验收）：

- 外部read/write/edit拒绝后，标记字节不进入journal/artifact/tool result，目标未变；可信及外部/未知来源都有对照。
- 合法工作区写可撤销；Windows目录联接、文件alias/硬链接按支持域覆盖。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm --dir openclaw_runtime exec vitest run src/agents/agent-tools.workspace-boundary.test.ts src/agents/tools/write-journal.test.ts
- 将denied-write-journal正反对照固化，并在实际Main/Gateway coding路径验证。

指标：越域字节副本=0；合法journal无回归。

## S2

**让撤销和检查点恢复重新验证真实文件边界**

目的：恢复不能跟随替换后的目录联接覆盖或删除工作区外文件。

来源：A2。

入口/受控范围：

- openclaw_runtime/src/agents/tools/write-journal.ts
- openclaw_runtime/src/agents/tools/write-journal-core.ts
- openclaw_runtime/src/agents/path-policy.ts
- openclaw_runtime/src/agents/checkpoint-rollback-executor.ts

要求：

- 在实际恢复I/O复用抗链接逃逸机制；undo_write和checkpoint caller使用相同授权。
- 拒绝后保留journal/未恢复项，多文件部分恢复不能报告成功。

验收（同时满足共同验收）：

- 真实Windows junction父目录替换、最终文件alias、目标消失/重建均不能越界写删。
- 正常多步undo和重启后恢复通过；迟到写及新journal项不误删。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm --dir openclaw_runtime exec vitest run src/agents/tools/write-journal.test.ts src/agents/checkpoint-rollback-executor.test.ts
- 实际装配undo_write、journal开启、workspaceOnly=true复跑原越界案例。

指标：越域恢复=0；拒绝证据保留100%。

## S3

**阻止工作树保留名和身份碰撞造成误删**

目的：创建/回收只作用于确认归属的managed子目录。

来源：A3。

入口/受控范围：

- openclaw_runtime/src/agents/worktree-service.ts
- openclaw_runtime/src/agents/orchestrator-run-observed.ts
- shared/versegit-cleanup-barrier.ts

要求：

- 拒绝点/双点/保留设备名和规范化/截断碰撞；真实目标严格在managed根内。
- 已有目录必须核实owner/epoch；重复请求幂等或明确冲突，不能先删活跃/dirty成果。

验收（同时满足共同验收）：

- 双点夹具保留.openclaw标记；同名、碰撞、alias、旧epoch、被引用evidence均无误删。
- 合法创建/保留/清理通过，以磁盘和Git注册表双读回验证。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm --dir openclaw_runtime exec vitest run src/agents/worktree-service.test.ts
- pnpm exec vitest run tests/unit/orchestration-worktree-merge.test.ts tests/unit/versegit-cleanup-barrier.test.ts

指标：误删=0；归属未知100%拒绝。

## S4

**贯通编排隔离请求与已授权工作区身份**

目的：显式worktree要求必须成为实际环境，失败在执行前明确拒绝。

来源：A6。

入口/受控范围：

- openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
- openclaw_runtime/src/agents/orchestrator.ts
- openclaw_runtime/src/agents/orchestrator-run-observed.ts
- shared/types/delegation-admission.ts

要求：

- 统一顶层/worker隔离继承与冲突语义；未知/未实现不得静默shared。
- 从授权父会话/Workspace owner解析canonical root与generation并贯穿planner/spawn ctx，不信任任意客户端绝对路径。
- 实际backend/root与声明一致，目录模拟不能写为verified Git isolation。

验收（同时满足共同验收）：

- 真实Gateway plan→run→worker cwd及worktree注册闭环；顶层和worker override都有对照。
- root缺失/跨workspace/旧generation/创建失败均spawn前拒绝，无第二目录副作用。
- 资源准入消费实际worktree owner的隔离证明，不信任caller bool。

执行入口（待执行，实施spec固定最终命令和产物）：

- 将routing-probes的plan/run载体反例纳入测试并补真实Gateway worker。
- 定向orchestration/delegation/workspace tests；contract:check；comms:replay/compare。

指标：隔离静默降级=0；越scope spawn=0。

## S5

**让工作树回流完整保留删除并拒绝并发覆盖**

目的：merged对应实际目标树，不能漏删或吞掉用户并发编辑。

来源：A4。

入口/受控范围：

- openclaw_runtime/src/agents/worktree-service.ts
- openclaw_runtime/src/agents/orchestration-worktree-merge.ts
- openclaw_runtime/src/agents/subagent-registry.ts
- openclaw_runtime/src/agents/orchestration-candidate-apply.ts

要求：

- 保留add/modify/delete/rename种类和base身份；与当前目标核对，冲突进入现有受控拒绝/重做。
- 两种后端覆盖并复用journal/approval/candidate owner，不创建第二合并权威。

验收（同时满足共同验收）：

- inprocess/Git的删除与主目录并发编辑四例不再假merged。
- rename/双删/删改冲突/部分失败/重复merge/旧base/staged+unstaged用户改动均有磁盘oracle。
- candidate→apply TOCTOU拒绝；成功tree/hash与receipt一致。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm exec vitest run tests/unit/orchestration-worktree-merge.test.ts tests/unit/versegit-host-apply.test.ts
- pnpm --dir openclaw_runtime exec vitest run src/agents/worktree-service.test.ts；真实双worktree正反对照。

指标：漏删/未授权覆盖/假merged均0。

## S6

**区分文件效果与 journal 终态持久化结果**

目的：写入成功但恢复记录失败时，对外和重启读回一致且可对账。

来源：A5。

入口/受控范围：

- openclaw_runtime/src/agents/apply-patch-preflight.ts
- openclaw_runtime/src/agents/apply-patch-preflight-support.ts
- openclaw_runtime/src/agents/tools/write-journal-core.ts
- openclaw_runtime/src/agents/apply-patch-effect-receipt.ts

要求：

- 消费setWriteJournalBatchState持久化结果，表达effect已发生而journal不完整；unknown不盲重放。
- 复用现有journal/effect状态；新增shape需在实现spec明确兼容/迁移。

验收（同时满足共同验收）：

- 只读sidecar、存储失败、写后kill与重启读回一致；不得对外durable committed而磁盘prepared。
- 正常提交/回滚/不完整恢复有有效refs，重复恢复不重复效果。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm --dir openclaw_runtime exec vitest run src/agents/apply-patch-consistency.test.ts src/agents/tools/write-journal.test.ts src/agents/apply-patch-effect-receipt.test.ts
- 固化journal-commit-probe正常/故障窗口并接真实kill driver。

指标：虚假durable committed=0；重复效果=0。

## P1

**修复 CodingRun 导出、解析与运行身份绑定**

目的：合法UI导出可由CI读取，其他运行不能制造本运行的passed。

来源：A7。

入口/受控范围：

- shared/types/coding-run.ts
- src/components/agents/RolesOrchestrationPanel.tsx
- src/pages/Chat/execution-projection.ts
- scripts/coding-run-summary.mjs
- tests/unit/coding-run.test.ts

要求：

- 可选/必填、嵌套schema、枚举、scope来自同一v1合同。
- 事件必须绑定头部codingRunId；展示/CI不获得Task Ledger完成权限。

验收（同时满足共同验收）：

- 实际Task Loop有/无evidenceGate均round-trip成功，warning可选，正常CLI exit0。
- 跨run验证、空scope、数字runIds、非法completion、乱序和未知版本非零拒绝；cancel/error不变成completed。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm exec vitest run tests/unit/coding-run.test.ts；真实coding-run-summary CLI正反对照。
- UI导出变化补Electron E2E；pnpm run contract:check。

指标：跨run假passed=0；合法round-trip100%。

## P2

**对齐 MCP 管理调用与 Gateway 实际工具入口**

目的：注册服务发现、调用和健康状态反映实际可用性。

来源：A8。

入口/受控范围：

- electron/services/mcp-api.ts
- openclaw_runtime/src/gateway/methods/core-descriptors.ts
- openclaw_runtime/src/gateway/server-methods/tools-invoke.ts
- openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts

要求：

- 修Main调用未注册mcp.*断链，复用现有scoped owner/SDK，不只改名跳过权限。
- 分别表达unsupported/unavailable/empty/timeout/denied，host-native和外部MCP来源真实。

验收（同时满足共同验收）：

- 真实本地受控MCP server经Main→Gateway list/call/heartbeat闭环，不能靠RPC mock证明。
- 缺服务/未授权/网络拒绝/空目录/超时/旧session有区别，失败不得success+空工具。
- UI与模型session runtime权限/schema/reload事实一致。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm exec vitest run tests/unit/mcp-api.test.ts tests/unit/mcp-p4-003-runtime-surface.test.ts tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts
- 真实Main/Gateway/MCP integration与Electron smoke；contract和comms gates。

指标：未注册RPC=0；错误伪装空目录=0。

## P3

**统一 MCP 结果中的错误、媒体与取消语义**

目的：工具错误和合法媒体帧跨适配器保真。

来源：A9。

入口/受控范围：

- openclaw_runtime/src/gateway/mcp-http.handlers.ts
- openclaw_runtime/src/mcp/plugin-tools-handlers.ts
- openclaw_runtime/src/agents/agent-bundle-mcp-materialize.ts
- electron/services/tool-protocol-shadow.ts

要求：

- 复用协商版本SDK ContentBlock/CallToolResult，规范error/approval waiting/timeout/cancel/partial。
- 核对HTTP loopback、stdio plugin、Main shadow；未知版本拒绝，不承诺所有外部客户端版本。

验收（同时满足共同验收）：

- image/audio/resource/text/structuredContent通过SDK；降级合法且标损失。
- details.status=error/isError/throw、approval、abort/timeout不输出false success；晚到帧不跨run。
- 两个失败断言转绿，有真实SDK客户端round-trip和正常对照。

执行入口（待执行，实施spec固定最终命令和产物）：

- 固化adapter-probes/routing-probes的SDK负例；真实HTTP/stdio对拍。
- 定向MCP suites；contract:check；comms:replay/compare。

指标：非法媒体=0；失败→成功=0。

## P4

**让退役与默认能力声明匹配实际执行路径**

目的：已退役能力不能经旧参数复活，可见说明与有效状态一致。

来源：A10。

入口/受控范围：

- openclaw_runtime/src/agents/orchestrator-run-observed.ts
- openclaw_runtime/src/context-engine/coding-runtime-flags.ts
- shared/dcs/component-disposition-catalog.ts
- shared/dcs/prod-flags-catalog.ts
- src/components/settings/DcsProdFlagsPanel.tsx

要求：

- 落实Patch Flow已批准退役覆盖request/API/config/override，不自行恢复。
- 同步Symbol Lease/Patch Flow/worktree的可见说明，源码残留不当作可执行能力。

验收（同时满足共同验收）：

- 真实执行器旧opt-in不再改变worker prompt/写权限；不能只测resolver或复制表达式。
- Developer UI、模型自述、目录与effective snapshot一致，ordinary write/journal/worktree正向保持。
- 分类default/internal不得被解释为GA或运行时已测。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm exec vitest run tests/unit/coding-controls-tf0510.test.ts tests/unit/coding-controls-tf0510-patchflow-trigger.test.ts
- 将3-worker旧参数对照接真实执行函数，UI变化补E2E。

指标：退役复活=0；错误启用说明=0。

## E1

**评测 VG 在编码流程中的真实观测、候选与反馈**

目的：确定宿主可使用的VG能力和身份/风险覆盖。

来源：VG。

入口/受控范围：

- electron/gateway/versegit-bridge.ts
- electron/services/versegit-fact-adapter.ts
- electron/gateway/versegit-bridge.ts
- electron/services/versegit-receipt-evidence.ts
- shared/versegit-runtime-contract.ts

要求：

- 固定binary/source重验M0/M1/既有bounded M2/M3，分清standalone声明与宿主授权。
- 测repo/worktree/session/run/generation/basis/candidate、变更/依赖风险和下一次模型调用反馈。
- bash/direct-FS/other-MCP/network未观测面必须unknown/partial，空缓存不等于零风险。

验收（同时满足共同验收）：

- 真实跨文件producer-consumer、rename/delete、乱序/旧epoch、缺basis、旧/假receipt、binary/schema错配都有对照。
- 六维事实不压成host通过；produced/delivered/transcript/行为变化分别有证据。
- 声明支持域内缺口修复后复验，不以新follow-up替代；M4保持禁止。

执行入口（待执行，实施spec固定最终命令和产物）：

- 复用scripts/verify-versegit-product-integration.mjs及固定候选verifier，不重签历史。
- 定向versegit绑定/observation/receipt/feedback/host-apply suites与真实Electron/Gateway driver。

指标：身份错配采纳=0；过期/假receipt拒绝100%；关键支持域风险漏报=0。

## E2

**评测 JJ 图语义、工作副本同步与操作恢复**

目的：验证VG内部jj适配在编码并发/物化/恢复中的真实语义。

来源：JJ。

入口/受控范围：

- D:/Projects/VerseGit/crates/vg-jj
- D:/Projects/VerseGit/crates/vg-cli/tests/jj_workspace_lifecycle.rs
- D:/Projects/VerseGit/crates/vg-cli/tests/jj_operation_restore.rs
- D:/Projects/VerseGit/docs/jj-vg-sts-rollout.md
- electron/services/versegit-fact-adapter.ts

要求：

- 锁定jj-lib和独立jj oracle，验证Git worktree/VG managed/Git-JJ colocated支持矩阵。
- 覆盖snapshot、operation divergence/stale workspace、commit/change/op identity、rebase/squash/split/restore和Git ref同步。
- 只读宿主调用不得隐式snapshot/reconcile/改ref；standalone写仅在一次性副本显式跑，不扩ClawX M4。

验收（同时满足共同验收）：

- 与锁定oracle比较同输入tree/ref/op-history，不比较随机ID/文案；dirty内容和恢复依据不丢。
- 并发/崩溃/部分恢复/旧operation/重复请求有oracle；不支持repo形态写.jj前拒绝。
- 不支持的功能标not-supported且确认UI/模型没承诺，已宣称支持却失败必须修复。

执行入口（待执行，实施spec固定最终命令和产物）：

- 先读VG仓AGENTS；复用scripts/check_jj_vg_sts.py、vg-jj及crates/vg-cli/tests/jj_*。
- D盘隔离仓Git/JJ/VG对拍，记录source/CLI/library及迁移/回退证据。

指标：dirty丢失=0；隐式图写=0；错身份采纳=0。

## E3

**评测编码验证进程的 VS 执行、回执与清理**

目的：VG/STS测试与构建受既有宿主执行/取消约束。

来源：VS。

入口/受控范围：

- openclaw_runtime/src/agents/verseshell/governed-exec.ts
- openclaw_runtime/src/agents/verseshell/process-manager.ts
- electron/services/versegit-receipt-bridge.ts
- electron/services/versegit-receipt-evidence.ts

要求：

- 区分VG standalone与host-mode，host用户代码/test/build经受控owner，VG事实fixed argv是另一职责。
- 绑定argv/cwd/env/input/session/epoch、预算、artifact、exit/timeout/cancel/approval/cleanup。
- 复用TF-0681的容量/端口/PTY治理，本叶只测VG/STS coding集成，不重复造调度器。

验收（同时满足共同验收）：

- 真实Windows父子进程正常/timeout/cancel/退出/restart后按owned PID确认零存活，不操作未知PID。
- 伪造exit0/摘要错配/旧candidate/晚到帧/native fallback不采纳。
- STS目标解释器/cwd隔离正确，物化窗口到执行和证据封存/清理完成才结束。

执行入口（待执行，实施spec固定最终命令和产物）：

- 复用VS governed-process/lifecycle suites、tests/unit/versegit-wp3-receipts.test.ts和真实Job Object driver。
- 与TF-0681同候选复用证据，接线缺口修复后重跑。

指标：owned进程泄漏=0；跨任务取消=0；假receipt采纳=0。

## E4

**评测 STS 选择完整性、契约版本与真实净收益**

目的：避免漏选、不稳定或部分执行制造全量通过和提速结论。

来源：STS。

入口/受控范围：

- D:/Projects/VerseGit/extensions/sts
- D:/Projects/VerseGit/docs/sts-development.md
- D:/Projects/VerseGit/scripts/measure_jj_vg_sts_workflow.py
- electron/services/versegit-receipt-bridge.ts

要求：

- 选择默认关；1.1历史默认/显式2.0分别验证request/plan/result/consume，不无授权翻默认。
- 核对candidate内容manifest/digests、绝对解释器、依赖环境、收集全集/nodeid/scope；STS包根、VG根、目标repo根各自独立。
- 两个真实pytest项目同candidate full/selected配对，每臂至少5次cold/warm；成本包含计划、物化、启动、依赖准备、最终full及清理。
- TS/Vitest/Cargo不套用pytest选择，明确not-applicable并跑所属完整requiredTests。

验收（同时满足共同验收）：

- 漏选/零选择/收集失败/nodeid漂移/动态参数化/conftest-plugin改动/flaky/timeout/候选环境漂移有负例。
- selected永不满足full，skip/未采集/未执行与passed分开；full检出而selected漏掉时记录missed并拒绝毕业。
- 干净安装环境从源码外import wheel验证，真实VG宿主1.1/2.0闭环。
- 报告漏选率、误报、样本量、cold/warm wall/RSS和总成本；无收益/不足可保留，但不声称提速或默认毕业。

执行入口（待执行，实施spec固定最终命令和产物）：

- VG根scripts/dev.py scenarios-sts、integration-sts --output <new.json>、package-sts --output <new.json>、test-sts。
- 固定vg verify candidate --selection --sts-interpreter <absolute-python> --sts-protocol 1.1|2.0，同计划--sts-full或host full独立对照。

指标：selected→full误升级=0；planted关键漏选全被oracle捕获；净收益全链计量。

## E5

**执行 Git、VG、JJ、STS 的同候选组合编码对拍**

目的：验证单项通过但组合失败、恢复和证据错配。

来源：联合评测。

入口/受控范围：

- tests/e2e/versegit-*.spec.ts
- tests/unit/orchestration-worktree-merge.test.ts
- openclaw_runtime/src/agents/orchestration-candidate-apply.ts
- D:/Projects/VerseGit/scripts/measure_jj_vg_sts_workflow.py

要求：

- A=Git/worktree+原生工具+full，B=VG/JJ+full，C=VG/JJ+STS selected+final full；支持域内环境和VS执行一致。
- 覆盖同文件竞争/跨文件依赖/rename-delete/stale basis/dirty保留/组合candidate/取消恢复，至少两个workspace/session。
- 核心旅程三次独立运行；scripted仅证机制，真实模型质量声明需live endpoint与attribution。

验收（同时满足共同验收）：

- 单独绿组合坏的planted案例被combined full或语义oracle拒绝；selected不替代最后full。
- 三臂共享任务/输入/依赖，所有写/验证/清理/最终树同candidate关联；A1-A10持续回归通过。
- 报告正确性、漏报/误报、冲突、恢复、wall/CPU/RSS/token和环境成本，不只汇总组件pass。

执行入口（待执行，实施spec固定最终命令和产物）：

- 复用VG/VS/Electron/harness driver真实入口，输出逐case identity/command/exit/oracle/receipt/artifact。
- full runner按Python/TS/Rust实际支持域执行，无支持组合需可验证排除理由。

指标：越权/丢数据/假成功=0；核心3次均通过。

## F1

**验证编码副作用跨进程崩溃与恢复入口的一致性**

目的：故障后补丁、Git/JJ、VG、STS仍能解释已发生效果。

来源：恢复。

入口/受控范围：

- openclaw_runtime/src/agents/tools/write-journal-core.ts
- openclaw_runtime/src/agents/subagent-registry.ts
- electron/services/versegit-receipt-evidence.ts
- TF-0707 所属恢复 driver 与 fixtures（实施前解析当前已合入候选中的实际路径，不能依赖另一工作树的未合入文件）

要求：

- 复用TF-0707 authority/phase/driver，仅新增本coding链场景。
- 真实kill：intent后、effect后receipt前、物化后验证前、验证后回流前、cleanup中，每窗口至少3次。
- 其他worktree实现只有合入冻结候选且身份绑定后可用，不能按handoff宣称已接线。

验收（同时满足共同验收）：

- 重复效果/丢用户修改/假终态/越界回收为0，unknown可reconcile不盲重放。
- 文件树/journal/Git-JJ op/VG candidate-receipt/STS scope/Task Ledger终态同run读回。
- 所有窗口有实际kill及继续执行，旧epoch拒绝，不用进程内reset冒充重启。

执行入口（待执行，实施spec固定最终命令和产物）：

- 扩展已有recovery driver coding窗口，与TF-0710/0719/0721同候选。
- 读盘上raw event、状态、文件hash、process cleanup与下一步实际行为。

指标：重复效果=0；错误完成=0；unknown可分类。

## F2

**补齐 Windows 包内编码与 VG、STS、JJ 联合证据**

目的：冻结包中binary、Python环境和协议必须与验收声明一致。

来源：打包。

入口/受控范围：

- electron-builder.yml
- resources/versegit/manifest.json
- resources/verseshell/manifest.json
- tests/e2e/versegit-*.spec.ts
- harness/specs/fixtures/agent-first-system/mainline

要求：

- 复用TF-0584冻结win-unpacked/profile/OAT，仅补本lane新增跨层案例。
- 验证VG/VS/STS wheel/Python/jj实际来源，禁止偷偷依赖源码checkout或D:/Projects/VerseGit。
- fresh profile、缺binary/错hash/缺解释器/升级回退/默认off有明确结果；安装器未跑保持not-run。

验收（同时满足共同验收）：

- 三个独立profile核心coding→worktree→VG/STS/JJ→验证/undo实际Electron/Gateway通过。
- 脱离源码路径仍可在声明布局运行；未支持STS或managedJJ的默认路径明确不可调用。
- 同candidate source/package对拍及source/binary/config/artifact/exit/count/cleanup齐备。

执行入口（待执行，实施spec固定最终命令和产物）：

- pnpm run build:vite；既有frozen win-unpacked builder --publish never；适用VS/VG package verify。
- 复用TF-0584 OAT driver与本lane fixtures；packaged-run/installed/operational分别裁决。

指标：意外源码依赖=0；包内核心3profile通过。

## F3

**形成编码能力成熟度、残余风险和发布前结论**

目的：按当前证据说明可执行范围，阻断用历史绿灯或分类冒充GA。

来源：最终裁决。

入口/受控范围：

- README.md
- README.zh-CN.md
- README.ja-JP.md
- README.ru-RU.md
- docs/modules/workspace-and-coding.md
- docs/modules/verse-tools.md
- shared/dcs/component-disposition-catalog.ts

要求：

- 聚合10发现与VG/STS/JJ/VS、joint/package/recovery，复用TF-0585最终全量入口。
- 缺陷/not-applicable/retired/opt-in/internal/未测/发布批准分别记录；没有净收益不包装成收益门通过。
- 独立agent verifier自动运行；产品锁/默认值/公开发布重大决定另提案，不等真人数据。

验收（同时满足共同验收）：

- A1-A10全部resolved，新增P0/P1=0；必需证据缺失/过期/矛盾保持needs-fix。
- requirement→command→oracle→negative→artifact→verdict全覆盖；删receipt/改candidate/伪scope/旧结果复用均拒绝。
- functional/quality/performance/operational/distribution/release独立结论，默认/advanced/internal/retired真实，不自动GA。
- 更新精确持久规格/精选证据及README；validate/export一致，全量门集中执行一次。

执行入口（待执行，实施spec固定最终命令和产物）：

- typecheck、lint:check、contract/comms、同candidate所需full unit/Electron/package gates。
- 独立verifier从磁盘复算hash/count/scope，按TF-0585聚合协议消费结果。

指标：当前P0/P1=0；required缺失=0；未授权默认/发布变更=0。

## 规划落图完成条件

proposal-save的base_graph_hash匹配后apply，validate/export与CLI list/todo回读：新增25节点（1程序+5阶段+19叶），本lane只有C0 ready，19叶进度0，18串行依赖，TF-0585不能绕过新程序。并发图变化则重新读取/重建，不用allow-stale。TF历史/原始审计本地保留，持久规格/精选最终证据按retention入源码。
