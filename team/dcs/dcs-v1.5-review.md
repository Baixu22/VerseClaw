# DCS-v1.5 对抗审阅：存储与授权已闭合，Assembler 选择接口仍有唯一性问题

**审阅对象**：`team/dcs/dcs-v1.5-spec.md`  
**审阅日期**：2026-07-10  
**审阅基础**：完整类型导出、P0 来源门槛、容量淘汰、跨 session 授权、Assembler 阶段 0 契约  
**审阅立场**：最终一轮前消除所有会让测试与实现产生两种合法解释的接口

---

## 0. 总体判断

v1.5 已正确修复 M/N/O：

- experience confidence 可持久比较并确定性淘汰；
- ContextBlock、BlockStore query/stats API 已显式覆盖旧定义；
- compass 与 role-memory 的 knowledge 准入已区分；
- working_memory 阶段职责与 environment 容量策略已明确。

存储、准入、授权、类型和 hook 事件已可实现。但 Assembler 仍有 1 个致命接口矛盾，因此 v1.5 **未收敛**，进入允许范围内的最终版本 v1.6。

---

## 1. 新问题 P【致命】：`selectHandlers` 返回类型与 `AssemblerResult` 不一致

### 规范冲突

第一章定义：

```typescript
selected_handlers: HandlerId[]
```

第三章示例却定义：

```typescript
function selectHandlers(request: AssembleRequest): HandlerConfig[]
```

`HandlerId` 与 `HandlerConfig` 均没有完整定义。第三章还列出阶段 0 不存在的 handler 对象，而本阶段实际只要求对 compass / role-memory 两个 legacy builder 做 flag + session 门控。

### 后果

实现者可以合理选择至少三种不兼容 API：

1. 返回字符串 ID；
2. 返回 `{ handler, enabled }` 配置；
3. 返回实际 handler 函数。

这使“selected_handlers”测试与生产接口无法唯一确定。

### v1.6 修复要求

阶段 0 收窄为唯一契约：

```typescript
type LegacyHandlerId = 'compass' | 'role_memory'

function selectHandlers(request: AssembleRequest): LegacyHandlerId[]
```

- main 返回 `['compass']`；
- explicit subagent 返回 `['role_memory']`；
- ACP/Cron/channel 返回 `[]`；
- `hint_entities` 与 `role_name` 在阶段 0 不增加 handler；
- Assembler 再用 feature flag 与对应输入决定是否真正调用 builder；
- `selected_handlers` 返回通过 session 分类且 flag 开启的实际调用候选，而不是未来 handler 列表。

---

## 2. 全规范复核

| 检查项 | 结果 |
|--------|------|
| Block 类型与 Schema 可映射 | 通过 |
| P0 对 8 种 BlockType 可表达 | 通过 |
| experience/environment 容量可执行 | 通过 |
| entity map 与 same-ID upsert 事务 | 通过 |
| query/queryByEntity 无全表扫描要求 | 通过 |
| child → direct parent 授权 | 通过 |
| RuntimeTaskStatus 与 hook 事件 | 通过 |
| `agent_end` 复用 | 通过 |
| feature flag 默认 false / identity | 通过 |
| ANTI-1~10 正文对应 | 通过 |
| Assembler handler 选择类型唯一 | 未通过，P 阻塞 |

---

## 3. 收敛结论

| 问题 | 严重度 | 是否阻塞阶段 0 |
|------|--------|----------------|
| P. Assembler handler 选择 API 不唯一 | 致命 | 是 |

**结论**：v1.5 未收敛。按上述唯一修复修订 v1.6，并对 v1.6 做最终审阅。
