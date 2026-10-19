# TF-0447 语义规格：context assembly 的头条指标

- 日期：2026-10-19
- driven_by: agent
- actor: codex
- 实现：`openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts`
- 接线：`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`（`completePromptCacheObservation` 之后）
- 基准：`harness/specs/fixtures/tf0447-prompt-cache-benchmark/`

## 指标定义（唯一口径）

**Prompt-cache hit rate** = `cacheReadTokens / (inputTokens + cacheReadTokens)`

- 分母是该窗口内模型实际看到的 prompt 预算，包含未命中（`input`）与命中（`cacheRead`）两部分。
- 分子只计 `cacheRead`。
- 当 provider 只上报 `cacheRead`、未上报 `input` 时，以 `cacheRead` 作为整个预算（即 1.0），
  并在产物中保留 `observations` 计数，避免把缺失误读成高命中。
- 当 provider 未上报任何可用 `cacheRead` 时，**不计入窗口**，返回 null；不猜测。

## 为什么它是 context assembly 的头条指标

Manus 的上下文工程复盘把 KV-cache 命中率列为 agent 生产环境最重要的单一指标：
缓存输入与未缓存输入的单价差约 10 倍，且 agent 的输入/输出比高度倾斜。断点归因
只回答「哪个输入破坏了暖前缀」，无法回答「这个窗口到底有多少预算真的来自缓存」——
零断点的运行仍可能几乎不经缓存。

## 有界性

- 每个 key 一个窗口；最多 512 个 key。
- 单窗口 token 计数上限 1e9，防止异常 usage 撑爆数值。
- 纯内存、无 I/O、无持久化、无新依赖。
- `resetPromptCacheObservabilityForTest()` 同时清空窗口，避免测试间泄漏。

## 权威边界

- **不是 routing authority**。指标只被读取和展示；没有任何代码用它改变路由、排序或优先级。
- Routing Memo 仍为 `null` / `shadow` 语义，除非有 scorecard 证据。
- 不构成 release 或 GA 声明。

## 复现

```bash
# 指标与归因逻辑
vitest run tests/unit/prompt-cache-hit-rate.test.ts tests/unit/prompt-cache-observability.test.ts

# 固定任务集基准，产出 result.json
vitest run tests/unit/tf0447-prompt-cache-benchmark.test.ts
```

基准任务的固定输入在 `tasks.json`，重放产物在 `result.json`。基准**不调用模型**，
只重放记录下来的 usage 形状；它证明记账与归因链路，不证明 provider 账单。
