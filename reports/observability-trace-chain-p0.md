# Observability Trace 链路 — P0 接通报告

> **写于**: 2026-06-13
> **作者**: 主会话 agent
> **范围**: P0「接通链路」—— 让 Observability dashboard 显示真实 trace
> **工作目录**: `C:\Users\27933\Desktop\clawx\ClawX`

---

## 0. TL;DR

Observability + role-first 是一套**全新、未被 git 跟踪**的脚手架。原以为要从 runtime 侧实例化 recorder 并新增 broadcast，核实后发现：

1. runtime 侧的 `ObservabilityTraceRecorder` / `role-first-observer` / 编排层（orchestrator/role-router/context-pack/gatekeeper）**没有任何 run 路径调用**，是孤立脚手架。
2. 一个并发 agent 其实已按**更优路线**搭好链路 95%：在 **Electron 侧**把 openclaw 已有的 `agent` → `chat:runtime-event` 事件流翻译成 trace（`observability-adapter.ts`）。这条路 **零改 openclaw 上游**、复用现有 notification。
3. 它被留成**编译不过的半成品**。本轮把断口接好 + 断了一个循环依赖，链路打通并验证。

---

## 1. 最终链路

```
openclaw gateway ──agent 事件──▶ manager / event-dispatch ──chat:runtime-event──▶
index.ts (订阅) ──▶ observability-adapter ──▶ observability-service (Map<id,Trace>) ──▶
dashboardSnapshot ──▶ observability store ──▶ Observability 页面
```

- **数据源**：openclaw 在每个 chat turn 广播 `agent` 事件，`electron/gateway/chat-runtime-events.ts` 已把它规范化成丰富的 `ChatRuntimeEvent`（`run.started/ended`、`tool.started/updated/completed`、`assistant/thinking.delta`、`command.output`、`patch.completed`、`approval.updated`）。
- **翻译器**：`electron/services/observability-adapter.ts` 的 `applyChatRuntimeEvent` 把事件 reduce 成 `ObservabilityTrace`（run → trace，tool → span）。
- **存储**：`electron/services/observability-service.ts` 用 `Map<traceId, ObservabilityTrace>`，`upsertObservabilityTrace` 写入，淘汰时保护 `running` trace。
- **暴露**：`observability-api.ts` 的 `dashboardSnapshot/traces/clearTraces` host API。

---

## 2. 本轮改动

| 改动 | 文件 | 说明 |
|---|---|---|
| **补 import** | `electron/main/index.ts` | `index.ts` 调用 `applyChatRuntimeEvent` 但没 import → `Cannot find name`。**链路断的唯一原因。** 在 `../services/observability-adapter` 处补上 import。 |
| **断循环依赖** | `electron/services/observability-api.ts`、`observability-service.ts` | service ↔ adapter 互相 import（service 调 `resetObservabilityAdapter`）。把"clear 时重置 adapter"上移到 API 层 `clearTraces`，删掉 `service → adapter` 反向边。该环在独立 ESM 加载下已报错，是真实潜在脆弱点。 |

---

## 3. 验证

- `pnpm run typecheck:node` → **exit 0**（断口修复 + 断环后无类型错误）。
- **功能验证**（临时脚本，已清理）：模拟真实 `chat:runtime-event` 序列 `run.started → tool.started → tool.completed(含 isError) → run.ended`，喂进 `applyChatRuntimeEvent`，11 项断言全过：
  - 1 条 trace、id = `trace_<runId>`、status=completed、durationMs=1000
  - 2 个 span，span1 completed/500ms，span2 error
  - snapshot 卡片 Traces=1 / Errors=1，行 spanCount=2 / errorCount=1，alert 含 "span error"
- **未做**：完整 Electron app + 真实 chat turn 的端到端冒烟（需启动 app + 模型 key）。被修复的半条链路已用模拟序列单测覆盖，全链路 typecheck 通过。

---

## 4. P0 已知限制（符合预期，非 bug）

- **token/cost 卡片恒为 0**：`agent` 事件流不携带 token 用量。补它需要更深的 model-call hook → P1。
- **span 只有 `tool` 一种**：`orchestrator/role-router/verifier/gatekeeper` 等 span kind 对应的 role-first 编排层未运行，不会出现。
- **无实时推送**：dashboard 仍是手动 Refresh 拉取 → P1。
- **无持久化**：gateway/app 重启清空 → P2。

---

## 5. 提醒

`observability-adapter.ts` / `observability-service.ts` 为**未跟踪、且有并发 agent 在动**的文件（读取期间被改过）。若 `service → adapter` 的 import 被加回，循环依赖会复现 —— 按同样方式把协调逻辑放在 API 层即可。

---

## 6. P1 进展（2026-06-13，本轮已完成）

> 发现实时通道契约 **早已预埋**：`HostEventContract.observability.runtimeEvent`、`HOST_EVENT_CHANNELS.observability.runtimeEvent = 'observability:runtime-event'`、preload 自动放行、渲染侧 `hostEvents.onObservabilityRuntimeEvent` 均已存在。只差「主进程发送 + adapter emit + store 订阅」三处接线。

### P1-a 实时推送 ✅
- `observability-adapter.ts`：`applyChatRuntimeEvent` 现返回 `ObservabilityRuntimeEvent | null`（run.started→`trace.started`，tool.*→`trace.updated`，run.ended→`trace.completed`）。
- `electron/main/index.ts`：`chat:runtime-event` 监听里把返回事件 `sendMainWindowEvent('observability:runtime-event', evt)`。
- `src/stores/observability.ts`：`subscribeRealtime()` 订阅该通道，**150ms 防抖**静默刷新 snapshot + 已选中 trace（不闪 loading）。页面 `useEffect` 挂载订阅。

### P1-b 单 trace 下钻 ✅
- 契约新增 `observability.trace({id}) → ObservabilityTrace | null`（`shared/host-api/contract.ts`）。
- 后端 `getObservabilityTrace(id)`（service）+ `trace` 实现（api）+ `host-api.ts` 包装。`host:invoke` 通用分发，无需改 preload/handler。
- store 加 `selectedTrace / selectTrace / closeTrace`（含 stale-response 防护）。
- 新组件 `src/pages/Observability/TraceWaterfall.tsx`：span 按 `(startedAt-traceStart)/total` 定位、`durationMs/total` 定宽的横条瀑布图，按 status 着色（running 蓝色 pulse / completed 绿 / error 红 / aborted 琥珀），hover 显示 in/out/error。
- 页面表格行可点击展开/收起，选中行下方 colspan 插入瀑布图。

### 验证
- `pnpm run typecheck`（node + web）→ **exit 0**。
- 后端功能验证（临时脚本，已清理）：10 项断言全过 —— adapter 四类返回事件正确、事件携带 trace、`getObservabilityTrace` 返回完整 span、未知 id → null。
- **真实应用 CDP 实测**（2026-06-13，app 跑在 Vite dev + 重启后的主进程，端点 127.0.0.1:9222）：
  - `observability.trace(id)` host API 在线返回（`{ok:true,data:null}` for 未知 id）→ P1-b 后端在真机生效。
  - 触发两次真实 chat run，渲染进程挂的探针 **收到 `observability:runtime-event` 推送**（每次 `trace.started`+`trace.completed`）→ P1-a 主→渲染推送 E2E 生效。
  - Observability 页 DOM **自动出现 2 行真实 trace**（导航后未手动刷新）→ store `subscribeRealtime` 渲染侧闭环生效。
  - 点击 trace 行 → 内联展开行挂载 `TraceWaterfall` → P1-b 下钻 UI 路径生效。
- **未能现场展示的部分**：带多 span 的瀑布图横条。原因：配置的模型 `deepseek-v4-pro` 在该环境返回 "LLM request failed"，每次 run 在 LLM 调用即失败（0 span）；且渲染进程无法注入合成数据（`window.clawx` 是 contextBridge 只读对象）。横条渲染由 typecheck + 后端单测（tool 事件→span）+ 组件代码覆盖。
- **发现的小问题 → 已修复并真机验证**：失败的 run（trace `status='error'`）原先在 "Errors" 卡片显示 0（`buildObservabilityDashboardSnapshot` 只统计 span 级错误）。已改为统计**失败的 trace**（run 级 error/aborted 或含 error span）。真机复测：一个 0-span 的失败 run 现在 Errors 卡片正确显示 `1`（修复前为 `0`）。
- **瀑布图横条仍未现场坐实 —— 阻塞原因：缺 API key**。唯一配置的 provider 是 deepseek 且 `hasKey: false`，每次 run 在 LLM 调用即 "LLM request failed"（0 span）。按安全规则不能代填密钥。待用户在 设置→Providers 配好任一可用模型后，跑一次带工具的 run 即可看到横条（其余链路均已验证）。

---

## 7. Runtime LLM transport 修复（2026-06-13，配好 key 后定位）

用户配好 API key 后仍失败 → 定位为 **runtime 层**问题（与 P1 无关，但阻断真机验证）。真实错误从 `logs.recent` / gateway stderr 日志拿到（被 `GENERIC_ASSISTANT_ERROR_TEXT="LLM request failed."` 脱敏掩盖）。

### 已修复 ✅（两处真实 bug）
1. **dist 陈旧**：`openclaw_runtime/src/agents/openai-transport-stream.ts` 已是真实实现（`import {AzureOpenAI,OpenAI} from "openai"`），但 `dist/` 是旧的桩版本（`PRUNED_PROVIDER_ERROR="OpenAI/Azure OpenAI transport is not available in the ClawX pruned source runtime"`）。gateway 跑 dist → 抛桩错误。修复：`pnpm run build:runtime` 重建（`openai@6.39.1` 已在 runtime node_modules，作 external 保留）。错误随之变为下一个真实 bug。
2. **漏 `await`**：`openai-transport-stream.ts` 三处 `client.chat.completions.create({stream:true})` / `client.responses.create(...)` 未 `await` 就 `for await` 迭代 → `chatStream is not async iterable`（APIPromise 非 async-iterable，须先 await 得到 Stream）。修复：第 761/373/1160 行补 `await`。
   - 真机验证：run 从「<600ms 秒错」变为「真正打开流、装配工具、status=running」——transport 连接已通。

### 已解决 ✅ — 流式完成挂起（SSRF pinned-DNS）+ 工具参数为空
await 修复后流打开却**拿到 ~4 个 SSE event 就 stall**。通过埋点 + 独立复现逐层 bisect 定位并修复：

| 验证 | 结果 |
|---|---|
| 直连端点（plain `fetch` 读到底） | **39 chunk / 2.2s / [DONE]** ✓ 端点完全正常，`deepseek-v4-pro` 有效 |
| 埋点 A→F | fetch 200、create resolve、首 chunk 到 → **F 停在 ~4 后静默数分钟** |
| 独立 `Agent({allowH2:false,bodyTimeout})` / ReadableStream body+duplex | 正常完成 ✓ |
| sanitizer 旁路 / `buildManagedResponse` pump | 仍 stall / 逻辑正确 → 均排除 |

**3. SSRF pinned-DNS 流式 stall** — stall 唯一剩下的差别是 `fetchWithSsrFGuard` → `createPinnedDispatcher`（带自定义 `connect.lookup` 的 pinned dispatcher），而 plain Agent 能正常流式。**修复**：model transport 的 guarded fetch 传 `pinDns: false`（`provider-transport-fetch.ts` 的 `guardedFetchOptions`）——`fetchWithSsrFGuard` 仍执行 resolve 时的主机/IP SSRF 策略校验，只改用 `createPolicyDispatcherWithoutPinnedDns`（非 pinned）。仅作用于 model 请求，不影响 web-tool fetch。
- 真机验证：run 从「stall」变为「**真实流式 + 工具被调用**」（出现 tool span）。

**4. 工具参数为空 `{}`**（`Validation failed for tool "exec": must have required properties command`）— tool-call 增量累积的 key 不匹配：GET 用字符串 `tool_${choiceIndex}_${toolIndex}`、SET 用数字 `toolIndex`，`Map<number,number>` 永远查不到 → 每个 arg delta 新建一个 block，参数被打散成空。**修复**：GET/SET 统一用 `toolCallIndexes.get(toolIndex)`（`openai-transport-stream.ts`）。
- 真机验证：同一 prompt 从「9 个 error span（参数空）」变为「**2 个 `exec` span，status=completed，846ms/326ms，0 error**」。

### 端到端真机验证（全链路真实数据）✅
真实模型 run → 流式（pinDns 修复）→ 正确参数调用 `exec`（tool-args 修复）→ 工具成功执行 → observability 链路捕获 → 实时推送 → **Observability 页瀑布图渲染 2 条绿色（completed）span 横条**（按 startedAt/duration 定位，DOM 实测 `barCount=2` / `bg-emerald-500`）。"真实链路监控"在真机端到端打通。

> 本轮 runtime 修复（全部保留、typecheck 通过、埋点/实验已清理）：① dist 重建 ② 三处 `await` ③ `pinDns:false` ④ tool-call key 对齐。这是 OpenClaw 上游剪枝运行时遗留的 4 个真实 bug，至此 ClawX 内核的 OpenAI 兼容流式 transport 可用、可定制。

### 备注（非阻塞）
- xhigh 推理下，工具 run 的最终回合较慢，trace 会在模型完成总结前停留 `running` 较久（模型行为，非 bug）。
- token/cost 仍为 0：`agent` 事件流不带 token 用量（P0 已知限制），与本轮无关。

---

## 8. 仍待办（P1-c / P2）

- **P1-c scorecard**：snapshot 仍返回 `scorecards: []`，需真正计算（runtime 侧已有 `buildTraceScorecard`，但 electron 侧无 token 数据，scorecard 价值有限，待定）。
- **P2**：token/cost（需更深的 model-call hook，事件流不带 token）、持久化（JSONL）、采样/背压、类型单一来源（删 runtime/shared 重复的 `observability.ts`）。
