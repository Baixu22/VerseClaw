# Context Control Plane 开发约束文档

| 字段 | 值 |
|---|---|
| 文档版本 | v1.0 |
| 状态 | 本轮开发的唯一约束入口；后续 spec/代码不得与其冲突 |
| 日期 | 2026-08-16 |
| 架构基线 | `docs/dev/context-capability-blueprint.md`（rev3） |
| 权威边界基线 | `docs/dev/adr/2026-08-16-context-authority-boundaries.md` |
| 代码基线 | `f55201b22`（当前 main HEAD；开发工作树建立时的实际 HEAD 以执行记录为准） |
| 开发工作树 | `D:\verse_claw_worktree` |
| 建议分支 | `codex/context-control-plane-stage0`（如执行时调整，需在开发日志中记录） |
| 产品锁 | `defaultOn=false`、`liveReady=false`、`productApproved=false`，本轮不得变更 |

---

## 1. 目的

本轮开发的目标不是“再做一个上下文功能”，而是把 ClawX 向**可信 Agent 控制平面**收敛：

> 每个模型可见 token、每次工具调用、每个持久化写入都必须能回答：
>
> 从哪里来？为什么允许？以谁的权限？最终造成了什么效果？

本约束文档用于防止开发重新滑向：

- 只增加模块/artifact，不形成闭环证据；
- 在单一权威闭合前继续增加 provider/flag；
- 用 synthetic/agent-surrogate 证据替代真实黄金路径；
- 用“工程门禁全绿”推断“控制平面已成立”。

---

## 2. 固定架构（不可在本轮推翻）

### 2.1 五平面

| 平面 | 唯一问题 | 权威 | 核心产物 |
|---|---|---|---|
| 数据平面 | 原始事实在哪里 | transcript、workspace、Task Ledger、Mem、Archive | `ContextRef` |
| 能力平面 | 当前有哪些能力可发现 | V3 Catalog | `CapabilityDescriptor` |
| 上下文平面 | 本轮模型该看到什么 | DCS | `CompilationSnapshot`、`PromptPlan` |
| 效果平面 | 这次调用是否有权执行 | Capability Grant + Tool Guard | `EffectReceipt` |
| 出口与证据平面 | 最后到底发了什么、发生了什么 | Provider Guard + journal | `RequestEnvelope`、Receipt |

### 2.2 六 artifact

| Artifact | Owner | 职责 |
|---|---|---|
| `ContextRef` | Owner stores | owner、source reference、revision、content digest、ACL、retention、provenance |
| `CompilationSnapshot` | DCS | 编译输入冻结：refs、catalog epoch、policy epoch、model profile、Task Ledger revision |
| `PromptPlan` | DCS | selected/omitted/order/budget/why |
| `RequestEnvelope` | Provider Guard | provider 最终请求 |
| `CapabilityGrant` | 现有 policy/approval/session identity 派生 | 主体、任务分支、资源、动作、purpose、TTL、revocation epoch |
| `EffectReceipt` | Effect boundary | 工具/写入真实执行后的证据 |

### 2.3 不变式

1. V3 不是权限；V3 只发布能力发现元数据。
2. DCS 不是数据库；DCS 服务可丢弃，但编译证据必须可恢复。
3. Mem 不是全局事实库；Mem 只拥有持久语义记忆与检索/摘要候选。
4. Provider Guard 不是第二个 prompt compiler；它只证明最终请求是什么、由哪些 transform 生成。
5. 不新增真相源，但必须新增统一逻辑契约与适配层。
6. 最终全局不变量：系统级未登记旁路为 0；break-glass 必须有审计记录。
7. 子 agent 权限严格 ≤ 父 agent。

---

## 3. 本轮开发范围

### 3.1 默认入口：Stage 0

本轮首先只允许完成 **Stage 0**：

```text
冻结五平面、六 artifact、policy/grant/effect 契约。
```

Stage 0 交付：

- 每个 artifact 的首版最小 schema；
- 每个字段的 source、policy、owner、生命周期；
- authority 适配层设计：现有资产如何映射为逻辑 authority；
- 黄金 coding turn 的端到端链路图与数据契约；
- Stage 1 的 task spec 与验收清单。

### 3.2 解锁 Stage 1 的条件

只有满足以下条件才允许进入 Stage 1：

- Stage 0 的 authority 矩阵和六 artifact 契约经过独立复核；
- 黄金路径定义被接受：普通 coding turn，从输入、上下文、权限、provider 请求到至少一个真实工具副作用；
- 现有资产成熟度表述已按“工程资产”降级；
- Stage 1 task spec 已创建并通过 harness 结构校验。

Stage 1 的范围固定为：

```text
Provider Guard + 一个真实工具调用 + EffectReceipt
```

Stage 1 使用现有 approval/effect 链派生**临时最小 grant**；完整 `CapabilityGrant` 契约留到 Stage 4。

### 3.3 禁止提前做

- 不迁移全部 Memory/Skill/CVK/FactStore；
- 不实现上下文经济系统、学习型排序、反事实分析；
- 不先做 Context diff / policy simulation / replay debugger；
- 不在黄金路径跑通前扩展 channel、cron、browser、多 agent。

---

## 4. 工作树与分支约束

### 4.1 工作树

- 本轮代码修改只能发生在 `D:\verse_claw_worktree`。
- 主工作树只保留设计文档和审计材料，不直接开发。
- 工作树创建时从当前 main HEAD checkout。
- 当前主工作树中未提交的设计文档（蓝图 rev3、ADR、本约束文档）必须复制到开发工作树，作为本轮输入。

### 4.2 分支

- 推荐新分支：`codex/context-control-plane-stage0`。
- 不直接在 main 上提交开发代码。
- 每个 stage 至少一个独立提交；禁止把多个 stage 混在一个 commit。
- 不 push、不创建 PR，除非用户明确授权。

### 4.3 环境

- 使用项目 pinned pnpm：
  - `corepack enable`
  - `corepack prepare`
  - `pnpm install`
- 不要修改 `package.json` 的 `packageManager`。
- 工作树初始化后先确认依赖与构建基线，再开始改代码。

---

## 5. 开发前检查清单

在写第一行生产代码前，必须逐项确认：

1. `D:\verse_claw_worktree` 已创建并切换分支。
2. 蓝图 rev3、ADR、本约束文档已存在于工作树。
3. 已确认当前 HEAD SHA，并写入开发日志。
4. 已确认产品锁仍为 `defaultOn=false`、`liveReady=false`、`productApproved=false`。
5. 已确认本轮只做 Stage 0（除非 Stage 1 已显式解锁）。
6. 已创建 `harness/specs/tasks/` 下的 Stage 0 task spec，并运行：
   - `pnpm harness context --spec <spec>`
   - `pnpm harness validate --spec <spec>`
7. 已明确 touchedAreas 与 owner 路径，不触碰无关工作流。
8. 已记录开发日志位置。

---

## 6. 编码约束

### 6.1 通用

- 所有新代码默认关闭；不得翻默认。
- 所有新能力先 shadow/observational，再考虑权威。
- 不得新增第二个上下文投影 authority、第二个权限数据库、第二个 approval ledger、第三个 durable memory writer、第四个能力目录。
- 新增逻辑契约必须是派生/适配层，不复制现有事实。
- 未经用户明确授权，不运行真实 provider、真实 channel、真实浏览器、真实远端副作用。
- 不把未授权能力写进 README 或产品文案。

### 6.2 DCS / Provider Guard

- DCS 只做 admission/resolve/pack/compile，不拥有原始事实。
- `CompilationSnapshot / PromptPlan / Receipt` 必须可保存或引用全部编译输入版本。
- Provider Guard 只做 `RequestEnvelope` digest 与 transform 登记，不筛选内容、不改 policy。
- 禁止**未声明、未登记、未经过 sealed plan** 的 mutation。
- 合法 provider transform、cache boundary、session transition 必须登记；不登记即违规。

### 6.3 工具与效果

- 模型可见能力必须来自 V3 descriptor 投影；执行仍由 Runtime/MCP 负责。
- Tool Guard 契约字段从 Stage 0 起冻结：actor identity、grant scope、TTL、parent/child delegation、approval reference、revocation、effect idempotency。
- 每个工具/写入副作用必须产出 `EffectReceipt`。
- 子 agent 永不获得大于父 agent 的权限。

### 6.4 Memory

- Memory 检索可后接，Memory 写入从黄金路径开始必须经过 effect boundary。
- Memory 只产出候选，DCS 决定是否进入 prompt。
- 不新增并行 memory writer。

### 6.5 Working Context / Task Ledger

- Working Context 是版本化任务账本，不是长期记忆。
- 更新只能是 proposal；accept/reject 有事件和 actor。
- 任务结束后，只有确认项才可晋升到 Mem。
- fork/handoff 必须有确定合并规则，不自动复制整个 ledger。

---

## 7. 验证与证据约束

### 7.1 基础门禁

改动触及对应领域时必须运行：

| 领域 | 门禁 |
|---|---|
| 契约/共享类型 | `pnpm contract:check` |
| 全仓语法/格式 | `pnpm run lint:check`、`git diff --check` |
| TypeScript | `pnpm run typecheck` |
| runtime 单元测试 | `pnpm --dir openclaw_runtime exec vitest run <files>` |
| root 单元测试 | `pnpm exec vitest run <files>` |
| 通信路径 | `pnpm run comms:replay` + `pnpm run comms:compare` |
| UI 变更 | 对应 Electron E2E spec |
| harness spec | `pnpm harness context --spec <spec>`、`pnpm harness validate --spec <spec>` |

### 7.2 证据级别

- E2/E3 只能证明局部行为，不得写成生产可用。
- E4 必须包含真实 provider 和真实任务记录；synthetic 不能替代。
- 所有验收报告必须记录 HEAD SHA、dirty patch、跳过测试及理由。

### 7.3 本轮 Stage 0 的退出证据

- 五平面 authority 矩阵；
- 六 artifact 最小 schema；
- 黄金 coding turn 链路图；
- Stage 1 task spec 草案；
- 独立复核意见；
- 产品锁未变更。

---

## 8. 安全与数据约束

- 敏感信息未通过 sensitivity/redaction 判定，不得进入索引、Working Context、Receipt。
- Receipt 不存原始内容。
- `ContextRef` 的 ACL/retention 必须与 owner store 对齐，不允许扩大可见性。
- untrusted 文件、网页、OCR、工具结果、Memory 摘要只能是数据，不能被提升为系统指令。
- 测试不得写入真实密钥、真实工作区路径或真实用户数据。
- break-glass 路径必须保留审计记录。

---

## 9. 提交与评审约束

- 一个 stage、一个关注点、一个 commit。
- 提交前在开发工作树内跑对应门禁，并贴原始输出到开发日志。
- 不提交：
  - 真实凭据；
  - 本地临时证据（除受控 artifacts 目录）；
  - 对产品锁/默认值的“为了证明可用”的翻转。
- 需要用户决策时停止，不自行扩大范围。
- 独立审计/verifier 意见未确认前，不得把 Stage 0 标为完成。

---

## 10. 冲突与升级

如果开发中发现以下冲突，必须停止并记录：

- 本约束与蓝图 rev3 / ADR 冲突；
- 六 artifact 无法映射到现有资产；
- 黄金路径无法做到 egress 100% 覆盖；
- Provider Guard 引入可感知性能回退；
- 现有 approval/effect 链无法派生最小 grant；
- Tool Guard 与现有 MCP/tool policy 出现第二权限权威。

冲突不得用扩大范围或“临时绕过”解决；应升级给 owner 裁决。

---

## 11. 本轮开发日志

建议在开发工作树中维护：

```text
D:\verse_claw_worktree\docs\dev\context-control-plane\DEVLOG.zh-CN.md
```

至少记录：

- 工作树创建命令与 HEAD；
- 分支名；
- Stage 0 每日切片；
- 命令输出摘要；
- 冲突与决策；
- 独立复核结果。

---

## 12. 最终验收措辞限制

本轮只能使用：

```text
draft / proposed / in_progress / blocked / deferred / done
```

禁止使用：

```text
liveReady / productApproved / GA / default-on
```

除非对应产品锁被用户显式变更。
