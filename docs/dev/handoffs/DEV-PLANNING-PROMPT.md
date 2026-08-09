# 开发规划提示词 — Verse Claw 系统架构下一阶段规划

> 交付对象：规划/架构 agent（全新上下文）
> 生成日期：2026-08-09
> 仓库：`C:\Users\27933\Desktop\clawx\ClawX`（Windows，PowerShell 5.1）
> 本提示词自包含：当前状态、必读清单、架构不变量、近期开发上下文、规划方法论与交付物。

## 0. 你的任务

基于仓库当前真实状态，产出**下一阶段的系统架构开发规划**：一份可执行、可验证、严格串行、不破坏既有验收证据的分阶段计划。规划必须覆盖：(a) 已知偏差与遗留债的处置；(b) 未完成 workstream 的排序；(c) 架构演进候选方向；(d) 每阶段的 gate、spec、测试与验收方式。**只产出规划，不实现。**

## 1. 当前状态快照（事实基线）

- main HEAD：`55ec051ec5b38e2415ea6905437fe6a6d3b8305a`（已同步 origin/main）。
- **Runtime Authority Convergence（RC-00..RC-10）已完成**：工程验收 PASS（候选 `3209f0981`，base `b8a6c1832`，18 gates，Verifier engineeringAcceptedByAgent=true）+ 用户 accepted（human-verdict.yaml）→ STATUS.md `program_status: done`、`done_allowed: true`、accepted_work_packages=RC-00..RC-10。
- 验收证据：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/` + `runs/rc*-accept-*/`；真实轮证据 `rc10-round-1/`。
- 工程候选链分支 `rc09-final-candidate` 保持不动（证据载体）；候选 worktree `C:\Users\27933\Desktop\clawx\ClawX-rc01r-candidate`。
- 主工作树另有并行 workstream：FakeCoding UI（TF-0021..TF-0027）、Agent Dev Ecosystem（P0-P3）、checkpoint/设计暂存等——**不得混入或回滚**。

## 2. 必读清单（按序，读后进入规划）

1. `AGENTS.md`（根：命令表、Renderer/Main 边界、i18n/样式约定、comms 变更清单、doc sync 规则、spec-driven harness 规则、COMPASS）
2. `docs/dev/Sustained-Development-Playbook.md`（长期持续开发的强制入口）
3. `docs/dev/handoffs/LATEST.md`（最新交接：RC-09 破 blocked 全程 + RC-10 真实轮 + accepted 判定）
4. `docs/dev/unified-agent-system/runtime-convergence/`：`STATUS.md`、`WORK-PACKAGES.md`、`TARGET-ARCHITECTURE.md`、`ACCEPTANCE.md`、`HUMAN-ACCEPTANCE.md`、`AGENT-START.md`、`RC-09-REMEDIATION-PLAN.md`（§2 不可变边界、§19 finding 矩阵是架构红线）
5. `docs/dev/handoffs/FULL-TEST-PROMPT.md`（配套全量测试提示词——你的规划必须回应其中的 health-report/rc-completeness/e2e-inventory 发现）
6. 架构真相源：`openclaw_runtime/src/context-engine/`（DCS 核心）、`openclaw_runtime/src/agents/`、`electron/`（Main/Preload）、`src/`（renderer）、`shared/`（host-api contract、i18n locales）
7. Task Forest（只读）：`.agent-workbench/task-forest/graph/nodes.json` + `exports/task-forest.html`（受支持 CLI 不可用，禁止直接编辑）
8. Harness：`harness/specs/tasks/rc*.md`（每个 RC 的完成定义）、`harness/specs/rules/*.md`（硬规则）、`harness/specs/scenarios/`（用户可见场景）
9. `README.md`（+zh-CN/ja-JP 同步要求）、`src/styles/globals.css`（组件约定/设计 token 替换表）
10. Agent Dev：`shared/agent-dev/scenarios.ts`（单一场景注册表）、`artifacts/agent-dev-deep-test/report.json`（性能基线/decision.status）、`artifacts/agent-dev-audit/report.json`（maturity 记分卡）

## 3. 近期开发上下文（规划必须承接的真实线索）

### 3.1 已闭环
- Runtime Authority Convergence：DCS seal/双收据（RC-02/03）、durable approval+EffectReceipt（RC-04）、operator 治理切片+Inbox（RC-05）、TaskFlow CAS+三域投影（RC-06A-D）、memory/context slot 收敛（RC-07）、MCP 真实握手（RC-08A）、OTel 真实导出（RC-08B）、最终 18-gate 独立验收 + 用户 accepted。

### 3.2 已知偏差与遗留债（规划第一优先输入）
1. **FP-P1-11 DCS budget channel 偏差**：真实 attempt 路径 `byChannel` 计费 `cvk_addition`、未计费 `working_memory`（确定性；运行时单测覆盖机制但 E2E 断言失败）——需根因分析（working_memory producer 空块/未注入？）后定修复方案，注意：改 runtime 生产代码 = 新候选 + 重新验收，必须走 harness spec + 所有权。
2. **FP-P1-01 Setup provider/model 验证 E2E 方差**。
3. **全量 E2E 残留失败**：全量 286 中本会话修复 fork/handoff/inbox/restart/diff-viewer 等后仍有 pre-existing 失败（visual 快照需刷新、recovery 迁移、kysely/hoist 环境类等）——规划应含 E2E 基线清理任务（独立于 RC）。
4. **maturity/release 证据轨道**：P6-005（release baseline 证据 pinned 到历史 ref、chicken-and-egg）与 P7-003 再生成文件归属问题——RC-09 期间被判定"非候选范围"而未并入；如需做 release 就绪需单独裁决。
5. **Task Forest closeout**：程序 done 后需 closeout proposal（受支持 CLI 恢复后）。
6. **主工作树 rc01 pins 用例**：main 与 origin/main 同步时按设计失败（面向候选 worktree）——如要 main 侧全绿需调整测试设计（属控制面决策）。

### 3.3 进行中 workstream（不得并入上述修复，规划中单独排序）
- FakeCoding UI（TF-0021..TF-0027）：四入口导航/Inbox/Scheduled/工作区收敛/知识库/次级页面收尾+legacy 移除——TF-0025 in_progress、TF-0026/27 proposed（见 nodes.json）。
- Agent Dev Ecosystem：P0 完成、P1 大部分落地、P2 早期产品化（Settings>Developer Workbench）、P3 未完成（skill sandbox、effect logs、requestId trace/cost 关联）——deep-test/audit 证据在 artifacts/agent-dev-*。
- 其他：checkpoint、.design-staging、原型（prototypes/）等分离目录。

### 3.4 架构演进候选（规划需评估并给建议，不承诺）
- DCS 侧：working_memory producer 真实路径修复后的注入预算深化；context-ladder/token-pressure 与预算联动；dcs-corpus 合成语料扩展。
- 治理侧：operator Inbox 从 fixture 到真实 channel 的接入路径（RC-10 H-03 以 fixture 通过是用户 override——真实 channel 接入仍是待办）。
- 可观测侧：OTLP exporter 的生产安装时机（trace-buffer 的 setObservabilityTraceExporter 默认 null，安装点待裁决）；Observability JSONL 可重建性。
- 平台侧：Electron E2E 环境债（kysely/hoist 已由 bundledMainRuntimeDependencies 覆盖，但全量 E2E 绿线、snapshot 维护、CI 化）。

## 4. 架构不变量（规划红线，违反即打回）

1. **不可变边界**（RC-09-REMEDIATION-PLAN §2）：不新增第二 runtime/workflow engine/receipt store/memory/context store/协议/telemetry store/router/daemon/port/sidecar；runtime_receipts/approval ledger/TaskFlow 只复用既有 openclaw-state SQLite。
2. **raw 数据不落盘**：prompt/tool output/message body/credentials 不得默认持久化；持久证据只允许 digest/refs/identity/policy digest/bounded metadata。
3. **单一 authority**：DCS 是唯一 contextEngine slot；approval ledger 唯一 owner；TaskFlow 唯一 workflow lifecycle writer；parallel writers=0。
4. **fail-closed**：未知/缺失/漂移一律拒绝；不做"预计能过"的保证；验收必须真实 diff（禁 --no-diff）。
5. **Renderer/Main 边界**：renderer 只用 `src/lib/host-api.ts`/`api-client.ts`；不新增裸 `ipcRenderer.invoke`；不直连 Gateway HTTP。
6. **文档同步**：功能/架构变更同 PR 更新 README（en/zh/ja）、WORK-PACKAGES、AGENT-START、harness spec（spec/rule growth rule：新特性=新/更新 harness task spec + 规则）。
7. **UI 变更**：新用户可见 UI 必须 en/zh/ja/ru i18n + Electron E2E 同 PR。
8. **验收证据**：任何涉及通信/权威的变更需重跑 comms:replay/compare 与对应 RC harness validate；改候选代码 = 所有权矩阵 + 独立验收流程。

## 5. 规划方法论（输出格式）

按阶段组织，每阶段必须包含：

1. **目标与完成定义**（可执行断言，非形容词）。
2. **范围**：touched paths（对照 RC ownership matrix 精神，禁止无主路径）。
3. **前置条件**（依赖的上游阶段/证据）。
4. **动作序列**（实现步骤 + 命令）。
5. **Gate**：聚焦单测命令 + 预期计数、全局 lint/typecheck、harness validate（带 --since）、相关 E2E、build、comms（如触及）。
6. **验收方式**：本地门禁 or 独立候选验收 or 用户验收；明确谁有权判定。
7. **回滚**：shadow/observe 关闭 or 显式互斥切回；不得双写。
8. **风险与裁决点**：需要用户/owner 拍板的事项单独列出。

排序原则：先债务（§3.2）后演进（§3.4）；workstream（§3.3）并行但互不污染；每阶段只推进一个 ready 节点（COMPASS 默认策略：one ready TF node per session）。

## 6. 交付物（写入 `docs/dev/planning/` 或报告给调用方）

1. `architecture-plan.md`：阶段化计划（含 §5 全字段）、依赖图、总览表（阶段/目标/前置/gate/验收/风险）。
2. `debt-backlog.md`：§3.2 每项债务的处置方案（修/裁决/挂起）+ 建议顺序。
3. `decisions-needed.md`：需要用户/owner 裁决的决策点清单（含选项与建议）。
4. `workstream-map.md`：§3.3 各 workstream 与主线的边界矩阵（谁碰哪些路径、验收谁说了算）。
5. 顶部 10 行结论摘要（下一阶段唯一动作 + 关键风险 3 条）。
