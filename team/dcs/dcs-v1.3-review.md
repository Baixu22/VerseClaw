# DCS-v1.3 对抗审阅：路由与 pass-through 已修复，BlockStore 契约仍不闭合

**审阅对象**：`team/dcs/dcs-v1.3-spec.md`  
**审阅日期**：2026-07-10  
**审阅基础**：当前 runtime task status、SQLite schema、P0 准入条件、阶段 0 交付类型清单  
**审阅立场**：在写测试前证明接口可表达、Schema 可执行、类型可编译

---

## 0. 总体判断

v1.3 已正确修复上一轮三个致命问题：

- 共享 main-session 谓词与窄 session 分类可实现；
- `agent_end` 改为复用现有路径，不再重复新增；
- Assembler 具备 legacy 输入与全关闭 identity 契约。

但 BlockStore/类型层仍有 4 个实现阻塞问题，v1.3 **未收敛**。进入 v1.4 修订。

---

## 1. 新问题 I【致命】：`TaskPhase` 在当前代码中不存在

### 代码事实

仓库没有导出的 `TaskPhase` 类型。当前统一任务状态类型是：

```typescript
import type { RuntimeTaskStatus } from "../runtime-core/types.js"
```

其值覆盖 created、planning、running、blocked、completed、failed、cancelled。

### 后果

`HandoffPack.current_phase` 与 `PluginHookTaskPhaseChangeEvent` 按 v1.3 文本实现会引用未定义类型，无法编译。

### v1.4 修复要求

统一复用 `RuntimeTaskStatus`：

- `HandoffPack.current_phase: RuntimeTaskStatus`
- `fromStatus: RuntimeTaskStatus`
- `toStatus: RuntimeTaskStatus`

事件名保留 `task_phase_change` 作为 DCS 语义名，但字段使用现有 status 术语，避免平行状态枚举。

---

## 2. 新问题 J【致命】：同 block_id 的 append-only upsert 与 PRIMARY KEY 冲突

### 规范冲突

第五章同时要求：

1. `block_id TEXT PRIMARY KEY`
2. 发现相同 `block_id` 时先把旧行 `invalid_at=now`
3. 再写入新 Block，并称为 append-only

同一个主键不能同时保留旧行和新行。按当前 Schema 执行第二次 INSERT 必然违反唯一约束。

### v1.4 修复要求

阶段 0 保持 Schema 不增列，修正语义：

- `upsert` 对相同 `block_id` 使用 `INSERT ... ON CONFLICT DO UPDATE` 原位更新；
- entity map 在同一事务中删除后重建；
- `created_at` 保留首次创建时间；
- 需要历史版本时，写入方必须生成新的 `block_id`，并显式 `invalidate(old_block_id)`；
- 真正的 version history 不属于阶段 0。

---

## 3. 新问题 K【致命】：P0 准入所需事实不在 ContextBlock 或 upsert API 中

### 规范冲突

P0 要求 BlockStore 判断：

- working_memory 的 significance
- experience 是否 confirm_and_save、confidence
- COMPASS knowledge 的 verificationStatus、confidence、AUDN 状态
- environment 是否由文件路径 hint 触发
- notes 是否来自 context_write

但 `ContextBlock` 与 `upsert(block)` 都没有这些输入。BlockStore 无法执行规范要求的准入门槛。

### v1.4 修复要求

新增不落库的写入上下文：

```typescript
interface BlockAdmissionContext {
  significance?: 'high' | 'medium' | 'low'
  confirmed?: boolean
  confidence?: number
  verification_status?: string
  audn_state?: string
  hint_entities?: string[]
  write_origin?: 'context_write' | 'handler'
}
```

`BlockStore.upsert(block, admission?)` 返回 `{ accepted, reason? }`。不满足 P0 时静默返回 `accepted=false` 并增加 admission rejection 统计，不写数据库、不抛错。

---

## 4. 新问题 L【致命】：两值 BlockMutability 与 inherited `readonly` 不一致

### 规范冲突

阶段 0 明确要求：

```typescript
type BlockMutability = 'system_managed' | 'agent_writable'
```

但 inherited Block 表仍使用 `readonly`，v1.0 的类型也包含第三个值。

### 后果

实现若加入 `readonly` 会违反阶段 0 交付清单；不加入则 persona/knowledge/experience 表无法类型检查。

### v1.4 修复要求

统一为两值模型：

- notes → `agent_writable`
- persona、task_state、working_memory、tool_registry、knowledge、experience、environment → `system_managed`

“外部系统写入、agent 不可写”是 system-managed 的来源约束，不再作为第三种 mutability。

---

## 5. 次要一致性问题

第四章映射表仍写着“agent_end（新增到现有 hook 枚举）”。这与 v1.3 正文冲突，v1.4 必须改为“agent_end（复用现有事件）”。

---

## 6. 收敛结论

| 问题 | 严重度 | 是否阻塞阶段 0 |
|------|--------|----------------|
| I. `TaskPhase` 未定义 | 致命 | 是 |
| J. append-only upsert 与主键冲突 | 致命 | 是 |
| K. P0 准入缺少输入 | 致命 | 是 |
| L. mutability 两值/三值冲突 | 致命 | 是 |

**结论**：v1.3 未收敛。修订 v1.4 后再次审阅。
