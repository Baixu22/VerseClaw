# HD 双重压缩契约（Compression Provenance & Capability Negotiation）

> 状态：v1 规范
> 关联实现：`src/context-engine/context-candidate.ts`（ContextCandidate/v1）、`src/context-engine/block.ts`（compression_depth）、`src/context-engine/turn-injection-budget.ts`（通道策略）、`src/context-engine/context-health-monitor.ts`（B-4 评分）
> 背景：当底层 LLM 开始集成 Titans/MIRAS 式原生记忆模块时，应用层压缩策略必须与之协调，避免"双重压缩"导致信息冗余丢弃。

## 1. 问题定义

Titans/MIRAS 旨在把 Transformer 级别精度与循环模型线性时间效率结合——一旦这类模型成为 `base_model`，它们自带：
- **原生长期记忆模块**（上下文外存储 + 检索注入）
- **自有的 surprise/新颖性机制**（内部决定什么值得记住）

如果 ClawX 的应用层同时运行 VToken / memory_pilot / BlockStore 压缩，同一个信息片段会被：
1. 应用层压缩一次（有损）
2. 模型原生记忆再压缩一次（再次有损）

两次有损压缩叠加 → 信息冗余丢弃（documented B-2 damage 的架构级放大）。

## 2. 压缩溯源契约（Provenance Contract）

已有基础设施已具备契约的大部分要素，本规范将其**正式化**：

### 2.1 每个注入片段必须携带可溯源身份

`ContextCandidate/v1`（`context-candidate.ts`）已保证：

```ts
authority: { objectId, version, contentDigest }   // 源对象身份 + 版本 + sha256 内容摘要
dedupKey: `context-authority:${objectId}:${version}:${contentDigest}`  // 幂等去重
```

**契约义务**（v1 起生效）：
- 任何注入 `system_prompt` 或 `message` 的文本必须是 `ContextCandidate` 或经
  `chargeTurnInjection` 计费（`turn-injection-budget.ts`）的通道文本——不允许
  "bookless" 注入（off-the-books growth 是 FP-P0-05 已消灭的反模式）。
- `dedupKey` 命中即 `duplicate`（`finalizeContextCandidates`），应用层不得再次注入。

### 2.2 压缩深度标记

`ContextBlock.compression_depth`（`block.ts`，当前 `0 | 1`）：
- `0`：原始内容，未被应用层压缩。
- `1`：已被应用层压缩（摘要/截断），下游不得再对同一内容做全量压缩。

### 2.3 溯源链终点

`ContextReceipt/v1`（`dcs-receipts.ts`，rc03 门控）把 `selectedRefs` / `omittedRefs`
落 SQLite `runtime_receipts`——压缩决策可审计回放。

## 3. 能力协商规则（Capability Negotiation）

当 base model 报告**原生记忆能力**时，应用层对应通道必须协商关闭，避免双重压缩：

### 3.1 能力信号

在模型能力配置（`runtime.model` 能力声明，扩展现有 per-model capability 处理先例）新增：

```ts
capabilities: {
  nativeMemory: boolean;      // Titans/MIRAS 式原生长期记忆
  nativeContextGating: boolean; // 模型自管理上下文注入（如 surprise 过滤）
}
```

### 3.2 协商决策表

| base_model 能力 | VToken 通道 | memory_pilot 通道 | BlockStore 知识注入 | 溯源契约 |
|----------------|-------------|-------------------|--------------------|---------|
| 无原生记忆（现状） | 默认关 | 默认关 | 按 feature flag | 完整 |
| nativeMemory=true | **关闭**（双重压缩源） | **关闭** | 保留（referential） | 完整 |
| nativeContextGating=true | 关闭 | 关闭 | 关闭 | 完整（仅 receipt） |

决策依据：`nativeMemory` 模型自己做"记住什么"，应用层重复做是双重有损；
`nativeContextGating` 模型自管注入，应用层注入是干扰。

### 3.3 执行点

- 通道启用的权威决策在 `context-orchestrator.ts` 的 `computeContextExtraSystemPrompt`
  （`isMemoryPilotEnabled` / `resolveVtokenAssemblyConfig`）——协商规则在此叠加。
- 关闭 = `stage.enabled=false`，走现有 `flag-off` 分支（`recordContextOrchestratorSourceDecision`），
  无需新降级语义。

## 4. 验证

- **单测**：`context-orchestrator.test.ts` 增加"model 声明 nativeMemory → vtoken/memory_pilot 通道跳过"用例。
- **契约检查**：`pnpm contract:check`（若能力字段进入 `shared/host-api/contract.ts` 则同步）。
- **运行时观察**：`runtime-flag-ack` 的 injectionBudget.lastTurn.byChannel 应显示被协商关闭的通道为 skip。

## 5. 与 B-4 / B-2 的衔接

- 协商关闭的通道在 B-4 `ContextHealthMonitor` 中不再计入信息增量（避免把模型原生注入误判为应用层噪声）。
- `compaction-damage-rules.ts`（M5-B2）的 shadow 告警在 `nativeMemory=true` 模型上应调低敏感度
  （模型自持记忆，摘要缺标识符不等于信息丢失）——具体阈值待 paired-eval 校准。
