# VerseShell、VerseToken 与 Coding 组件统一 Agent 系统开发策略

> 状态：`roadmap-approved / task-forest-registered / implementation-not-started`
>
> 创建日期：2026-07-27
>
> 更新日期：2026-07-27
>
> 目的：冻结统一 Agent 系统的开发原则、已验证事实、架构裁决和连续性入口，避免后续因会话压缩或上下文丢失改变目标。

## 1. 用户目标

构建一个统一、可自研扩展的 Agent 系统，使：

- VerseShell 成为安全、可审计、可恢复的本地执行平面；
- VerseToken 作为无业务状态的 context packer/renderer，不拥有最终预算或 Memory；
- Coding 组件继续提供 Agent 熟悉的编码工具和工作流；
- DCS、Working Memory、长期 Memory 与执行结果形成一致闭环；
- Agent 不需要学习大量底层 operation，也不承担额外智能路由成本；
- 系统可以全量使用统一执行和上下文基础设施，而不是长期保留两套平行主路径。

## 2. 本文件定位

本文是统一 Agent 系统的**开发原则和连续性真源**。完整源码审计、架构矩阵和实施路线见 `CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md`。本文记录：

1. 为什么要做这次融合；
2. 哪些职责已经冻结，哪些仍待源码验证；
3. 需要从 VerseToken、Coding、DCS/Memory 和 VerseShell 中收集哪些证据；
4. 如何从能力盘点进入架构裁决和实施；
5. 新会话如何在不依赖聊天记录的情况下继续。

本文不是：

- 最终目标架构；
- Harness task spec；
- default-on、GA 或生产批准；
- 组件已融合完成的声明。

相关权威：

| 主题 | 权威位置 |
|---|---|
| 统一能力审计与目标路线 | `docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md` |
| VerseShell 当前状态 | `docs/dev/verseshell-foundation/STATUS.md` |
| VerseShell 能力审计与现有调度 | `docs/dev/verseshell-foundation/CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md` |
| 当前会话续接 | `docs/dev/handoffs/LATEST.md` |
| 正式任务状态 | `.agent-workbench/task-forest/` |
| 实施门禁 | `harness/specs/**` |

## 3. 调研后已验证事实

### 3.1 VerseShell

- ClawX 内置 `ae.exe` 与上游 release binary 完全一致，不是裁剪版；
- 上游 typed catalog 有 26 个 operation；
- ClawX Agent 主路径实际只使用 `runtime.handshake`、`exec.run` 和 `result.query`；
- 当前 `exec.run` 仍通过 `cmd /C`、PowerShell、Git Bash 或 `sh -lc` 包装 command string；
- 上游缺少 stdin、后台生命周期、PTY/ConPTY、主动取消和 process start/read/write/kill；
- VerseShell workspace jail 不是 OS filesystem sandbox；
- transaction/test 等状态型能力存在进程级共享和 authority 冲突，当前不应接入。

### 3.2 ClawX Context/DCS

- `context-orchestrator.ts` 已声明为入口，但目前只直接编排 attempt 阶段的 memory pilot 和 VToken；
- 每次 LLM 调用前的 `agent.on("context") -> Assembler` 仍是独立动态路径，且没有收到同一 `turnId`；
- 共享 turn ledger 已存在，但 `TURN_INJECTION_PRECEDENCE` 只记录索引，当前不会按声明优先级重排执行；
- DCS Assembler 已拥有 working-memory、BlockStore、工具注册信息、私有/共享 injection budget 和 kill switch；
- DCS/Memory 的语义、隐私、保留和注入决策不应下沉到进程执行器。

### 3.3 VerseToken 与 Coding

- VerseToken `0.4.3` 的生产 worker 是单例，完整 assembly 通过 `runExclusive` 全局串行；
- 生产每回合重建临时 graph，却额外打开空 MemStore/WAL/lock，host RPC 不暴露 `vt.write`；
- 默认 token counter 是 `len(text) // 4`，只能作为 estimate；
- Coding 是分布式模型工具门面和治理层，不是单一待迁移包；
- Coding 已拥有 journal、undo、stale guard、lease 和写后验证，但 `apply_patch` 缺多文件 mutation queue/原子失败语义；
- write wrapper 的实际执行顺序与“lease first”的注释意图不一致。

### 3.4 Task Forest

- `TF-0007` 是“DCS 与关联组件受控内测投用收口（非 GA）”；
- 当前 ready 节点是 `TF-0009`；
- `TF-0006` 仍 blocked，不能因本研究解除；
- proposal `TFP-unified-agent-system-roadmap-20260727` 已获确认并应用；
- `TF-0010` 是统一 Agent 主线全局容器，`TF-0011` 至 `TF-0019` 为串行节点，当前全部 proposed；
- `TF-0011 depends_on TF-0009`，因此不得跳过现有受控内测直接实现统一主线。

## 4. 已裁决目标架构

以下架构已通过当前源码调研并登记到 Task Forest；每个节点仍需相应 Harness task spec 和门禁后才可实施：

```text
Agent Model
    |                         |
Coding Facade            Context Orchestrator
    |                     candidates/dedup/budget/lineage
Execution Contract            |
    |                     VerseToken pure packer
VerseShell                     |
    |                     BlockStore / Runtime Memory / SEKB
OS Process/Artifact       Prompt/Working/Recall/Archive
```

初始职责假设：

| 组件 | 已裁决职责 | 仍需实施验证的问题 |
|---|---|---|
| ClawX/OpenClaw | policy、approval、工具 facade、session、Context Orchestrator | 动态 context 路径是否完全收口 |
| VerseShell | 声明式执行计划、进程生命周期、observation、artifact | 能否补齐 exec/process 等价性 |
| VerseToken | 无业务状态的候选装箱和渲染 | 并发隔离和 provider tokenizer/estimate 语义 |
| Coding 组件 | 模型侧编码工具、写入安全、journal/undo、工作流体验 | apply_patch 原子性和 wrapper 顺序 |
| DCS | context selection、去重、预算、lineage、injection | 实际优先级调度和唯一动态入口 |
| Memory/SEKB | BlockStore working、Runtime Memory facts、SEKB curated experience | 长期事实闭环和明确写入门 |

最终原则是“统一 typed contract 和主路径，不统一 authority 或进程”。源码已经证明 Coding、BlockStore、Runtime Memory/SEKB 各有不能迁入 VerseShell 的稳定职责。

## 5. 不可变开发原则

1. **先证据、后融合**：先画真实调用图和数据所有权，再决定移动代码或新增协议。
2. **策略与机制分离**：ClawX 决定允许什么、注入什么、保存什么；执行器只执行已批准计划。
3. **单一 authority**：同一类状态只能有一个权威写入者，禁止双 Context Orchestrator、双 journal、双 token budget。
4. **稳定模型接口**：不以暴露底层 operation 数量代表能力完整。
5. **确定性调度**：本地执行模式由 typed plan 和风险规则决定，不增加 LLM router。
6. **Artifact 不是 Memory**：artifact 是原始证据；进入 working/long-term memory 必须经过 DCS/Memory policy。
7. **失败关闭但不虚构沙箱**：Job Object、capability 和 jail 不能替代真实 OS sandbox。
8. **可回滚演进**：每个阶段有 kill switch、兼容窗口、证据和停止条件。
9. **默认关闭不等于最终双轨**：迁移期允许 canary，目标状态必须明确唯一主路径。
10. **收益需要真实数据**：provider usage、完成率、工具轮次、延迟和恢复率分开记录。

## 6. VerseToken 调研检查表（已完成）

以下问题均已完成源码核对，答案见融合审计第 4.2 节：

调研必须回答：

- 源码、包入口、运行时、进程模型和打包方式是什么；
- 它是 tokenizer、上下文压缩器、预算服务、RPC worker，还是多种能力聚合；
- 当前生产调用方有哪些，是否经过 host-api/Main 边界；
- 输入输出 schema、版本、错误语义、超时和并发模型是什么；
- 是否持有会话状态，状态按什么 key 隔离；
- 与 DCS injection budget、VToken assembly、Context Orchestrator 的关系；
- 是否已有缓存、fingerprint、lineage、observability 和 kill switch；
- token estimate 与 provider actual usage 如何区分；
- 冷启动、热调用、超大输入和失败恢复成本；
- 最终应作为 library、独立 worker、Main service 还是 execution-side capability。

禁止在回答这些问题前把 VerseToken 放入 VerseShell 或设为唯一 token authority。

## 7. Coding 组件调研检查表（已完成）

以下问题均已完成源码核对，答案见融合审计第 4.3 节：

首先确认“Coding 组件包”的真实边界和命名，然后回答：

- 模型侧实际注册了哪些编码工具；
- `exec/process`、read/edit/write/apply_patch/search 的构造和调用路径；
- workspace containment、approval、stale-write、mutation queue、write journal、undo、写后诊断分别由谁负责；
- 组件是 package、extension、运行时 facade，还是多目录组合；
- 是否已有统一 tool result、artifact、diagnostic 和 lineage contract；
- 哪些能力应保持在 Coding 层，哪些应下沉到 VerseShell；
- Coding 输出如何进入 DCS、working memory、SEKB 和长期 Memory；
- 长任务、后台进程、测试发现和错误恢复的真实体验；
- 当前 flag、kill switch、telemetry、E2E 和生产证据；
- 是否存在与 VerseShell file/repo/test operation 的重复。

## 8. 融合裁决产物

R1-R4 的架构产物已在融合审计中交付；Task Forest proposal 已应用，Harness task spec 按节点创建：

1. **组件能力清单**：VerseShell、VerseToken、Coding、DCS、Memory 各自的真实能力；
2. **调用图**：从 Agent tool call 到进程、observation、context injection、memory persistence；
3. **authority matrix**：每个 schema、状态和副作用的唯一 owner；
4. **重叠/缺口矩阵**：复用、迁移、补齐、淘汰；
5. **目标 contract family**：execution plan、authorization、observation、artifact、context budget、memory candidate、trace；
6. **性能与学习成本基线**：不得只用估算 token；
7. **串行实施计划**：每阶段范围、依赖、退出条件和 NO-GO；
8. **Task Forest proposal**：`TFP-unified-agent-system-roadmap-20260727` 已保存并应用；
9. **Harness task spec**：涉及通信路径时引用 `gateway-backend-communication`。

## 9. 调研与开发顺序

| 阶段 | 内容 | 状态 |
|---|---|---|
| R0 | 冻结本开发策略和连续性入口 | 本文件完成即结束 |
| R1 | VerseToken 源码、契约、调用方、性能和 owner 调研 | completed |
| R2 | Coding 组件边界、工具链、写入安全和结果流调研 | completed |
| R3 | DCS/Memory 与两者的真实调用图、重叠和缺口 | completed |
| R4 | 形成唯一推荐架构与 contract family | completed，见融合审计 |
| R5 | 提交并应用 Task Forest proposal | completed；Harness spec 在 `TF-0011` 开始时建立 |
| I1+ | 按单一 ready 节点实施 | 未开始；先完成 `TF-0009` |

研究顺序可以并行读取证据，但架构裁决必须等 R1-R3 全部完成。实现阶段严格串行。

## 10. 预期方案评估维度

最终候选方案至少按以下维度评估：

| 维度 | 判定问题 |
|---|---|
| 可行性 | 能否在现有 Electron/OpenClaw/Rust/Node 边界内落地 |
| 有效性 | 是否真正减少双轨、失败和模型学习成本 |
| 准确性 | token、context、artifact、memory 语义是否可信 |
| 完整性 | 是否覆盖 exec/process、context、memory 和恢复闭环 |
| 稳定性 | 进程崩溃、升级、断电、超时后能否解释和恢复 |
| 鲁棒性 | 多 agent/session/workspace 是否隔离 |
| 复杂度 | 是否引入第二 transport、第二 authority 或额外 LLM router |
| 运营性 | 是否有 metrics、kill switch、rollback 和 owner |

## 11. 硬性 NO-GO

- 未读源码就宣布 VerseToken/Coding 已完成融合；
- 把 DCS/Memory 迁入 VerseShell 形成运行时单体；
- 暴露全部 26 个 VerseShell operation 给模型；
- 新增内部 MCP 主路径；
- 用智能模型路由解决固定执行平面问题；
- 在 process 生命周期未等价前全量切换；
- 建立第二套 context budget、write journal 或 long-term memory authority；
- 把 Job Object/workspace jail 宣称为安全沙箱；
- 未经确认修改 Task Forest、default-on、TF-0006 或生产状态；
- 因全局脏工作树扩大 Harness touchedAreas 掩盖 scope 问题。

## 12. 连续性入口

### 12.1 最新接管摘要

以下内容供新会话直接继续，优先级高于 12.2 的研究前快照：

```text
Workspace:
C:\Users\27933\Desktop\clawx\ClawX-maturity-p0

Goal:
将 VerseShell、VerseToken、Coding、DCS/Working Memory/长期 Memory 收敛为统一 contract 和唯一主路径；不增加模型工具学习和 LLM 路由成本。

Final architecture decision:
- Coding owns model tools and file mutation governance.
- ClawX/OpenClaw owns policy, approval and workspace authority.
- VerseShell owns local process execution/lifecycle/observation/artifacts.
- Context Orchestrator owns candidates, dedup, precedence, final budget and lineage.
- VerseToken is a pure packer/renderer with no business Memory/WAL authority.
- BlockStore owns working context; Runtime Memory owns governed facts; SEKB owns human-confirmed reusable experience.

Key audit:
- VerseShell binary is complete, but exec/process lifecycle parity is not.
- VToken production opens an unused MemStore/WAL and globally serializes assembly.
- agent.on("context") Assembler omits turnId, so it does not share the attempt ledger.
- TURN_INJECTION_PRECEDENCE records order but does not schedule by that order.
- apply_patch lacks multi-file mutation queue/atomic failure semantics.
- vtoken-foundation-bridge task spec says default ON, while rule/code/tests say default OFF.

Evidence:
- docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
- pnpm vtoken:test: 246 passed, 1 failed (hot-reload concurrent final version)
- failing VToken test repeated 5/5
- focused OpenClaw Vitest: 147 passed
- root Orchestrator/VToken tests: 18 passed

Registered sequence, only after TF-0009:
TF-0011/UAS-00 evidence freeze + Harness/spec drift correction
TF-0012/UAS-01 unified contracts and durable event spine
TF-0013/UAS-02 Context Orchestrator authority closure
TF-0014/UAS-03 VToken pure-packer refactor
TF-0015/UAS-04 Coding mutation consistency
TF-0016/UAS-05 VerseShell lifecycle parity
TF-0017/UAS-06 cohort-level single local execution path
TF-0018/UAS-07 governed long-term Memory lifecycle
TF-0019/UAS-08 real ROI, soak and graduation decision

Do not:
- bypass Task Forest proposal workflow, modify default-on, or change TF-0006 without confirmation;
- put DCS/Memory into VerseShell;
- add LLM routing, internal MCP, cap all, legacy eval main path or native fallback;
- expose 26 VerseShell operations to the model;
- claim provider cost savings from heuristic token counts.
```

## 13. 更新规则

每完成 U0-U7 的一个阶段，应更新：

- 实际实现与融合审计的偏差；
- 调用图、authority matrix 和 contract 版本；
- 当前下一步；
- 关键测试、失败证据和回滚状态；
- 本文更新时间；
- 必要时同步 `docs/dev/handoffs/LATEST.md`，但不得用 handoff 覆盖本文的长期架构记录。
