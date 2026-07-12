# DCS-v1.4 对抗审阅：写入语义已闭合，保留策略与公开 API 仍有阻塞

**审阅对象**：`team/dcs/dcs-v1.4-spec.md`  
**审阅日期**：2026-07-10  
**审阅基础**：阶段 0 交付清单、P0 准入与容量规则、SQLite Schema、继承自 v1.0 的类型/API 定义  
**审阅立场**：规范必须让实现与测试得到唯一、可编译、可持久化的契约

---

## 0. 总体判断

v1.4 已正确修复 I/J/K/L：

- HandoffPack 与 hook 事件统一复用 `RuntimeTaskStatus`；
- 同 ID 使用原位 upsert，历史版本使用新 ID + invalidate；
- `BlockAdmissionContext` 使 P0 判断事实可以传入；
- mutability 统一为两值模型。

但进一步按 P0 容量规则和最终交付接口反推，仍发现 3 个实现阻塞问题。v1.4 **未收敛**，进入 v1.5 修订。

---

## 1. 新问题 M【致命】：experience 最低 confidence 淘汰无法跨写入执行

### 规范冲突

P0 要求单 session 的 experience Block 最多 3 个，超限时淘汰 confidence 最低者；同时 v1.4 将 `BlockAdmissionContext.confidence` 定义为完全不落库的瞬时事实。

BlockStore 在第 4 次及以后写入时只能看到当前候选的 confidence，无法得知数据库中已有 3 个 Block 的 confidence，因此不能确定最低项。

### 代码事实

SEKB 的 `DistillationSuggestion` 有 confidence，确认保存后只把该值写入 principle metadata；ContextBlock 的 `summary`/`full_content` 没有稳定、强制的 confidence 格式。依赖解析自由内容不构成存储契约。

### v1.5 修复要求

- 在 `context_blocks` 增加内部治理列 `retention_confidence REAL`；
- experience 写入要求 `admission.confirmed=true` 且提供有限数值 confidence；
- upsert 将 experience 的 confidence 写入该列；
- 同一事务内按 `retention_confidence ASC, valid_at ASC, block_id ASC` 淘汰到最多 3 个；
- 其他 P0 判断事实仍保持瞬时，不扩散到 ContextBlock 公共接口。

---

## 2. 新问题 N【致命】：阶段 0 公共类型与查询 API 仍由冲突的 v1.0 名称隐式继承

### 规范冲突

最终交付明确要求：

- `BlockPresence`；
- `BlockMutability`；
- 带 `session_id`、`compression_depth`、`entity_extraction_status`、`fallback_mode` 的 `ContextBlock`；
- `queryByEntity`；
- 带 requester/target 语义的跨 session 查询。

但 v1.4 第一章只展示变化部分，继承的 v1.0 仍使用 `PresenceConfig`、`Mutability`，其 `ContextBlock` 缺少上述字段；v1.0 的 BlockStore 接口也没有 `queryByEntity`，`BlockQuery` 没有 requester/target 字段。

### 后果

实现者无法仅依据最终规范确定导出名、方法签名与授权参数。跨 session 权限虽有规则，但没有可调用 API 表达 requester 与 target。

### v1.5 修复要求

最终规范直接给出完整、覆盖旧定义的阶段 0 类型：

- `BlockType`、`SourceSystem`、`BlockPresence`、`BlockMutability`、`ContextBlock`；
- `BlockQuery`、`BlockEntityQuery`、`BlockStoreStats`；
- `query(params)` 与 `queryByEntity(params)` 都要求 `requester_session_id`，可选 `session_id` 表示目标，默认目标为 requester；
- `stats(source_system?)` 明确返回 entity 状态、准入拒绝和授权拒绝计数。

---

## 3. 新问题 O【致命】：knowledge 准入与阶段职责边界会误拒 role-memory

### 规范冲突

P0 当前把 knowledge Block 的验证状态、confidence、AUDN 条件写成整个 BlockType 的准入要求。但 knowledge 有两条来源：

- COMPASS TemporalFact；
- role-memory 的 `buildContextPack`。

role-memory 不具备 COMPASS 的 verification/AUDN 字段。若 BlockStore 对所有 knowledge Block 执行同一检查，合法 role-memory Block 会被拒绝。

此外，working_memory 的 5 条滚动窗口属于阶段 1 Handler 内部内容管理，不应被阶段 0 BlockStore 误实现为“最多 5 个 working_memory Block”。

### v1.5 修复要求

- knowledge 的 verification/confidence/AUDN 门槛仅适用于 `source_system='compass'`；
- `source_system='role-memory'` 的 knowledge Block 不要求 COMPASS 专属字段；
- working_memory 在 BlockStore 只执行 significance 准入，5 条滚动窗口和 high/medium 淘汰留给阶段 1 Handler；
- environment 超过 2 个时按 `valid_at ASC, block_id ASC` 淘汰最旧项，保证确定性。

---

## 4. 一致性检查

| 检查项 | 结果 |
|--------|------|
| I/J/K/L 修复 | 通过 |
| session 谓词覆盖 main/subagent/ACP/Cron/channel | 通过 |
| 直接 parent 授权规则 | 规则正确，API 待 v1.5 显式化 |
| compression_depth | 通过 |
| ANTI-1~10 正文对应 | 通过 |
| `agent_end` 复用 | 通过 |
| Assembler 全关闭 identity | 通过 |
| P0 可持久执行 | 未通过，M/O 阻塞 |
| 阶段 0 类型/API 唯一性 | 未通过，N 阻塞 |

---

## 5. 收敛结论

| 问题 | 严重度 | 是否阻塞阶段 0 |
|------|--------|----------------|
| M. experience confidence 不可持久比较 | 致命 | 是 |
| N. 公共类型与查询 API 不唯一 | 致命 | 是 |
| O. knowledge 准入来源未区分 | 致命 | 是 |

**结论**：v1.4 未收敛。按上述要求修订 v1.5 后再次审阅。
