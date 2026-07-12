# DCS-v1.6 最终对抗审阅：阶段 0 契约已收敛

**审阅对象**：`team/dcs/dcs-v1.6-spec.md`  
**审阅日期**：2026-07-10  
**审阅基础**：v1.2-v1.5 全部审阅问题、实际 legacy builder 签名、SQLite transaction 能力、session-key 谓词与 plugin/harness hook 事实  
**审阅立场**：最终版本必须可直接转化为 RED 测试，不保留致命接口分叉

---

## 0. 总体判断

v1.6 已接受并正确修复 P：

- `selectHandlers` 唯一返回 `LegacyHandlerId[]`；
- 阶段 0 只包含 compass / role-memory 两个 legacy builder；
- eligible handler 与实际调用记录分离；
- `Assembler.assemble()` 明确为异步，默认直接复用现有两个 builder；
- 全关闭和全阶段 0 都保持 `existing_output` 原引用。

结合前几轮已修复问题，v1.6 **无致命问题，规范收敛**，可以进入阶段 0 测试与实现。

---

## 1. 历轮致命问题闭环

| 问题 | 最终状态 | v1.6 可验证契约 |
|------|----------|----------------|
| A HandoffPack 通过 extra string | 已修复 | child task_state 持久化；extra 仅提示读取 |
| B session 正则漏多段 key | 已修复 | 共享 `isMainSessionKey` / `isSubagentSessionKey` |
| F main 谓词实际不存在 | 已修复 | 新增共享谓词，语义与现有私有实现一致 |
| G 重复新增 `agent_end` | 已修复 | 复用现有事件与调度，不重复触发 |
| H Assembler legacy 输入缺失 | 已修复 | `AssemblerLegacyInputs` 完整承载 builder 输入 |
| I 阶段状态类型不存在 | 已修复 | 统一复用 `RuntimeTaskStatus` |
| J 同 ID 历史写入与主键冲突 | 已修复 | 原位 upsert；历史新 ID + invalidate |
| K P0 判断事实无法传入 | 已修复 | `BlockAdmissionContext` |
| L mutability 类型冲突 | 已修复 | 两值 `BlockMutability` |
| M experience confidence 不可比较 | 已修复 | `retention_confidence` 持久化与事务淘汰 |
| N 公开类型/query API 不唯一 | 已修复 | 完整 block/query/stats/BlockStoreApi |
| O knowledge 来源门槛混用 | 已修复 | compass 专属准入，role-memory 通用准入 |
| P Assembler handler API 不唯一 | 已修复 | `LegacyHandlerId[]` 与三重实际调用门控 |

---

## 2. 最终一致性检查

### 2.1 类型与 Schema

- 8 种 BlockType 与两值 mutability 一致；
- ContextBlock 字段均可映射到 SQLite，内部 retention confidence 明确不扩散到公共 Block；
- `compression_depth`、entity status、fallback mode 有类型与列；
- 同 ID upsert、entity map 重建、容量淘汰处于同一 immediate transaction；
- 6 个显式索引与主键索引无冲突。

### 2.2 P0 准入

- persona / task_state / tool_registry：通用结构校验；
- working_memory：medium/high 接受，low/缺失拒绝，窗口内容留给阶段 1；
- experience：confirmed + 有限 confidence，最多 3 个有效项；
- compass knowledge：verification/confidence/AUDN；
- role-memory knowledge：不要求 COMPASS 专属字段；
- environment：文件路径 hint，最多 2 个有效项；
- notes：仅 context_write 来源。

### 2.3 查询与授权

- 默认 requester 只读自己；
- global 必须显式 opt-in；
- entity 查询必须经过 entity map，空 entities 返回空；
- child 只能依据自己当前有效 task_state HandoffPack 读取直接 parent；
- 任意 target 和递归祖先查询返回空并增加授权拒绝计数。

### 2.4 Assembler 与 session 分类

- main → compass；
- explicit subagent → role_memory；
- ACP / Cron / channel peer → 无 legacy handler；
- 对应 flag 默认 false；
- session、flag、input 三重门控决定实际 builder 调用；
- `selected_handlers` 只记录实际调用；
- `output` 始终保持 existing output 原引用。

### 2.5 Hook

- `contextBlockSink` 仅新增可选字段；
- `agent_end` 复用现有类型、runner、harness 路径；
- `task_phase_change` 新增类型、名称、handler map、runner 与 harness helper；
- 阶段 0 不伪造 TaskLoop producer，不修改现有 handler 逻辑。

---

## 3. MUST / MUST NOT 与验收映射

| 约束组 | 验收方式 |
|--------|----------|
| Block 类型与 mutability | TypeScript 类型测试 + upsert 拒绝测试 |
| P0 准入与容量 | BlockStore 单元测试 + stats rejection 断言 |
| Schema/索引/事务 | in-memory SQLite schema 查询 + upsert/invalidate 测试 |
| entity 提取与查询 | entity map 查询、状态、空 entity 测试 |
| 跨 session 权限 | self/direct-parent/arbitrary/ancestor 测试 |
| session 谓词 | main/subagent/ACP/Cron/channel 表驱动测试 |
| Assembler identity/flags | builder spy + 引用相等断言 |
| Hook 扩展 | hook name/map/runner/helper 单元测试 |
| 禁止正则与默认开启 | grep 验收 |
| 现有行为零回归 | typecheck、全量 test、lint |

---

## 4. ANTI-1~10 对应检查

ANTI-1 到 ANTI-10 均有正文约束和迁移/验收对应。阶段 0 特别覆盖：

- ANTI-2：compression depth 类型与运行时防御；
- ANTI-3：共享 session 谓词；
- ANTI-6：entity map 与查询 WHERE；
- ANTI-9：HandoffPack 存储与直接父授权；
- ANTI-10：只扩展现有 HookContext/plugin runner。

---

## 5. 最终结论

**致命问题：0**  
**中等问题：0**  
**阻塞阶段 0 的未决项：0**

v1.6 达到收敛标准。下一步按 TDD 顺序实施：先写并运行 RED 测试，再实现阶段 0，最后执行完整验收。

---

## 6. 阶段 1 前置对抗审阅补充（2026-07-10）

**审阅对象**：

- `team/dcs/dcs-v1.6-spec.md` 的阶段 1 admission-preserving sink 与同 session 串行化修订
- `harness/specs/tasks/dcs-stage1-working-memory-handler.md`

**发现与处理**：

| 问题 | 严重度 | 处理 |
|------|--------|------|
| Stage 0 `contextBlockSink` 只传 `ContextBlock[]`，无法向 `BlockStore.upsert` 传递 working_memory significance | 致命 | 权威规范新增 `ContextBlockWrite` / `ContextBlockSink`，逐项传递 `BlockAdmissionContext` 并返回同序 `BlockWriteResult[]` |
| 同 session 重叠 `tool_result` 可能基于同一旧窗口并产生丢更新 | 中等 | 规定单 attempt 内按 callback 进入顺序串行化，沿用既有 session write lock 作为跨 attempt 唯一互斥；仅在 sink 接受后推进 current Block |
| 任务规范的禁止项误伤 Stage 0 Assembler 既有 legacy builder 依赖 | 中等 | 禁止项收窄为“working-memory 新路径不得调用”，既有 `buildPreReplyInjection` / `buildContextPack` 依赖和 flag 门控必须保持 |
| Runtime build 缺失入口与 DCS Stage 1 行为范围不同 | 中等 | 按本 Goal 的明确验收要求保留为独立门禁修复责任，明确其不是 DCS 行为扩张或平行设计来源 |

**独立复审结论**：

- Critical：0
- Important：0
- admission-preserving sink 契约与 loss-update race 已闭环
- 允许进入阶段 1 RED 测试；生产实现仍必须等待 Harness 前置门禁通过
