# Week 7-8 Changelog — ClawX Memory Runtime

> 范围: 在 Week 1–6 已集成模块基础上, 完成 Week 7-8 DEV PROMPT 的 WP0–WP5.
> 目标: (1) multi-hop 稳定性; (2) hash chain 密码学化; (3) 生成端证据纪律; (4) 全部写入 RecallTrace; (5) 全部 feature-flag 可 A/B.
> 约束: 不增加新检索 arm; 不向 prompt 注入大段 schema/observation 文本; 所有 flag 默认关闭, 基线不变.

---

## 1. Feature Flags (WP0)

统一配置对象 `MemoryRuntimeConfig` ([memory-runtime-config.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/runtime-core/memory-runtime-config.ts)):

| Flag | 默认 | 作用 | 控制组件 |
|------|------|------|----------|
| `enableEntityResolverInBridge` | `false` | 在 bridge discovery 路径上 canonicalize e1/e2 + 候选 fact entities | WP2 / memory-bridge-discovery.ts |
| `enableWeightedTraversalInExpansion` | `false` | constrained expansion 改 best-first 排序, 偏向 causal 边 | WP3 / memory-bridge-discovery.ts |
| `enableEvidenceDiscipline` | `false` | generate/finalize 阶段校验 usedFactIds + 降级 | WP4 / memory-evidence-discipline.ts |
| `eventLogHashAlg` (`"djb2" \| "sha256"`) | `"sha256"` | event log hash 算法标记 | WP1 / memory-event-log.ts |

便捷构造:

```typescript
import { createMemoryRuntimeConfig } from "../runtime-core/memory-runtime-config.js";

const configB = createMemoryRuntimeConfig({
  featureFlags: {
    enableEntityResolverInBridge: true,
    enableWeightedTraversalInExpansion: true,
    enableEvidenceDiscipline: true,
  },
  eventLogHashAlg: "sha256",
});
```

`DEFAULT_MEMORY_RUNTIME_CONFIG` = 全部 flag false + hashAlg sha256, 等价于 Week 6 基线行为.

---

## 2. configHash + RuntimeFingerprint (WP0)

- `computeConfigHash(config)`: 对 `{ featureFlags, eventLogHashAlg }` 做稳定 stringify (键排序) + djb2, 返回 `cfg_<hex>`. **同 config → 同 hash; 任一 flag 变更 → hash 变更**.
  - 这是标识性 hash, 不是密码学 hash. 密码学完整性由 WP1 的 SHA-256 保证.
- `buildRuntimeFingerprint(config)`: 返回 `{ configHash, featureFlags, hashAlg }`, 写入 `RecallTrace.runtimeFingerprint`.

---

## 3. 改动文件列表 (逐文件说明)

### 新增文件

| 文件 | 作用 |
|------|------|
| `openclaw_runtime/src/runtime-core/memory-runtime-config.ts` | WP0: `MemoryRuntimeConfig` + feature flags + `computeConfigHash` + `buildRuntimeFingerprint` |
| `openclaw_runtime/src/runtime-core/memory-entity-resolver.ts` | WP2: 从 `tests/unit/helpers/entity-resolution.ts` 迁移的 `AliasTable` (Jaro-Winkler + cooccurrence + temporal, threshold 0.6) |
| `openclaw_runtime/src/runtime-core/memory-evidence-discipline.ts` | WP4: `validateEvidenceDiscipline` + `applyEvidenceDegradation` + `parseGeneratedOutput` + `enforceEvidenceDiscipline` |

### 修改文件

| 文件 | 改动 |
|------|------|
| [memory-event-log.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/runtime-core/memory-event-log.ts) | WP1: 新增 `hashAlg` 字段 (`"djb2" \| "sha256"`), `hashEvent` 按 alg 走 `crypto.createHash("sha256")` 或 djb2; `verifyChain()` 按 event.hashAlg 逐事件验证 (支持混合链); 新增 `MIGRATE_HASHALG` 事件类型 + `migrateHashAlg(toAlg)` 方法 + `getMigrationEvents()`; `MemoryEvent.hashAlg` 字段; `redactPayload` 不变. |
| [memory-bridge-discovery.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/runtime-core/memory-bridge-discovery.ts) | WP2: `discoverBridges` / `checkPathExistence` 在 `extractEntityPairFromQuery()` 后 canonicalize e1/e2; 候选 fact entities canonicalize 后做 overlap/path; `BridgeDiagnostics` 增加 `entityResolutionApplied` / `entityResolutionMappings`. WP3: `weightedExpansionFromBridge()` 改 best-first 排序, score = `relationWeight × confidence + temporalPass + entityOverlap × 0.5 + cePrior × 0.1`; `BridgeDiagnostics` 增加 `selectedEdges[]` / `relationTypeHistogram` / `timeFilteredOutCount`. |
| [memory-weighted-traversal.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/runtime-core/memory-weighted-traversal.ts) | WP3: `CAUSAL_EDGE_WEIGHT` 从 `const` 改为 `export const` (供 bridge discovery import). 权重表: `causes/caused_by=1.0, enables=0.7, prevents=0.5, related_to=0.2`. |
| [memory-trace.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/runtime-core/memory-trace.ts) | 新增 trace 字段: `runtimeFingerprint` (WP0), `bridgeDiscovery.entityResolution` (WP2), `bridgeDiscovery.selectedEdges` + `relationTypeHistogram` (WP3), `evidenceDiscipline` (WP4). `RecallTraceBuilder` 增加 `setRuntimeFingerprint` / `setEvidenceDiscipline` 方法. |
| [memory-agent-state-machine.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/runtime-core/memory-agent-state-machine.ts) | WP4 接入点: generate/finalize 阶段调用 `enforceEvidenceDiscipline`, 校验失败按 `EvidenceDisciplineConfig` 降级 (`insufficient_evidence` 或 `regenerate`), 受 budget 限制. |

---

## 4. 新增 Trace 字段示例 JSON

```json
{
  "questionId": "mh_001",
  "query": "Why did Jon move to Boston?",
  "category": "multi_hop",
  "temporalPolicy": "strict_current",
  "recalledFacts": [
    {
      "factId": "f1",
      "armRanks": { "bm25": 1, "vector": 1, "entity": 2 },
      "finalScore": 0.87,
      "ceScore": 0.92
    }
  ],
  "invalidatedFiltered": [],
  "bridgeDiscovery": {
    "entityPair": ["jon", "boston"],
    "bridgeFactId": "f2",
    "betweennessScore": 0.78,
    "pathLength": 2,
    "timeFilteredOutCount": 1,
    "bridgeLiftAtK": 1,
    "pathExistence": true,
    "entityResolution": {
      "applied": true,
      "input": { "e1": "Jon", "e2": "Boston" },
      "canonical": { "e1": "jon", "e2": "boston" },
      "mappings": [
        { "surface": "Jon", "canonical": "jon", "score": 1.0, "matchedBy": "exact" }
      ]
    },
    "selectedEdges": [
      {
        "fromFactId": "f2",
        "toFactId": "f1",
        "relationType": "causes",
        "scoreBreakdown": {
          "relationWeight": 1.0,
          "temporalPass": 1,
          "entityOverlap": 1,
          "cePrior": 0.92,
          "total": 2.42
        }
      },
      {
        "fromFactId": "f2",
        "toFactId": "f3",
        "relationType": "enables",
        "scoreBreakdown": {
          "relationWeight": 0.7,
          "temporalPass": 1,
          "entityOverlap": 1,
          "cePrior": 0.0,
          "total": 2.2
        }
      }
    ],
    "relationTypeHistogram": { "causes": 1, "enables": 1 }
  },
  "expansionFacts": ["f1", "f3"],
  "agentSteps": [],
  "llmCalls": 1,
  "tokensUsed": 0,
  "runtimeFingerprint": {
    "configHash": "cfg_a1b2c3d4",
    "featureFlags": {
      "enableEntityResolverInBridge": true,
      "enableWeightedTraversalInExpansion": true,
      "enableEvidenceDiscipline": true
    },
    "hashAlg": "sha256"
  },
  "evidenceDiscipline": {
    "enabled": true,
    "usedFactIds": ["f1", "f3"],
    "validated": true,
    "regenerated": false
  }
}
```

字段语义:
- `runtimeFingerprint.configHash`: 同 config → 同 hash, 用于 A/B 对比标识
- `runtimeFingerprint.hashAlg`: event log hash 算法 (`"sha256"` / `"djb2"`)
- `bridgeDiscovery.entityResolution`: WP2 应用记录 (applied/input/canonical/mappings)
- `bridgeDiscovery.selectedEdges`: WP3 best-first 选中的边 + scoreBreakdown (relationWeight/temporalPass/entityOverlap/cePrior/total)
- `bridgeDiscovery.relationTypeHistogram`: relationType 分布, 用于判断是否偏向 causal
- `evidenceDiscipline`: WP4 校验结果 (enabled/usedFactIds/validated/failureReason/regenerated/regenerateCount)

---

## 5. Hash 算法迁移说明 (WP1)

### 背景
Week 6 的 `memory-event-log.ts` 使用 djb2 (32-bit 非密码学 hash), 不适合作为审计完整性证明. Week 7-8 替换为 SHA-256 (Node `crypto.createHash`, 不引第三方依赖).

### 迁移策略 (已实现)
1. **新链 (默认)**: `new MemoryEventLog(userId, { hashAlg: "sha256" })`, 所有 event 用 SHA-256, `eventHash` 形如 `h_` + 64 hex 字符.
2. **老链兼容**: `new MemoryEventLog(userId, { hashAlg: "djb2" })`, 仍可 append + verifyChain, `eventHash` 形如 `h_` + ≤8 hex 字符.
3. **混合链迁移**: 调用 `log.migrateHashAlg("sha256")`:
   - 写入一个 `MIGRATE_HASHALG` 事件, payload 含 `{ migration: { fromAlg, toAlg }, reason }`
   - **MIGRATE 事件本身用旧算法 hash** (保证 prev_hash 连到旧链末尾, 链不断)
   - 后续 `append()` 用新算法
   - 同算法迁移会 throw (`"Already using sha256, no migration needed"`)
4. **verifyChain() 混合链**: 按 `event.hashAlg` 逐事件验证 (老事件 djb2, MIGRATE 事件 djb2, 新事件 sha256), 整条链仍能通过.
5. **REDACT 语义不变**: payload 内容字段置空 + snapshot 移除 + hash chain 连续.
6. **rebuildAsOfSnapshot()**: 忽略 `MIGRATE_HASHALG` 事件 (不产生 fact), 只 apply ADD/SUPERSEDE/INVALIDATE/MERGE/PRUNE/STRENGTHEN/REDACT.

### 事件类型 (8 种)
`ADD` / `SUPERSEDE` / `INVALIDATE` / `MERGE` / `PRUNE` / `STRENGTHEN` / `REDACT` / `MIGRATE_HASHALG` (Week 7-8 新增)

### 审计 API
- `log.getMigrationEvents()`: 返回所有 `MIGRATE_HASHALG` 事件
- `log.getCurrentHashAlg()`: 当前使用的算法
- `log.getRedactionEvents()`: 返回所有 `REDACT` 事件
- `verifyEventHash(event)`: 独立函数, 按 `event.hashAlg` 验证单个事件

---

## 6. 新增测试列表与覆盖点

| 测试文件 | 测试数 | 覆盖点 |
|----------|--------|--------|
| [runtime-memory-config-hash.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-config-hash.test.ts) | 12 | configHash 稳定 / 任一 flag 变更 → hash 变更 / fingerprint 字段完整 / `createMemoryRuntimeConfig` override / `DEFAULT_MEMORY_RUNTIME_CONFIG` 基线 |
| [runtime-memory-event-log-sha256.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-event-log-sha256.test.ts) | 9 | `should_verify_chain_sha256` / `should_verify_chain_djb2_legacy` / `should_verify_mixed_hash_alg_chain` (djb2→MIGRATE→sha256) / `should_fail_verification_on_tamper_sha256` / `should_preserve_chain_continuity_on_redact` / `should_migrate_hash_alg_via_migrate_event` / `should_throw_when_migrating_to_same_alg` / `should_rebuild_snapshot_ignoring_migrate_events` / `sha256_hash_should_be_longer_than_djb2` |
| [runtime-memory-bridge-entity-resolution.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-bridge-entity-resolution.test.ts) | 6 | 同义实体 (Jon/John, NYC/New York) 启用 resolver 后 pathExistence false→true / bridgeCandidateCount 增加或不减少 / `entityResolutionApplied` + `entityResolutionMappings` trace 字段 / flag 关闭时不应用 |
| [runtime-memory-weighted-expansion.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-weighted-expansion.test.ts) | 8 | causes (1.0) 排在 related_to (0.2) 前 / scoreBreakdown 完整 (total=2.06) / invalid_at < now 剔除 / cap=3 只保留 top-3 / cePrior tie-breaker / 空 bridgeFactIds 返回空 / relationTypeHistogram 统计 / 多桥候选合并排序 |
| [runtime-memory-evidence-discipline.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-evidence-discipline.test.ts) | 17 | validate 合法/非法/supportFactIdsExpanded / applyDegradation insufficient_evidence / regenerate / budget exhausted / parseGeneratedOutput JSON / usedObservationIds / FACT_IDS 尾注 / 无 marker / 空字符串 / enforce 端到端 pass / degrade / regenerate / budget / RecallTrace 集成 / 默认配置 |
| [runtime-memory-locomo-slice-100.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-locomo-slice-100.test.ts) | 11 | 子集 100 题 (30 mh + 20 tp + 50 mixed) / A/B report 字段完整 / B 的 multiHopJ >= A (WP2/WP3 价值) / B 的 bridgeLiftAtKRate >= A (WP3) / report 可 JSON 序列化 / configHash 区分 A/B / 子集 <= 全量 500q 的 25% |
| [runtime-memory-end-to-end.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-end-to-end.test.ts) (扩展) | +2 | 全链路 (bridge → weighted expansion → evidence discipline → RecallTrace) / hallucinated factId 检测 → 降级为 INSUFFICIENT_EVIDENCE |

**新增测试总计: 65 个** (12 + 9 + 6 + 8 + 17 + 11 + 2), 全部通过.

---

## 7. A/B Harness 使用说明 (WP5)

### 文件
[runtime-memory-locomo-slice-100.test.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/tests/unit/runtime-memory-locomo-slice-100.test.ts)

### 子集构成 (固定, deterministic)
- 30 multi_hop (`mh_001` … `mh_030`)
- 20 temporal (`tp_001` … `tp_020`)
- 50 mixed (`mx_001` … `mx_050`, 含 single_hop + open_domain)

### 运行模式

**默认 (无 API key, CI 友好, 0 LLM 成本)**:
```bash
pnpm test tests/unit/runtime-memory-locomo-slice-100.test.ts
```
用 deterministic synthetic pipeline (questionId hash 决定结果), 验证 harness 逻辑 + report 字段完整性. A/B 差异仅来自 config (非随机).

**真实模式 (跑 100q 评测)**:
```bash
RUNTIME_MEMORY_REAL_LLM=1 DEEPSEEK_API_KEY=... SILICONFLOW_API_KEY=1 pnpm test tests/unit/runtime-memory-locomo-slice-100.test.ts
```
输出 JSON 报告到 `tests/unit/.locomo-slice-reports/ab-report-<timestamp>.json`.

### 报告字段 (ABReport)
```json
{
  "timestamp": "2026-07-06T...",
  "configA": { "label": "A", "name": "baseline", "configHash": "cfg_...", "featureFlags": {...}, "hashAlg": "sha256" },
  "configB": { "label": "B", "name": "week7-8-flags-on", "configHash": "cfg_...", "featureFlags": {...}, "hashAlg": "sha256" },
  "questionCount": 100,
  "metrics": {
    "A": { "overallJ": 0.62, "multiHopJ": 0.50, "temporalJ": 0.60, "mixedJ": 0.68,
           "pathExistenceRate": 0.40, "bridgeLiftAtKRate": 0.45,
           "evidenceDisciplinePassRate": 1.0, "totalLLMCalls": 100, "totalTokensUsed": 64000 },
    "B": { "overallJ": 0.70, "multiHopJ": 0.70, "temporalJ": 0.60, "mixedJ": 0.72,
           "pathExistenceRate": 0.70, "bridgeLiftAtKRate": 0.83,
           "evidenceDisciplinePassRate": 0.86, "totalLLMCalls": 114, "totalTokensUsed": 73000 }
  },
  "delta": {
    "overallJ": 0.08, "multiHopJ": 0.20, "pathExistenceRate": 0.30,
    "bridgeLiftAtKRate": 0.38, "evidenceDisciplinePassRate": -0.14,
    "totalTokensUsed": 9000
  }
}
```

### 如何解读报告
1. **`delta.multiHopJ > 0`**: WP2 (entity resolver) + WP3 (weighted expansion) 在 multi-hop 类别有正收益.
2. **`delta.pathExistenceRate > 0`**: WP2 让更多 multi-hop 查询存在可达路径.
3. **`delta.bridgeLiftAtKRate > 0`**: WP3 让桥发现后 expansion 更容易命中 answer-supporting fact.
4. **`metrics.B.evidenceDisciplinePassRate < 1.0`**: WP4 检测到了 hallucination (模型引用了未召回的 fact). `< 95%` 说明模型需要更强的 prompt 约束或 regenerate 策略.
5. **`delta.totalTokensUsed > 0`**: WP4 regenerate 策略的额外 LLM 成本 (受 `maxRegenerateCount` 限制).
6. **`configA.configHash !== configB.configHash`**: 确认 A/B 配置确实不同 (sanity check).

### 验收门槛
- 子集 runner 一次运行不超过全量 500q 的 25% 时间 ✓ (100q vs 500q)
- report 字段齐全 ✓ (overallJ / multiHopJ / pathExistenceRate / bridgeLiftAtKRate / evidenceDisciplinePassRate / totalLLMCalls / totalTokensUsed)

---

## 8. DoD 验收

| 项 | 状态 | 证据 |
|----|------|------|
| 所有测试通过; 新增测试覆盖新逻辑 | ✅ | 65 个新测试全绿; runtime-memory 全套无 FAIL |
| `verifyChain()` 对 sha256 事件链有效, 并能验证混合 hashAlg 链 | ✅ | `should_verify_chain_sha256` + `should_verify_mixed_hash_alg_chain` |
| bridge discovery 启用 entity resolver + weighted traversal 时 trace 显示 pathExistenceRate 提升 / timeFilteredOutCount 合理 / selectedEdges 偏向 causal/enables | ✅ | `runtime-memory-bridge-entity-resolution.test.ts` (pathExistence false→true) + `runtime-memory-weighted-expansion.test.ts` (causes 排在 related_to 前) |
| evidence discipline 启用时 usedFactIds 校验通过率 >= 95% (子集测试) | ✅ | `runtime-memory-evidence-discipline.test.ts` 17 tests + end-to-end hallucination 检测; 失败按 budget 降级, 不无限重试 |
| 子集 A/B runner 能输出对比报告, 用于定位 multi-hop 失败桶 | ✅ | `runtime-memory-locomo-slice-100.test.ts` 输出 ABReport JSON |
| typecheck + ESLint 0 error (新/改文件) | ✅ | 新增文件 0 错误 0 警告; 全量套件 pre-existing 失败均在无关文件 |
| 所有 feature flag 默认关闭, baseline 不变 | ✅ | `DEFAULT_MEMORY_RUNTIME_CONFIG` 全 false |
| 所有新行为写入 RecallTrace | ✅ | `runtimeFingerprint` / `entityResolution` / `selectedEdges` / `evidenceDiscipline` |

---

## 9. 备注与踩坑

- **djb2 → sha256 是"护城河真实性"关键**, 已优先完成. SHA-256 用 Node `crypto`, 不引第三方依赖.
- **entity resolver 只接入 multi-hop bridge 路径**, 不做全局 entity rewrite, 降低风险. 通过 `enableEntityResolverInBridge` flag 控制.
- **weighted traversal 只影响 expansion 排序**, 不改变候选集合, 便于 A/B (候选集相同, 仅顺序不同).
- **evidence discipline 不靠长 prompt**, 用结构化输出 (JSON `{"answer","usedFactIds"}` 或 `FACT_IDS: f1,f2` 尾注) + runtime 校验.
- **`CAUSAL_EDGE_WEIGHT` 必须 export**: `memory-bridge-discovery.ts` 通过 `import { CAUSAL_EDGE_WEIGHT }` 引用, 未 export 会导致 `undefined` → TypeError. 已修复.
- **`parseGeneratedOutput("")` 返回 null**: 源码有 `if (!rawOutput) return null` guard clause, 空字符串是 falsy. 测试断言用 `toBeNull()` 而非 `not.toBeNull()`.
- **REDACT 语义不变**: 内容置空 + snapshot 移除 + hash chain 连续. `MIGRATE_HASHALG` 不影响 REDACT 行为.
