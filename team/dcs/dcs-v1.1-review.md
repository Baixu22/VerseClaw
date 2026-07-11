# DCS-v1.1 二次审阅：修订引入的 3 个新问题

**审阅对象**：DCS-v1.1 修订版（`team/dcs/dcs-v1.1-spec.md`）
**审阅日期**：2026-07-10
**审阅基础**：代码事实审计（session-key-utils.ts / role-spawn.ts / memory-session-state.ts / task-loop-context.ts）
**审阅立场**：对抗性思维，重点检查 v1.1 修订是否引入新问题

---

## 0. 总体判断

v1.1 修订整体到位，接受全部 10 条意见的方向正确。但修订过程中引入了 **3 个新问题**，其中 1 个是架构倒退，1 个是事实错误导致门控失效。

---

## 1. 新问题 A【致命】：HandoffPack 通过 extra 字符串注入是架构倒退，违反 [P1]

### 问题

v1.1 为了回应"handoff 机制不存在"，把 HandoffPack 改为通过 `spawnRoleSubagent` 的 `extra` 参数以 JSON 字符串注入：

```typescript
extra: `${existingExtra}\n\n## Handoff Context\n${JSON.stringify(handoffPack)}`
```

**代码事实**：`extraSystemPrompt` 在 `buildRoleSystemPrompt` 中是**直接以原始文本拼接到 system prompt 字符串末尾**（`role-spawn.ts:119-162`，`parts.push(trimmedExtra)` → `parts.join("\n")`）。

**这意味着 HandoffPack 是直接构造 prompt string 并注入**——这正是 [ANTI-1] 禁止的行为，也是 [P1] Block 原子性要消除的路径。v1.0 的原始方案"写入 BlockStore，session_id 指向新 session"才是正确的 Block 路径。v1.1 为了解决"机制不存在"而放弃了"架构正确"，这是过度修正。

### 修复建议

既复用现有 spawn 机制，又不违反 [P1]：

1. 父 session 在 spawn 前，把 HandoffPack 作为 `task_state` Block 写入 BlockStore，`session_id` 设为新 session 的 key
2. `spawnRoleSubagent` 的 `extraSystemPrompt` 只传递一个轻量提示：`## Handoff Available\nUse context_read('task_state') to load parent session state.`
3. 新 session 的 `before_agent_start` hook 从 BlockStore 查询 `session_id = 自己的 key` 的 Block，恢复 task_state
4. `extraSystemPrompt` 不承载结构化数据，只承载提示文本

这样 `spawnRoleSubagent` 的签名不变，`extra` 仍然是 string，但传递的是提示而非数据本身。

---

## 2. 新问题 B【致命】：session_id 正则与实际格式严重不匹配

### 问题

v1.1 的 `selectHandlers` 依赖两个正则判断 session 类型：

```typescript
const isMainSession = /^(agent|cron):[^:]+:main$/.test(request.session_id)
const isSubagent = /^agent:[^:]+:(?!main)[^:]+$/.test(request.session_id)
```

**代码事实**（来自 `session-key-utils.ts` 和实际生成逻辑）：

| session 类型 | 实际格式 | isMainSession 匹配 | isSubagent 匹配 |
|-------------|---------|-------------------|----------------|
| 主会话 | `agent:<id>:main` | ✅ | ✗ |
| ACP 子代理 | `agent:<id>:acp:<uuid>` | ✗ | **✗**（多段，`[^:]+` 不匹配 `acp:<uuid>`） |
| Cron run | `agent:<id>:cron:<job>:run:<run>` | ✗ | **✗**（多段） |
| Cron base | `cron:<jobId>` | ✗ | ✗ |
| Channel peer | `agent:<id>:<channel>:<peerKind>:<peerId>` | ✗ | **✗**（多段） |

**两个正则会漏掉所有多段 session key**。ACP 子代理、Cron run、Channel peer 都不会被识别为 subagent，导致 `roleMemoryHandler` 不激活、`compassHandler` 可能错误激活。

**现有代码的判断方式**：`session-key-utils.ts:254-301` 有现成的 `isSubagentSessionKey` / `isAcpSessionKey` / `isCronRunSessionKey` 谓词，按 rest 前缀（`subagent:` / `acp:` / `cron:...:run:...`）判断。

### 修复建议

废弃正则，直接复用现有谓词：

```typescript
import { isSubagentSessionKey, isMainSessionKey } from "../sessions/session-key-utils.js"

function selectHandlers(request: AssembleRequest): HandlerConfig[] {
  const isMain = isMainSessionKey(request.session_id)
  const isSub = isSubagentSessionKey(request.session_id)
  // ...
}
```

---

## 3. 新问题 C【中等】：SSP 不包含 evidence_summary，[P4] 的 compression_depth 推理基于错误假设

### 问题

v1.1 的 [P4] 修订说：

> SSP → task_state Block summary（由 SSP 直接渲染）✓，compression_depth = 1

但代码事实是：

1. **SSP 不包含 evidence_summary**——SSP 的 schema 是 `{activeGoals, resolvedConstraints, openQuestions, decisionHistory, driftSignal}`，没有 evidence 字段
2. **SSP 与 evidenceText 是完全独立的数据源**——SSP 来自 `extractIntent(userInput)`（用户输入的正则提取），evidenceText 来自 `formatEvidence(evidenceRefs, subagentEvidence)`（调用方传入的数组）
3. **buildTaskLoopContextPack 不消费 SSP**——两者在 `task-loop-context.ts` 中无导入关系

所以 v1.1 说的"SSP → task_state Block summary（1次压缩）✓"是基于错误前提的推理。task_state Block 的 summary 实际来自两个独立数据源：
- SSP（goals/constraints/questions）——这是结构化提取（正则提取），不是摘要压缩
- evidenceText——这是格式化（数组 → 文本），不是摘要压缩

两者都是 `compression_depth = 0`（结构化提取/格式化），不是 1。

### 修复建议

- task_state Block 的 `compression_depth = 0`（SSP 是正则提取 + evidenceText 是格式化，都不是摘要压缩）
- [P4] 的示例需要修正：删除"SSP → task_state Block summary（1次压缩）"的错误示例，改为"SSP → task_state Block summary（0次压缩，结构化提取）"

---

## 4. 次要问题补充

### D【次要】：contextBlockSink 的异步收集时机未定义

规范说"lifecycle.ts 在 hook 调度完成后统一收集并写入 BlockStore"，但 SEKB 的 experience Block 允许异步产出。需要明确：

- 同步 hook 的 Block：在当前 hook 调度周期内收集并写入，下一次 `pre_llm_call` 可见
- 异步 hook 的 Block：写入后在下一次 `pre_llm_call` 可见，不阻塞当前 LLM call

### E【次要】：notes Block 写入后不可见

notes Block 是 `always_on=false` + `on_demand`，agent 写入后需要主动 `context_read('notes')` 才能看到。但 agent 不会主动读一个它不知道存在的东西。

建议：notes Block 写入时，在 working_memory Block 的滚动窗口追加一条 `[note] agent wrote: {first 50 chars}`，让 agent 知道 notes 存在。

---

## 5. 总结

| 新问题 | 严重度 | 根因 |
|--------|--------|------|
| A. HandoffPack 通过 extra 注入违反 [P1] | 致命 | 过度修正，放弃了 Block 路径 |
| B. session_id 正则不匹配实际格式 | 致命 | 假设了不存在的格式，漏掉所有多段 key |
| C. SSP 不含 evidence_summary，[P4] 推理错误 | 中等 | 基于错误假设定义 compression_depth |
| D. contextBlockSink 异步时机未定义 | 次要 | 缺少异步语义说明 |
| E. notes Block 写入后不可见 | 次要 | 缺少通知机制 |

**建议**：在开始阶段 0 之前，修订 A 和 B（两个致命问题）。A 的修复方案是把 HandoffPack 走 BlockStore 而非 extra 字符串；B 的修复方案是复用现有 `session-key-utils.ts` 的谓词而非正则。
