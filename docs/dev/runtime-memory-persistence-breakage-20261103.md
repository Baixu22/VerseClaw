# Runtime memory 持久化断链：现状、影响与决策点（2026-11-03）

- driven_by: agent
- actor: codex/runtime-memory-audit
- 性质：只读审计 + 证据登记；**未改任何产品行为**
- 基线：main `e52bc9038`

## 1. 一句话结论

TF-0500 把 `shadow / provider / proposeFacts / persist` 四个 runtime-memory 开关硬钉为 `false`，
但**保留了全部依赖它们的生产路径**。结果是这些路径不是被删除，而是被静默禁用：
每次调用都返回 `skipped / flag_disabled`。仓库因此长期带着 40 个失败的 memory 测试，
以及一个永远读不到 runtime facts 的 Gateway 面板。

这不是“测试过时”，而是**产品能力断链 + 测试口径未收尾**的组合债。

## 2. 实现事实

`openclaw_runtime/src/runtime-core/memory-context.ts`（TF-0500 引入）：

```ts
export const RETIRED_RUNTIME_MEMORY_FLAGS = ["shadow", "provider", "proposeFacts", "persist"] as const;

export function resolveRuntimeMemoryFeatureFlags(value: unknown): RuntimeMemoryFeatureFlags {
  return {
    // Retired flags can never resolve to true, whatever the config says.
    shadow: false,
    provider: false,
    proposeFacts: false,
    persist: false,
    candidateGeneration: strictFlag(memory, "candidateGeneration"),
  };
}
```

`openclaw_runtime/src/runtime-core/memory-persistence.ts:838`：
```ts
private persistEnabled(): boolean {
  return resolveRuntimeMemoryFeatureFlags(this.#config).persist;   // 恒为 false
}
```

该判断同时门控 `migrate / appendEpisode / appendFact / invalidateFact / persistRelation /
inspectRuntimeMemorySanitizedEpisodes`。**没有任何覆盖入口**（无 options 层开关、
无测试注入点），因此持久化 SQLite 实现当前不可被任何调用方激活。

## 3. 生产路径仍在调用（不是死代码）

| 调用点 | 行为 |
|---|---|
| `agents/task-loop-controller.ts:2269` `runtimeMemoryShadowPersistenceEnabled` = `shadow && persist` | 恒 false，TaskLoop 永不写入 episode |
| `agents/embedded-agent-runner/run/attempt.ts:2168` | 建 integration → `loadStore()` 返回 skipped，provider 无 facts |
| `agents/embedded-agent-runner/extensions.ts:305` | 同上 |
| `gateway/runtime-memory-consolidation-service.ts:39` | 合并服务空转 |
| `gateway/server-methods/memory-surface.ts:301` | `flags.persist` 恒 false → **面板永远读不到 runtime facts / candidates** |
| `gateway/server-methods/role-orchestration-methods.ts`（3 处） | 同上 |
| `runtime-core/memory-self-edit-adapter.ts:116` | 自编辑写入恒被跳过 |

## 4. 测试失败归因

- 全量单测 58 个失败套件中，**40 个是 memory 相关**。
- 60 个失败套件在 A3 之前的基线 `97cda35de` 上同样失败，候选可归属回归为 0
  （见 `artifacts/admission-convergence-20261103/unit/unit-regression-classification.json`）。
- 代表例：`tests/unit/runtime-memory-persistence.test.ts` 6 例中 4 例失败，
  全部断言 `{ status: "migrated" }` 或 `{ status: "persisted" }`，实际得到 `skipped / flag_disabled`。
- 该测试文件自 TF-0500（2026-10-23）之后**从未更新**。

## 5. 已存在的退役锁定测试覆盖不全

`tests/unit/memory-tf0500-retirement.test.ts` 只锁定了注入类标志：
`RETIRED_MEMORY_INJECTION_FLAGS = ['enableSessionStatePage', 'enablePreReplyRetrieval']`。
它**没有**覆盖 `RETIRED_RUNTIME_MEMORY_FLAGS`（persist / shadow / provider / proposeFacts），
所以退役决定在测试层没有闭环——这正是 40 个测试仍按旧口径断言的原因。

## 6. 三个可选方向

### A. 改测试跟随退役（产品行为零变化）
- 把 40 个测试改为“断言已退役 + 通过依赖注入仍可测实现”。
- 需要先给 `RuntimeMemoryPersistenceStore` 增加一个**测试可注入**的启用端口
  （否则持久化实现根本跑不到）。
- 成本：中高（40 文件 + 一个 options 扩展）；风险：低；产品行为：不变。
- 代价：runtime memory 持久化能力对用户仍然不存在。

### B. 恢复持久化能力
- 推翻 TF-0500 对 `persist`（及可能的 shadow/provider/proposeFacts）的退役。
- 需要新的冻结决策、默认值矩阵更新、回滚路径、以及重新验证。
- 成本：高；风险：高（涉及产品锁与默认值）；产品行为：改变。

### C. 只登记不修复
- 把这 40 个失败固化为“已知遗留债”，写明 owner 与复查日期，不阻塞其它工作。
- 成本：低；风险：中（仓库长期红，容易掩盖新回归）；产品行为：不变。

## 7. 建议

先做 **C 作为即时止血**（让全量单测的“红色”不再被误读为新回归），
再按 **A** 分阶段清偿；只有明确要恢复该能力时才考虑 **B**。

理由：TF-0500 的去向是“单一 accepted-memory authority”，恢复旧并行路径与架构目标冲突；
但让 40 个测试长期红着、且没有任何锁定测试覆盖这四个标志，会持续消耗每次审计的可读性。

## 8. 边界

- 本文档未修改任何源代码、默认值、产品锁或发布状态。
- 未声称 runtime memory 能力可用或不可用为最终产品定位；这需要决策后确定。
- 全部结论可由本文件所列文件路径与行号在 `e52bc9038` 上复核。

## 9. 2026-11-03 补充：权威口径已存在，先前的"启用端口"方案作废

本轮先实现了一个 `persistenceActivation: "explicit"` 的启用端口，让 store/integration/inspector
可以在测试里跑真实 SQLite。随后在仓库中发现了**既有的权威规格**：

`harness/specs/tasks/runtime-memory-retirement-closeout.md`（TF-0574，已在 main 上）明确写明：

> `resolveRuntimeMemoryFeatureFlags` already forces `shadow`, `provider`, `proposeFacts`
> and `persist` to false. **No production source change is required for this node.**
> Retired persistence returns `skipped / flag_disabled`, exposes an empty store, and leaves
> no database file.

因此**启用端口方案与既有决策冲突，已全部回退**（未留下任何产品源码改动）。
正确的方向是该规格已经指定的：测试断言"退役语义"，而不是让能力重新可用。

### 本轮已交付

- `tests/unit/memory-tf0500-persistence-retirement.test.ts`：10 条锁定测试，覆盖
  - 五个输入形态（explicit true / string true / omitted / explicit false / 全 legacy true）
    下四个退役 flag 全部为 false；
  - `candidateGeneration` 仍独立可配置（严格布尔）；
  - 退役写入不落盘、不建库、不打开 SQLite；
  - 退役集成不会调用注入的 writer。
- 该文件在干净工作区上 10/10 通过，且**不修改任何产品源码**。

### 仍未完成

`runtime-memory-retirement-closeout.md` 只是 repair 了 TaskLoop 与 context-contract 相关用例；
本轮统计的 40 个 memory 相关失败套件中，绝大多数仍按旧口径断言"可开启"。按该规格的
Retirement mapping 逐个改写（约 36 个文件）尚未完成，记为待办，不声称已完成。

## 10. 2026-11-03 分类审计：40 个套件不是一个问题，是三组

逐个实测（当前 HEAD `b48472cf3`）后，这 40 个失败套件可分成三组，
**它们的正确修复方向不同，不能用同一种改写**：

| 组 | 套件数 | 代表 | 失败性质 | 正确处置 |
| --- | --- | --- | --- | --- |
| G1 退役语义未对齐 | 约 27 | `memory-query-tool`、`memory-self-edit-adapter`、`runtime-memory-context-provider` | 断言退役后被禁用的行为仍可用 | 按 Retirement mapping 改成"断言不可用"（已验证：`r3-1-runtime-memory-legal-surface` 已改，2/2 通过） |
| G2 离线评测 fixture | 10 | `runtime-memory-eval-*`、`locomo-benchmark` | 评测指标计算本身**不依赖**退役开关；只是"建 fixture 库"这一步走了被禁用的 store | 需要**测试侧** fixture 建库能力（见下） |
| G3 其它 | 约 3 | `runtime-memory-compass-completion` 等 | 单点断言漂移 | 逐个判断 |

### G2 是真正需要决策的一组

- `evaluateChain` / `buildChainScenario` 等评测函数是**纯计算**，不读退役开关；
- 但 `tests/unit/helpers/runtime-memory-eval-helpers.ts` 的 `seedTempDb` /
  `appendFactToDb` / `invalidateFactInDb` 全部通过 `createRuntimeMemoryPersistenceStore` 建库，
  而该 store 在退役后一律 `flag_disabled`；
- 产品侧没有公开的 fixture 建库入口：`ensureRuntimeMemoryPersistenceSchema`、
  `RUNTIME_MEMORY_PERSISTENCE_SCHEMA_SQL`、`persistFact` 均**未导出**；
- 这些评测套件只有 `scripts/` 引用，不是产品运行时路径。

因此 G2 有三条路，各有代价：

1. **导出 fixture-only 建库入口**（产品模块新增一个明确标注 test/fixture 的导出）——
   改动小，但会给产品模块增加测试用途 API；
2. **在测试 helper 内实现等价建库**——不碰产品代码，但要复制 schema 与写入语义，
   存在与产品实现漂移的风险；
3. **把 G2 标为 not-run/known-gap**——最诚实，但 10 个评测套件继续不提供任何价值。

我倾向 **1**（受控导出 + 明确命名如 `__createRuntimeMemoryPersistenceFixture`），
因为它不复制 schema、不会漂移，且导出本身不启用任何产品能力。
但这需要一次明确决定，我没有擅自选择。

### 本轮已落地

- `tests/unit/r3-1-runtime-memory-legal-surface.test.ts` → 退役断言，2/2 通过（`b48472cf3`）
- `tests/unit/memory-tf0500-persistence-retirement.test.ts` → 10 条退役锁（`84df0ecd9`）
- 两者均未改动任何产品源码。

### 未落地

G1 其余约 26 个文件、G2 全部 10 个、G3 约 3 个仍在失败。本文件不声称它们已修复。
