# ClawX Observability Trace 链路 — 完整实现报告

> **日期**: 2026-06-13
> **范围**: 全链路功能总结 + 架构设计文档
> **工作目录**: `C:\Users\27933\Desktop\clawx\ClawX`

---

## 0. 功能概览

Observability 模块为 ClawX 提供了**全链路 agent 运行时追踪**能力，覆盖：

| 能力 | 状态 |
|------|------|
| Trace 采集（run → trace, tool → span） | ✅ |
| 实时推送（主进程 → 渲染进程，150ms 防抖） | ✅ |
| Dashboard 面板（Traces / Avg Duration / Errors / Tokens / Cost） | ✅ |
| Trace 表格（点击展开瀑布图） | ✅ |
| Token 计数（hybrid: 上游内联 + JSONL 后置补全） | ✅ |
| Cost 估算（从 transcript 推导） | ✅ |
| Scorecard 评分 | ⬜ 结构已预留，尚未接入计算 |
| 持久化（JSONL 落盘） | ⬜ P2 |

---

## 1. 数据流架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  openclaw runtime (gateway utilityProcess)                          │
│                                                                     │
│  embedded-agent-subscribe.handlers.lifecycle.ts                     │
│    └─ emitAgentEvent({ stream:"lifecycle", data:{                   │
│         phase:"end"/"error", endedAt, tokenUsage:{input,output,...} │
│       }})                                                           │
│                                                                     │
│  embedded-agent-subscribe.handlers.messages.ts                      │
│    └─ emitAgentEvent({ stream:"tool", data:{phase, toolCallId,...}})│
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket / JSON-RPC notification
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  electron/gateway/event-dispatch.ts                                 │
│    dispatchProtocolEvent / dispatchJsonRpcNotification               │
│    └─ normalizeGatewayChatRuntimeEvent(payload)                     │
│         → ChatRuntimeEvent (typed union)                            │
│    └─ emit('chat:runtime-event', normalizedEvent)                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  electron/main/index.ts (主进程 handler)                            │
│                                                                     │
│  gatewayManager.on('chat:runtime-event', (data) => {                │
│    // 同步路径                                                       │
│    observabilityEvent = applyChatRuntimeEvent(data)                  │
│    sendMainWindowEvent('chat:runtime-event', data)                   │
│    sendMainWindowEvent('observability:runtime-event', evt)           │
│                                                                     │
│    // 异步 token 补全 (Phase A)                                      │
│    if (data.type === 'run.ended')                                   │
│      enrichTraceTokenUsage(data) → sendMainWindowEvent(...)         │
│  })                                                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │ IPC (contextBridge)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/stores/observability.ts (Zustand store)                        │
│    subscribeRealtime() → hostEvents.onObservabilityRuntimeEvent     │
│    150ms debounce → fetchDashboard({silent}) + refresh selectedTrace│
│                                                                     │
│  src/pages/Observability/index.tsx                                  │
│    Dashboard: metric cards + alerts + scorecards + trace table       │
│                                                                     │
│  src/pages/Observability/TraceWaterfall.tsx                          │
│    Span 瀑布图：按 startedAt/duration 定位横条                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块职责

### 2.1 Gateway Normalizer
`electron/gateway/chat-runtime-events.ts`

将 openclaw 的原始 `agent` 事件（untyped `Record<string,unknown>`）规范化为强类型 `ChatRuntimeEvent` union。负责：
- `stream:"lifecycle"` → `run.started` / `run.ended`
- `stream:"tool"` → `tool.started` / `tool.updated` / `tool.completed`
- `stream:"assistant"` → `assistant.delta`
- `stream:"thinking"` → `thinking.delta`
- 提取 `tokenUsage` 从 lifecycle end data（Phase B）

### 2.2 Observability Adapter
`electron/services/observability-adapter.ts`

**翻译层**：将 `ChatRuntimeEvent` reduce 成 `ObservabilityTrace`。

| 事件 | 动作 |
|------|------|
| `run.started` | 创建 trace（status=running），写入 store |
| `tool.started` | 创建 span（kind=tool），追加到 trace.spans |
| `tool.completed` | 关闭 span（status/endedAt/durationMs/error） |
| `run.ended` | 关闭 trace，内联 tokenUsage（Phase B），force-close 残留 span |

附加能力：
- `enrichTraceTokenUsage(event)` — 异步 JSONL 补全（Phase A fallback）
- `resetObservabilityAdapter()` — 清除内部状态（配合 clearTraces）

### 2.3 Observability Service
`electron/services/observability-service.ts`

**存储层**：纯内存 `Map<string, ObservabilityTrace>`，上限 200 条。

- `upsertObservabilityTrace(trace)` — 写入/替换，LRU 淘汰（保护 running）
- `getObservabilityTrace(id)` — 单条查询
- `getObservabilityTraceBuffer()` — 全量排序返回
- `buildObservabilityDashboardSnapshot()` — 聚合卡片/alerts/trace 行

### 2.4 Observability API
`electron/services/observability-api.ts`

Host API 暴露给渲染进程：

| 方法 | 返回 |
|------|------|
| `dashboardSnapshot()` | 完整 Dashboard 快照 |
| `traces()` | 全量 Trace 数组 |
| `trace({ id })` | 单条 Trace（含 spans） |
| `clearTraces()` | 清空 + 重置 adapter |

### 2.5 渲染侧
- **Store** (`src/stores/observability.ts`)：Zustand，管理 snapshot/loading/selectedTrace，`subscribeRealtime` 订阅 IPC 推送
- **Dashboard** (`src/pages/Observability/index.tsx`)：5 张 metric card + alerts + scorecards + trace 表格
- **Waterfall** (`src/pages/Observability/TraceWaterfall.tsx`)：每个 span 一行横条，按时间偏移定位

---

## 3. Token 计数设计（Hybrid）

### 问题
openclaw 的 `agent` 事件流历史上不携带 token 用量，但 transcript JSONL 在每个 model turn 后写入完整 `usage` 对象。

### 方案：双路径互补

```
Phase B (同步，零延迟)           Phase A (异步，~100ms 延迟)
─────────────────────          ─────────────────────────────
runtime getUsageTotals()        transcript JSONL on disk
    ↓                               ↓
lifecycle event .data.tokenUsage    getSessionTokenUsageSummary(sessionKey)
    ↓                               ↓
normalizer 提取                 mapSummaryToTokenUsage()
    ↓                               ↓
adapter run.ended 写入 trace     enrichTraceTokenUsage() patch trace
    ↓                               ↓
trace.tokenUsage.totalTokens>0  trace.tokenUsage.costUsd filled
```

**共存逻辑**：
- Phase B 同步填充 `totalTokens`（`costUsd=0`，runtime 不追踪 cost）
- Phase A 异步检查：若 `totalTokens > 0 && costUsd > 0` → 跳过；否则读 JSONL 补全
- 若 Phase B 数据缺失（旧 runtime），Phase A 完整补全

**结果**：tokens 立即可见，cost 约 100ms 后补上。

---

## 4. 类型系统

### ObservabilityTrace
```typescript
{
  id: string;              // "trace_{runId}"
  name: string;            // "{sessionKey} · {runId:8}" 或 "run {runId:12}"
  runId?: string;
  sessionKey?: string;
  status: 'running' | 'completed' | 'error' | 'aborted';
  startedAt: number;       // epoch ms
  endedAt?: number;
  durationMs?: number;
  spans: ObservabilitySpan[];
  events: ObservabilityTraceEvent[];
  tokenUsage: ObservabilityTokenUsage;
  metrics: Record<string, number>;
  tags: string[];
  error?: string;
}
```

### ObservabilitySpan
```typescript
{
  id: string;              // "span_{toolCallId}"
  traceId: string;
  parentSpanId?: string;
  name: string;            // tool name
  kind: 'orchestrator' | 'role-router' | 'team' | 'subagent'
      | 'model' | 'tool' | 'memory' | 'context-pack'
      | 'gatekeeper' | 'verifier' | 'input-mode' | 'custom';
  status: ObservabilitySpanStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  input?: string;          // truncated to 2048 chars
  output?: string;
  tokenUsage?: ObservabilityTokenUsage;
  error?: string;
}
```

### ObservabilityTokenUsage
```typescript
{
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costUsd: number;
}
```

### ChatRuntimeEvent (run.ended variant)
```typescript
{
  type: 'run.ended';
  runId: string;
  sessionKey?: string;
  status: 'completed' | 'error' | 'aborted';
  endedAt?: number;
  error?: string;
  tokenUsage?: {           // Phase B 新增
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}
```

---

## 5. 实时推送机制

```
主进程                          渲染进程
───────                        ─────────
applyChatRuntimeEvent(data)
  → ObservabilityRuntimeEvent
  → sendMainWindowEvent('observability:runtime-event', evt)
                                hostEvents.onObservabilityRuntimeEvent(cb)
                                  → 150ms setTimeout debounce
                                  → fetchDashboard({ silent: true })
                                  → refresh selectedTrace (if open)
```

事件类型：`trace.started` / `trace.updated` / `trace.completed`

防抖设计：tool span 在快速工具链中会 burst 触发多个 `trace.updated`，150ms trailing debounce 合并为单次 UI 刷新，避免闪烁。

---

## 6. Dashboard 面板设计

### Metric Cards（5 张）
| ID | 计算方式 | Tone |
|----|----------|------|
| traces | `allTraces.length` | neutral |
| avg-duration | `sum(durationMs) / count` | neutral |
| errors | 失败 trace 数（status=error/aborted 或含 error span） | 0=good / >0=bad |
| tokens | `sum(trace.tokenUsage.totalTokens)` | neutral |
| cost | `sum(trace.tokenUsage.costUsd)` | <$1=good / >$1=warn |

### Alerts
- 失败 trace 统计
- adversarial-review 模式缺少 verifier/skeptic span 告警

### Trace Table
每行：Run name / Status badge / Duration / Span count / Error count / Token count / Cost / Score

点击行 → 展开内联 `<TraceWaterfall>` 组件

### TraceWaterfall
- 每个 span 一行：name + kind badge + 时间横条 + duration
- 横条定位：`left = (span.startedAt - trace.startedAt) / total * 100%`
- 横条宽度：`width = span.durationMs / total * 100%`（最小 1.5%）
- 颜色：completed=emerald / error=red / aborted=amber / running=blue+pulse
- Hover tooltip：input/output/error 前 200 字符

---

## 7. 关键文件索引

| 层级 | 文件 | 职责 |
|------|------|------|
| Runtime | `openclaw_runtime/src/agents/embedded-agent-subscribe.handlers.lifecycle.ts` | 发射 lifecycle 事件（含 tokenUsage） |
| Runtime | `openclaw_runtime/src/agents/embedded-agent-subscribe.ts` | 累积 usageTotals |
| Gateway | `electron/gateway/event-dispatch.ts` | 分发原始事件 |
| Gateway | `electron/gateway/chat-runtime-events.ts` | 规范化 → ChatRuntimeEvent |
| 主进程 | `electron/main/index.ts` | 事件路由 + async enrichment |
| Service | `electron/services/observability-adapter.ts` | 事件 → Trace 翻译 + token 补全 |
| Service | `electron/services/observability-service.ts` | 内存 Trace 存储 + Dashboard 聚合 |
| Service | `electron/services/observability-api.ts` | Host API 暴露 |
| Util | `electron/utils/token-usage.ts` | JSONL transcript 读取 |
| Util | `electron/utils/token-usage-core.ts` | 多格式 usage 解析 |
| Shared | `shared/chat-runtime-events.ts` | ChatRuntimeEvent 类型定义 |
| Shared | `shared/types/observability.ts` | Observability 全套类型 |
| Store | `src/stores/observability.ts` | Zustand 状态管理 |
| UI | `src/pages/Observability/index.tsx` | Dashboard 页面 |
| UI | `src/pages/Observability/TraceWaterfall.tsx` | Span 瀑布图组件 |

---

## 8. 已知限制与后续规划

| 项目 | 状态 | 说明 |
|------|------|------|
| Span 只有 tool 一种 kind | 预期 | orchestrator/role-router/verifier 等 span 需 role-first 编排层运行才会出现 |
| Scorecard 恒为空 | P1-c | runtime 有 `buildTraceScorecard`，需接入 |
| 无持久化 | P2 | app 重启清空，需 JSONL 落盘 |
| 无采样/背压 | P2 | 高频 run 可能快速填满 200 条上限 |
| Cost 依赖 JSONL | 设计决策 | runtime 不追踪 cost，由 electron 侧从 transcript 推导 |
| Runtime typecheck OOM | 预存 | 项目过大，需 `--max-old-space-size=8192`，与本模块无关 |

---

## 9. 设计原则

1. **零改上游优先**：P0/P1 全在 Electron 侧完成，复用已有 `agent` 事件流，不需要 openclaw 配合发版
2. **渐进增强**：Phase B 扩展上游数据只是加速（省去磁盘读取），Phase A JSONL 始终兜底
3. **无管理层**：不引入 retry 框架、session manager、config 系统、logging 框架
4. **内存优先**：MVP 不持久化，重启清空，上限 200 条自动淘汰
5. **防抖合并**：tool burst 通过 150ms trailing debounce 合并为单次 UI 更新
6. **向后兼容**：Phase B 的 `tokenUsage` 字段是 optional，旧 runtime 不发送也不报错
