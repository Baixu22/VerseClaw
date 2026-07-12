# DCS-v1.2 对抗审阅：五项修订完成，但仍有 3 个实现阻塞问题

**审阅对象**：`team/dcs/dcs-v1.2-spec.md`  
**审阅日期**：2026-07-10  
**审阅基础**：`session-key-utils.ts`、`session-delivery.ts`、`plugins/hook-types.ts`、`plugins/hooks.ts`、`agents/harness/lifecycle-hook-helpers.ts`、`buildPreReplyInjection` 与 `buildContextPack` 的真实签名  
**审阅立场**：以当前代码为准，检查五项修订、跨 session 权限、谓词覆盖、compression_depth 与阶段 0 可实现性

---

## 0. 总体判断

v1.2 已正确修复上一轮 A-E 五个问题，但**尚未收敛**。本轮发现 3 个会阻塞阶段 0 编译或导致实现语义不确定的问题，其中 3 个均按致命处理。

结论：进入 v1.3 修订，不开始阶段 0 实现。

---

## 1. 上轮五项问题复核

| 问题 | 结果 | 证据 |
|------|------|------|
| A. HandoffPack 走 extra 字符串 | 已修复 | HandoffPack 写入 child session 的 task_state Block；`extraSystemPrompt` 只保留读取提示 |
| B. session_id 使用脆弱正则 | 方向正确但不可编译 | v1.2 已删除正则，但引用了当前代码不存在的 `isMainSessionKey` |
| C. SSP compression_depth 错误 | 已修复 | task_state 明确为 `compression_depth = 0`，属于结构化提取 |
| D. contextBlockSink 异步时机 | 已修复 | 同步当前周期写入；异步完成后下一次 pre_llm_call 可见且不阻塞 |
| E. notes 写入后不可见 | 已修复 | working_memory 追加 `[note] agent wrote: {first 50 chars}` |

跨 session 权限也已明确：child 只能根据自己的 HandoffPack 读取直接 parent session，三方 session_id 校验失败时返回空结果。

---

## 2. 新问题 F【致命】：`isMainSessionKey` 在共享谓词模块中不存在

### 代码事实

`openclaw_runtime/src/sessions/session-key-utils.ts` 当前导出：

- `parseAgentSessionKey`
- `isSubagentSessionKey`
- `isAcpSessionKey`
- `isCronRunSessionKey`
- `isCronSessionKey`

但不导出 `isMainSessionKey`。仓库中唯一同名实现是
`auto-reply/reply/session-delivery.ts` 的文件内私有函数，不能被 Assembler 导入。

此外，`isSubagentSessionKey` 只识别 `subagent:` 前缀，不会把 ACP、Cron run 或 channel peer 当作 subagent。v1.1 review 中“所有多段 key 都应进入 role-memory-handler”的推理没有代码依据。

### 后果

- v1.2 给出的 import 无法编译。
- 若为了“覆盖多段 key”把所有非 main session 都当作 subagent，会把 ACP、Cron 与 channel peer 错误路由到 role memory。

### v1.3 修复要求

1. 在 `session-key-utils.ts` 新增并导出 `isMainSessionKey(sessionKey: string | undefined | null): boolean`，语义与 `session-delivery.ts` 的现有私有实现一致。
2. `selectHandlers` 只使用共享谓词：
   - `isMainSessionKey` → compass
   - `isSubagentSessionKey` → role memory
   - ACP、Cron run、channel peer 默认两者都不启用，后续必须有独立规范才可扩展。
3. 阶段 0 增加谓词覆盖测试，至少覆盖 main、explicit subagent、ACP、Cron run、channel peer。

---

## 3. 新问题 G【致命】：`agent_end` 已存在，不能“新增事件类型和触发点”

### 代码事实

`agent_end` 已经存在于：

- `PluginHookName`
- `PLUGIN_HOOK_NAMES`
- `PluginHookAgentEndEvent`
- `PluginHookHandlerMap`
- `plugins/hooks.ts#runAgentEnd`
- `agents/harness/lifecycle-hook-helpers.ts`
- `agents/harness/agent-end-side-effects.ts`

当前 harness 已在完成路径调用 agent_end side effects。重复新增会产生第二套同名事件或重复触发。

### 后果

- v1.2 的“新增 `agent_end` enum + 触发点”与现有代码冲突。
- 若重复触发，SEKB trajectory capture 等副作用可能执行两次。

### v1.3 修复要求

1. `agent_end` 改为“复用并验证现有事件与触发点”，阶段 0 不新增、不重复触发。
2. 只新增 `task_phase_change` 事件类型及 hook runner 分发函数。
3. 阶段 0 的 `task_phase_change` 仅建立类型与调度接口；真实 TaskLoop phase producer 在阶段 2 接入，避免伪造当前不存在的 phase transition。

---

## 4. 新问题 H【致命】：Assembler pass-through 缺少 legacy builder 必需输入

### 代码事实

v1.2 的 `AssembleRequest` 只有：

```typescript
interface AssembleRequest {
  session_id: string
  hint_entities?: string[]
  role_name?: string
}
```

但两个现有 builder 的最小输入不同：

- `buildPreReplyInjection` 至少需要 `sessionKey`、`userInputText`
- `buildContextPack` 接收 `ContextPackInput`，实际有用输出依赖 memories/taskState/openConflicts 等输入

### 后果

仅凭 `AssembleRequest` 无法忠实调用两条 legacy 路径，也无法证明 feature flag 全 false 时“行为与现有代码完全一致”。

### v1.3 修复要求

1. 保持 `AssembleRequest` 三个路由字段不变。
2. 为 `Assembler.assemble()` 增加独立的 `AssemblerLegacyInputs`：
   - `existing_output`：调用方当前已经生成的 legacy 输出，flags 全 false 时原样返回
   - `compass`：`buildPreReplyInjection` 所需参数（`sessionKey` 由 request 注入）
   - `role_memory`：`ContextPackInput`
3. 通过可注入 builder 依赖做测试，但默认依赖必须直接指向现有 `buildPreReplyInjection` / `buildContextPack`。
4. 所有 `runtime.contextBlock.{source_system}.enabled` 默认 false；全 false 时不得调用任何 builder，必须原样返回 `existing_output`。

---

## 5. 一致性检查

### MUST / MUST NOT

五项 v1.2 修订均有可验证条件。新发现的 F/G/H 会使部分 MUST 无法编译或无法证明，因此阻塞收敛。

### ANTI-1~10

ANTI-1、ANTI-3、ANTI-9、ANTI-10 均有正文对应。ANTI-3 的实现引用当前不存在的谓词，需在 v1.3 修正。

### compression_depth

SSP/task_state 在第二章与第三章均应固定为 0；v1.2 的新条款一致，没有发现新的 compression_depth 冲突。

### 跨 session 权限

child → direct parent 的授权边界明确，没有发现任意 session 读取或递归祖先读取漏洞。

---

## 6. 收敛结论

| 问题 | 严重度 | 是否阻塞阶段 0 |
|------|--------|----------------|
| F. `isMainSessionKey` 不存在且 session 分类需收窄 | 致命 | 是 |
| G. `agent_end` 已存在，重复新增会重复副作用 | 致命 | 是 |
| H. Assembler 缺少 legacy 输入与零回归契约 | 致命 | 是 |

**结论**：v1.2 未收敛。按本审阅修订 v1.3，并再次进行对抗审阅。
