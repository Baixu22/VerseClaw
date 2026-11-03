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

### 更正：G2 并非"评测工具本身"，而是"已退役能力"

上一小节的分类有误，特此更正并保留原始记录。

经复核：

- `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts:240` 同样以
  `resolveRuntimeMemoryFeatureFlags(options.config).persist` 为门控，退役后恒返回
  `skipped / flag_disabled`；
- `task-loop-controller.ts:3844/3901` 在**产品路径**中直接调用该诊断函数。

所以这 10 个 eval 套件测的**不是**一个独立可用的评测工具，而是同样依赖
`persist` 的 read-hydration 能力。它们与 G1 属于同一类问题：能力已退役，测试仍在断言可用。

因此**不需要**新增 fixture-only 建库导出，也不需要复制 schema。
先前提出的三个选项（导出 fixture 入口 / 复制 schema / 标为 known-gap）**全部作废**。

正确处置：与 G1 一致——把这些套件改写为"退役后不产生评测数据"的断言；
若某些纯计算函数（如 `evaluateChain`）本身不依赖开关，则保留其单元测试，
只把"建 fixture 库 + 跑诊断"的部分改为断言退役。

## 11. 可复用改写模式（本轮验证）

对 G1/G2 里"断言退役能力可用"的套件，按下面三条改写，已在
`r3-1-runtime-memory-legal-surface`、`memory-self-edit-adapter`、
`runtime-memory-eval-chain-eval`、`runtime-memory-eval-topic-drift` 四个文件上验证：

1. **保留纯函数覆盖**：`buildChainScenario` / `buildTopicSegments` / `evaluateChain` /
   `evaluateTopicDrift` 这类不读退役开关的计算，继续测，不删。
2. **把"建库 + 跑诊断"改成退役断言**：`migrate()` 返回 `skipped/flag_disabled`；
   写 fact 抛 `appendFact failed ... status=skipped`；不再 grep 具体 reason 字符串之外的行为。
3. **诊断对象用真实构造器生成**，不要手写：
   `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({ ... })`。
   手写会被其内部结构拒绝（实测：`evaluateTopicDrift` 要求诊断数与 query 总数相等，
   且诊断内部读取 `queries[0]` 之外还有字段）。

### 已验证的契约细节（避免重复踩坑）

| 函数 | 真实契约 |
| --- | --- |
| `evaluateChain(scenario, diagnostics)` | `diagnostics.length` 必须**等于** `scenario.length`；空数组会抛错 |
| `evaluateTopicDrift(segments, diagnostics)` | `diagnostics.length` 必须等于**所有 segment 的 query 总数**（不是 segment 数） |
| `appendFactToDb` / `seedTempDb` | 退役后直接抛 `... status=skipped`，不会静默返回 |

### 改写时必须先自检（本轮两次改坏文件后补充）

用脚本按行切片改写 TS 测试文件时，**写入前必须先做括号配平检查**：

```js
const opens = (out.match(/\{/g) || []).length;
const closes = (out.match(/\}/g) || []).length;
if (opens !== closes) throw new Error("unbalanced; not writing");
fs.writeFileSync(path, out, "utf8");
```

本轮在 `conflict-resolution` 与 `chain-eval` 上各改坏过一次（切片边界多删了 describe 的
闭合括号，导致 `Unexpected end of file`），都是从 `git checkout -- <file>` 恢复后重做。
另外：`String.replace` 对含 CRLF 的多行块容易静默不匹配，**替换后必须断言替换确实发生**
（`out !== before`），否则会出现"改了没生效"却误以为已修。

## 12. G2 完成记录（2026-11-03）

10 个"离线评测 fixture"套件全部完成退役对齐，合并运行结果：

```
10 suites / 21 files / 23 tests / 0 failed / 1 skipped
```

逐个提交：

| 套件 | 提交 | 覆盖变化 |
| --- | --- | --- |
| eval-chain-eval | 4a8806ebe | 6 → 3（保留纯构造 + 纯聚合） |
| eval-topic-drift | 05e776f01 | 6 → 3（同上） |
| eval-conflict-resolution | 858fd13ff | 6 → 3（同上） |
| eval-budget-pressure | 6303c3f31 | 7 → 3（同上） |
| eval-temporal-evolution | a43b7aaf4 | 7 → 1（全部依赖建库） |
| eval-aggregate-report-real | 7e97bd5be | 15 → 2 |
| eval-enhanced-integration | 5e5a7d5e8 | 7 → 2 |
| eval-latency-benchmark-real | 330376a61 | 9 → 1 |
| locomo-benchmark | 589ccf96e | 4 → 4（只改失败的那个） |
| read-hydration-long-conversation-eval | 1030898b0 | 6 → 1 |

**这些是覆盖缩减，不是等价替换。** 原来的断言测量的是"退役能力真实可用时"的
性能/质量指标；能力退役后这些指标无法产生，保留断言只会让套件永久红。
每个 commit message 都写明了具体缩减幅度。

对于仍可独立验证的纯函数（scenario 构造、evaluate* 聚合、fixture 结构校验、
短缺点分析），覆盖全部保留。

## 13. read-hydration 组完成记录（2026-11-03）

11 个文件全部完成退役对齐，合并运行结果：

```
22 suites / 43 tests / 0 failed / 0 skipped
```

| 套件 | 提交 | 原/现用例 |
| --- | --- | --- |
| shadow-opt-in-evaluation | d96a26193 | 1 → 1 |
| shadow | 00b105e75 | 5 → 5（4 个仅改 reason） |
| benefit-evaluation | 8b7bf05a5 | 7 → 7（1 个改动） |
| controlled-db-replay-regression | 7c6c0ef82 | 2 → 2 |
| controlled-real-db-evaluation | 3280352a0 | 2 → 2 |
| controlled-internal-shadow-pilot | 07488b311 | 3 → 3 |
| limited-production-opt-in-implementation | 8188cc0db | 4 → 4 |
| limited-production-opt-in-readiness | 26d8377ff | 3 → 3 |
| test-research-breakthrough | a685e89a6 | 5 → 5 |
| taskloop-shadow-only-explicit-opt-in | 663aa5dba | 3 → 3 |
| shadow-command | 5dbd4717b | 8 → 8 |

**这一组与 G2 不同：几乎全部是"改断言而非删覆盖"。** 因为多数文件里同时存在
"默认关闭 / 非法门控在 DB 访问前失败"的用例，它们本来就通过，只需改真正失败的那部分。

### 反复出现的两种失败形态

1. **门控短路**：`persist` 检查排在所有其他门控之前，退役后
   `read_shadow_disabled / database_path_required / database_missing / table_missing`
   全部塌缩成 `flag_disabled`。修法：只改 reason，保留"不打开 sqlite / 不建文件 / 不建表"断言。
2. **写入辅助函数行为不一致**：`seedTempDb` 会抛错，`persistFacts` 不抛错（静默什么都不写）。
   修法：先读实现再决定断言，不要跨文件套用。

## 14. TF-0697 closeout evidence (2026-11-03)

- driven_by: agent
- actor: codex/runtime-memory-audit
- baseline before this closeout: `origin/main 610e7cfc4`
- decision: **A — tests follow the existing TF-0500 retirement decision; product behavior is unchanged**
- rollback boundary: revert the test-only commits listed below or set aside the local test rewrite; no product default, lock, approval authority, release verdict, persisted user data, or production source is changed

### Final memory-surface result

```text
113 suites / 1070 passed / 0 failed / 40 skipped
command: pnpm exec vitest run runtime-memory --reporter=json --outputFile=D:/tmp/tf0697-all-memory-final.json

report SHA-256: b30fa75b72b6b4552d54ee3189397173e17064503094511486038f2b9f00318d
```

The 40 skips are pre-existing live/model-dependent `skipIf` cases; they are not converted
into passes and are not evidence of the retired persistence path working.

### Additional closeout commits

- `a95412254` — relation-chain retirement assertions (14/14)
- `1480ec8db` — adapter and self-edit persistence boundaries (enabled success paths are unreachable; those probes are semantic coverage loss, while reachable failure-injection cases remain)
- `57a85749d` — operator-inspection retirement boundary (success-path probes become zero-side-effect `flag_disabled` assertions)
- `a358d4a43` — repository attribute pin for the byte-addressed baseline fixture
- `3d36783bb` — baseline-doc guard hashes canonical text bytes so Windows checkout EOL policy cannot create a false drift

### Final focused and type gates

```text
pnpm exec vitest run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/product-acceptance-shortfalls.test.ts tests/unit/runtime-memory-baseline-doc-guard.test.ts
4 files / 96 tests passed

node scripts/typecheck-agent-dev.mjs --cache
success=true; node=0, web=0, test=0; errorCount=0

git diff --check
0 findings

scoped ESLint over the five changed memory test files
0 errors / 0 warnings
```

### Residual limitations

- Diff-aware Harness validation still fails closed because the same branch includes the separately merged context-folding surface (135 changed paths relative to `origin/main`) while this task spec only owns the memory closeout paths. `pnpm harness validate --spec harness/specs/tasks/runtime-memory-retirement-closeout.md --no-diff` passes its structural check, but neither result is represented as a full diff-aware Harness pass.
- The retired durable SQLite success paths no longer have end-to-end test coverage because production deliberately cannot activate them. Sanitizer and failure-injection contracts that remain reachable are retained.
- No claim is made that retired Runtime Memory persistence works, that the memory system benefits product behavior, that the full product is GA, or that any real-human evidence exists.
