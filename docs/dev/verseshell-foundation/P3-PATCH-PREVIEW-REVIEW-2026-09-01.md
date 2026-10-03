# TF-0067 / VS-P3-01 独立复核记录 — 2026-09-01

- 复核员：lane-1（独立审核，无实现方会话上下文）
- 复核对象：`50541567d..c8362b31d`，9 个提交（均带 `Task: TF-0067 / Lane: lane-2`）
- 分支：`feat/runtime-lifecycle-governance`
- 契约：`harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md`
- 边界：`harness/specs/rules/verseshell-patch-preview-journal-bridge-boundary.md`
- 结论：**不通过** —— 见 **§9**。

> **阅读顺序提示：先读 §9。**
> §1–§8 是第一轮复核，结论为"通过"；**§9 用真实运行时的实测推翻了它**。
> §1–§8 的读数本身仍然成立，予以保留是为了让"一整套绿灯为什么没能抓到主干失效"
> 这件事本身可被下一个人复现——而不是把它抹掉。凡 §1–§8 与 §9 冲突处，**以 §9 为准**。

本记录中的每个数字均由复核员自行重新取得，不转述实现方自述。

---

## 1. 门禁读数（全部由复核员重跑）

Windows 下每条命令均带 `PYTHONUTF8=1 PYTHONIOENCODING=utf-8`。

### 1.1 修复前（pristine HEAD = c8362b31d，工作树干净）

| 门 | 读数 | 判定 |
|---|---|---|
| `harness validate --since 50541567d` | **FAIL** — 16 个 `.agent-workbench/task-forest/*` 未被 touchedAreas 覆盖 | 见 F-1 |
| verseshell config | 18 files / **2 failed \| 165 passed (167)** | 2 项为既有失败 |
| agents-core（4 个指定文件） | 4 files / **50 passed (50)** | PASS |
| unit-fast | 67 files / **501 passed (501)** | PASS |
| agents-tools `write-journal.test.ts` | 1 file / **19 passed (19)** | PASS |
| 根 unit（uas-04 / config-schema-parity / dcs-prod-flags / generate-catalogs） | 4 files / **147 passed (147)** | PASS |
| `tsgo:core` | 0 error | PASS |
| `typecheck:node` (tsc) | 0 error | PASS |
| `typecheck:test` (tsc) | 0 error | PASS |
| `check:loc` | **FAIL** | 既有，见 1.3 |
| `git diff --check` | clean（仅 LF→CRLF warning，exit 0） | PASS |

### 1.2 修复后（含本记录 §3 的两处修复）

| 门 | 读数 |
|---|---|
| `harness validate --since 50541567d` | **`Spec is valid`** |
| verseshell config | **2 failed \| 166 passed (168)**（+1 = 新增守卫测试） |
| unit-fast | **502 passed (502)**（+1 = 同一测试，该文件同属 unit-fast 与 verseshell explicit include） |
| agents-core（4 个指定文件） | **50 passed (50)** |
| agents-tools `write-journal.test.ts` | **19 passed (19)** |
| 根 unit（4 文件） | **147 passed (147)** |
| `tsgo:core` / `typecheck:node` / `typecheck:test` | 均 0 error |
| `git diff --check` | clean |

### 1.3 既有失败的独立确认（不记到本任务头上）

- **verseshell 的 2 项**：`governed-exec-runtime.test.ts` 两条 rollout 用例，实际报
  `SessionAdmissionIdentityError: unable to resolve agentId for admission identity kind-mist`
  而非期望的 `VERSESHELL_OPERATION_CATALOG_DIGEST`。
  确认方式：这 2 项是复核员在**动任何文件之前**、工作树 `git status` 干净的 pristine HEAD 上
  第一次运行 verseshell config 就取得的读数，与修复后完全同集合。即"同一状态复跑"已满足，
  无需额外 stash。
- **`check:loc` FAIL**：越限文件为 `src/agents/tools/write-journal.ts`（718 行）与
  `src/agents/apply-patch.ts`（680 行）等。这两个文件**不在** `50541567d..HEAD` 的
  20 个非生成物改动文件之内（见 §4），故为既有。
  本任务全部新增/改动源文件均在 500 行天花板之下，最大者 `patch-preview.test.ts` 479 行；
  实现文件最大者 `patch-preview.ts` 407 行。判定：`check:loc` 的失败与本任务无关。
- 未观察到 durable-helper / rc02-shadow-census / rc04-exec-approval-wiring 组的波动
  （本轮所跑的配置未包含它们）。

---

## 2. 独立复现的变异探针

规则：按字节备份 → 变异 → 确认目标测试变红 → 还原 → `sha256sum -c` 校验一致。

### 探针 A —— 分页 baseline 的哈希校验（torn-stitch 守卫）

- 目标：`patch-preview-contract.ts:220` `baselineMatchesHash`
- 变异：函数体改为 `return true;`（哈希校验失效）
- 结果：**变红**。`patch-preview-baseline.test.ts:229`
  `refuses a stitch that does not hash back to the file` 失败 —
  `expect(fake.calls.some(call => call.op === "file.diff")).toBe(false)` 得到 `true`，
  即被撕裂的 baseline 会去请求 diff。`1 failed | 6 passed (7)`
- 还原：`sha256sum -c` OK

### 探针 B —— AC-3 的「记录 → 提交闸门」那一段

- 目标：`apply-patch-preview-binding.ts:253` `verifyPatchPreviewBinding` 的 `diffArtifacts` 回传
- 变异：删除该展开项（闸门不再从记录读回 artifact）
- 结果（**含一次复核员自身的路由错误，如实记录**）：
  - 先在 `patch-preview-artifacts.test.ts` 上跑 → **全绿（3 passed）**，未捕获；
  - 再跑 unit-fast 全量 → **501 全绿**，仍未捕获；
  - 经 `getUnitFastTestFiles()` 查 membership 确认
    `apply-patch-preview-binding.test.ts` **不属于 unit-fast**，而路由到 **agents-core**；
  - 改用 agents-core 重跑 → **变红，2 项失败**，
    `apply-patch-preview-binding.test.ts:339` 断言 `result.journal?.preview` 少了
    `diffArtifacts`。`2 failed | 14 passed (16)`
- 还原：`sha256sum -c` OK
- **判定：守卫是实的，非空守卫。** 但这次误判恰好实证了契约正文 §测试路由 所警告的
  "一条命令可以名列多个文件却静默只跑其中几个"——它是真的会绊倒人的。这不是缺陷，
  是对该节警告有效性的一次独立确认。

### 探针 C —— 复核员自己那处修复的守卫（见 §3 F-2）

- 目标：`patch-preview-baseline.ts:89`
- 变异：`if (baselineMatchesHash(first.text, hash))` → `if (true)`
- 结果：**变红**，新增测试 `refuses a window that does not say how long the file is` 失败
- 还原：`sha256sum -c` OK（`2dfaf725f9ac5039d1e9f08ec423781a357ebbf124155f9b4f854246bc9955a0`）

---

## 3. Findings

### F-1（已由复核员修复）：`harness validate` 无法通过

- **事实**：在 pristine HEAD 上 `pnpm harness validate --spec ... --since 50541567d` 退出非零，
  报 16 个 `.agent-workbench/task-forest/**` 文件未被 `touchedAreas` 或 `ownedPaths` 覆盖。
- **坐标**：`harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md:7-41`（touchedAreas 块）
- **为什么是缺陷**：`harness validate` 是本节点 `requiredTests` 中列明的门。它红着，
  节点就不能收口。并且这不只是最后那个 handoff 提交造成的：
  `30c874b58`（13 个 workbench 文件）与 `a4f8b0853`（6 个）都在范围内，
  也就是说自 `30c874b58` 起该门一直是红的，而非交接时才出现。
- **为什么在复核员修复范围内**：这是对既有仓库约定的偏离，不是新设计。
  同族 spec `harness/specs/tasks/verseshell-foundation-governance.md:13` 已使用完全相同的
  一行声明 `.agent-workbench/task-forest/**`。且 §R3.1.1 本就把 Task Forest 生成物排除在
  半径之外，声明它与该规则意图一致。
- **修复**：在 touchedAreas 末尾追加 `.agent-workbench/task-forest/**`。
- **机械可核对判据**：
  `pnpm harness validate --spec harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md --since 50541567d`
  输出 `Spec is valid: ...` 且退出 0。**已达成**。

### F-2（已由复核员修复）：`total_lines` 缺席时，500 行前缀被当作整份文件

- **事实**：`file.read_range` 的响应若不带 `total_lines`，第一个窗口会被无条件当作
  完整 baseline 接受（`truncated: false`），继而产出 diff 并 `commitEligible: true`。
- **坐标**：`openclaw_runtime/src/agents/verseshell/patch-preview-baseline.ts:83`（修复前）

  ```ts
  if (first.totalLines === undefined || first.totalLines <= MAX_BASELINE_LINES) {
    return { exists: true, hash, text: first.text, truncated: false };
  }
  ```

- **为什么是缺陷**：`total_lines` 是**外来运行时输出**，不是本地可证之物；仓库内除本任务
  代码外无任何位置定义或消费该字段（`grep -rn "total_lines"` 在 `shared/`、
  `openclaw_runtime/src/`、`electron/` 中除 patch-preview 外零命中），即其存在性完全是假设。
  该假设不成立时代码选择了**fail-open**方向。对一份 1200 行的文件，第一个窗口是 500 行前缀，
  尾部 700 行被静默丢弃，而输出看起来完全正常。这直接命中：
  - forbiddenPatterns「越界后仍读前缀充当整份文件」
  - 边界规则「不得读前缀充当整份文件，也不得截断后当成完整 diff 输出」
  - success_metric「stale write 漏检 0」
  既有测试无一覆盖该分支（`grep total_lines` 在 baseline 测试中仅 1 处，且是**提供**该字段）。
- **为什么在复核员修复范围内**：这是实现与既有边界契约正文的偏离，修复只复用既有 helper
  (`baselineMatchesHash`) 与既有 reason (`unreadable`)，不新增表面、不新增 reason code、
  不改协议正文。且方向上**只增加拒绝**，符合「本机制只增加拒绝，不改变既有语义」。
- **修复**：`total_lines` 缺席时不再假定完整——先用该目标自己的 `file.hash` 证明这一个窗口
  就是整份文件；证得则照常使用，证不得则 `baselineTruncated` + `baselineReason: "unreadable"`，
  不产 diff、不可提交。`total_lines` 存在时（即真实运行时的正常情形）行为逐字节不变。
- **机械可核对判据**：`patch-preview-baseline.test.ts` 中
  `refuses a window that does not say how long the file is` 通过；
  且把 `patch-preview-baseline.ts:89` 的条件改为 `true` 时该测试变红（探针 C 已验）。**已达成**。

### F-3（**不修**，另立节点）：effect receipt 的 sink 永久锁定为 null

- **事实**：`resolveSink()` 在 `new EffectReceiptStore()` 抛错时把 `cachedSink` 置为 `null`，
  而入口判定是 `if (cachedSink !== undefined) return cachedSink;`——一旦落到 `null`，
  此后整个进程生命周期内**不再重试、不再构造、不写任何收据、且无任何日志**。
- **坐标**：`openclaw_runtime/src/agents/apply-patch-effect-receipt.ts:179-188`
- **可达性**：`EffectReceiptStore` 的构造函数不是惰性的——
  `effect-receipt.ts:217-220` 在构造时即调用 `ensureEffectReceiptsShape(options)`，
  会真正触碰 SQLite。因此构造失败可以是**瞬态**的（state dir 尚未就绪、DB 被锁），
  而非只有确定性的 import 失败。一次瞬态失败即把该进程变为"静默永不写收据"。
  注意 `recordApplyPatchEffectReceipt` 自己的 catch **不**回写 `cachedSink`，
  所以 insert 抛错不会致锁——致锁的只有构造失败这一条路径。
- **为什么这算缺陷**：它把一个可恢复的瞬态故障升级为永久审计丢失，且零可观测性。
  这恰是本节点 S1 与 AC「The receipt is proven to land, not merely to have a call site」
  所针对的那一类失败模式——`apply-patch-effect-receipt.store.test.ts` 的头注释自己写明
  "`effect_receipts` sat at 0 rows for weeks while the schema, the tests and the store all
  existed"。F-3 是同一个"零行"故障的一条仍然敞开的再现路径。
  另一方面，缓存 null 所省下的开销近乎为零：ESM import 本就有模块级缓存，
  重复构造只是再跑一次幂等的 `ensureEffectReceiptsShape`。
- **为什么复核员不修**：收口它需要**新的设计决策**——重试节奏（每次 / 退避 / 上限）、
  是否记日志、日志级别与限流。这些都不是既有契约里已有的答案，属于"新的设计决策或新表面"，
  按复核章程应另立节点而非由审核员就地裁定。
- **机械可核对判据（留给后续节点）**：新增一个测试，令 `resolveSink` 的首次构造抛错、
  第二次可成功，断言第二次 `recordApplyPatchEffectReceipt` 之后
  `new EffectReceiptStore().listByApproval(...)` 有 1 行；
  且该测试在 `apply-patch-effect-receipt.ts` 的 sink 缓存恢复为粘性 null 时变红。
- **处置**：不在 TF-0067 内修复。fail-open 语义本身是 AC 明确要求的、且工作树与
  apply_patch 结果确实不受影响，故不构成本节点的 FAIL；作为独立缺陷另行开节点。

---

## 4. §R3 半径（双读数，复核员独立复算）

- **全量读数：36**（`git diff --stat 50541567d..HEAD` 报 `36 files changed`）
- **判定读数：20**（36 − 16 个 `.agent-workbench/task-forest/*` 生成物，§R3.1.1 排除）
- brb-L 上限：**40**
- 判定：**20 ≤ 40，通过**（即便按全量 36 亦在档内）
- 与实现方自述（全量 36 / 判定 20）一致——此为独立复算所得，非转述。
- 复核员自身改动引入的增量：`patch-preview-baseline.ts`、`patch-preview-baseline.test.ts`、
  spec 三者均已在原 20 之内；新增仅本记录 1 个文件 → **判定读数 21**，仍在档内。

---

## 5. 逐条判定

### 5.1 acceptance_criteria（以节点自身为准）

#### AC-1 「precondition conflict、concurrent mutation、failed commit、abort、undo、restart recovery 测试通过」——**PASS**

六案逐案定位，并区分本轮新补与既有覆盖：

| 案 | 测试 | 来源 |
|---|---|---|
| precondition conflict | `patch-preview.test.ts` 的 add-over-existing / missing-target；`apply-patch-preview-binding.test.ts:135` `refuses an unknown id, an ineligible preview, and a drifted digest` | 既有 |
| concurrent mutation | `apply-patch-preview-binding.test.ts:205` `refuses and writes nothing when the target moved after the preview` | 既有 |
| failed commit | `write-journal.test.ts` 的 rollback 路径 + `apply-patch-consistency.test.ts` | 既有 |
| **abort** | `patch-preview-baseline.test.ts:240` `aborts between windows...`（preview 分页中途）+ `apply-patch-preview-binding.test.ts:348` `leaves the workspace byte-identical and no prepared batch behind`（写入路径） | **本轮新补**（04670acc7） |
| **undo** | `apply-patch-preview-binding.test.ts:380` `restores the pre-commit content through the one journal that committed it` | **本轮新补**（04670acc7） |
| restart recovery | `write-journal.test.ts:531` `rehydrates prepared apply_patch batches and persists recovery_required` | 既有 |

对"既有四案确实覆盖而非顺带"的确认：precondition conflict 与 concurrent mutation 两案的
断言直接落在 `verifyPatchPreviewBinding` 的拒绝分支上（探针 B 证明该模块的断言是实的）；
restart recovery 的测试名与断言直接点名 `prepared` 批次的 rehydrate 与
`recovery_required` 落盘，不是顺带经过。abort 案要求的"mid-paging 与写入路径两处"两处皆有。

#### AC-2 「仅 ClawX journal 可提交」——**PASS**

- **闸门在请求发出之前生效**（结构核，非只看测试）：
  `patch-preview.ts:104-107`，`request()` 的**第一条语句**即
  `if (!isPatchPreviewOperationAllowed(op)) throw ...`，位于 `await this.client()`
  与 `execute()` 之前。客户端连解析都不会发生。
- **拒绝集合与 reviewed profile 同源**：`patch-preview-contract.ts:36-45` 的两个 Set 直接来自
  `policy-profile.ts` 的 `PATCH_PREVIEW_DEFINITION`，不接受调用方传入。
  profile 实测：`operations` 恰为 `["file.diff","file.hash","file.read_range"]`；
  `capabilities` 恰为 `["file.read"]`；`denied_operations` 含全部 5 个写入 op
  （apply_patch/copy/delete/edit_range/move/remove/replace_exact/write 共 8 条）
  与全部 6 个 `tx.*`（begin/commit/restore/rollback/savepoint/status）。
- **通用写入路径无 verseshell import**（grep 自证，未读注释）：

  ```
  grep -rn "verseshell" openclaw_runtime/src/agents/apply-patch*.ts \
      openclaw_runtime/src/agents/tools/write-journal.ts \
      openclaw_runtime/src/agents/tool-display-apply-patch.ts
  → 零命中（exit 1）
  ```

#### AC-3 「diff artifact 与 approval/change summary 关联」——**PASS**

四段链路逐段核：

1. **preview 记录**：`patch-preview.ts:313` `normalizeDiffArtifacts(diffs.map(e => e.artifact))`
   → `:335` 仅在非空时写入记录。测试 `patch-preview-artifacts.test.ts:93/107/131`
   分别覆盖"有 handle"、"无 handle 时整个字段缺席"（而非空数组）、"去重排序"。
   "没有归档 diff" vs "归档为空"两种断言确实可分辨。
2. **提交闸门**：`apply-patch-preview-binding.ts:248-254` 从**记录**读回。
   探针 B 证明这一段有实测守卫。
3. **journal evidence**：`apply-patch-preview-binding.test.ts:319`
   `carries the handles through a real commit into the journal evidence`。
4. **effect receipt**：`apply-patch-effect-receipt.ts:125,142` → `artifactRef`；
   `:137` 完整未截断清单进 `proposal.diffArtifacts`（被 `proposal_digest` 承诺）；
   `joinArtifactRefs` 以 `+N` 标注截断，512 字符界。

**实现方点名的第 1 点（结构性断言，按结构核）**：
`verifyPatchPreviewBinding` 的入参类型为
`{ previewId: string; entries: readonly ChangeSummaryEntry[] }`
（`apply-patch-preview-binding.ts:224-227`）。`ChangeSummaryEntry`
(`:34-42`) 的字段为 `path / change / baseHash / postHash / movePath?`。
**两层结构中都不存在任何可以让调用方指定 artifact 的通道**，
返回值中的 `diffArtifacts` 唯一来源是 `record.diffArtifacts`。
判定：结构上成立，不是"测试恰好绿"。

### 5.2 requirements

| # | 内容 | 判定 | 依据 |
|---|---|---|---|
| 1 | adapter 只使用 VerseShellAciClient / journal API / policy API | **PASS** | `grep -nE "child_process\|spawn\|fetch\(\|http\|MCP\|McpClient"` 在 `patch-preview*.ts` 零命中；profile `native_fallback: false`、`command_policy: "none"` |
| 2 | 预计算、queue/lease、recovery 复用既有 write journal | **PASS** | 闸门位于 `applyPreparedBatch` 第一次写入前且仍持全部 lease；无第二状态机；AC-1 restart recovery 走既有 `write-journal.ts` |
| 3 | 不声称跨文件系统真实原子事务 | **PASS** | profile `commit_authority: "clawx-write-journal"`；`PatchPreview.verseShellTransaction = "denied"`；边界规则第 2 条已把 `tx.*` 记为永久拒绝 |

### 5.3 non_goals

| # | 内容 | 判定 | 依据 |
|---|---|---|---|
| 1 | 目录删除恢复 | **PASS**（未触碰） | 改动集内无目录级删除/恢复逻辑 |
| 2 | external command write transaction | **PASS** | 无 spawn/child_process；`command_policy: "none"` |
| 3 | 第二 journal | **PASS** | 无 `tx.*` 启用；preview store 是 32 条上限的进程内 Map，显式定位为闸门缓存而非记录，且不含 commit/undo/状态机 |

### 5.4 success_metrics

| # | 内容 | 判定 | 依据 |
|---|---|---|---|
| 1 | 无 journal 的 commit 0 | **PASS** | 唯一提交权威为 ClawX journal；bridge 侧全部写入/事务 op 在请求前被机械拒绝 |
| 2 | 静默 partial mutation 0 | **PASS** | 闸门拒绝时释放全部 lease 并丢弃 prepared 快照，测试断言"工作树逐字节不变且无残留 prepared 批次" |
| 3 | stale write 漏检 0 | **PASS（修复后）** | 修复前 F-2 是一条真实漏检路径（前缀充当整份文件 → digest 基于错误 baseline → 漏检）。已按 §3 F-2 收口并加守卫测试 |

### 5.5 desired_outcomes

| # | 内容 | 判定 | 依据 |
|---|---|---|---|
| 1 | patch preview 不直接提交 | **PASS** | `commitAuthority: "clawx-write-journal"`；deny 闸门在请求前；无 `tx.*` |
| 2 | commit 前有 baseline hash / operation id / change list | **PASS** | 逐目标 `baseHash`（file.hash）、`previewId`、`summary` 的 A/M/D 清单与 `changeSummaryDigest` |
| 3 | journal commit/undo/stale-write guard 可审计 | **PASS** | RC-04 effect receipt 一批次一行、幂等键、digest-only、`artifact_ref`；`store.test.ts` 以真实 store 实证落行而非仅有调用点。**附注**：F-3 是该可审计性的一条仍敞开的退化路径，已另立节点 |
| 4 | 并发/失败/abort/undo 有确定状态 | **PASS** | 见 AC-1 六案表；`recovery_required → unknown`（非 `applied`），停在 `needs_reconciliation` 且不自动重放 |

---

## 6. 复核员**不**接受升级的范围性边界

以下各项本次**不**判 FAIL，理由写明，避免下一个人把它们读成已交付或被漏掉：

1. **无人工确认 UI**。节点的 requirements / acceptance_criteria / success_metrics /
   desired_outcomes 中没有任何一条要求人类可见面（AC-3 要求的是"关联"，
   desired_outcome-2 要求的是 commit 前有 hash/id/change list）。人工审批走既有
   exec-approval 平面，已按用户裁决挂 M6/round-2。**不因"没有 UI"判 FAIL。**
2. **`tx.commit` 保持永久拒绝**。本次复核未启用、未放宽任何 `tx.*`；
   重开条件（ClawX write journal 整体所有权更替）已写在边界规则第 2 条，不是空条款。
3. **preview store 的非持久性**。32 条上限的进程内 Map、重启即失，是**刻意**的闸门热路径缓存；
   审计记录职责已移交 RC-04 receipt。不判为"第二 journal"。
4. **既有 `check:loc` 失败**。`write-journal.ts` / `apply-patch.ts` 超限属既有，
   两文件均不在本范围改动集内，不在本节点收口条件内。
5. **既有 `governed-exec-runtime.test.ts` 2 项失败**。pristine HEAD 即失败，不记本任务。
6. **`file.hash` 与「行拼接文本」的哈希语义等价性**，本次**无法**在真实运行时上验证
   （无 live runtime）。若真实 `file.hash` 是对原始字节（含 CRLF）取哈希，
   则分页路径的 `torn-stitch` 校验会对所有文件恒假、preview 对大文件恒不可用——
   那是**fail-closed** 方向的退化（不可用，而非不诚实），因此不构成安全缺陷，
   但会让分页片实际失效。此风险同等适用于实现方已交付的分页路径与复核员的 F-2 修复，
   不作为本节点 FAIL，如实记录供后续联调时优先验证。

---

## 7. 由审核员自实现、无独立复核的修复

> **以下修复由审核员自实现，无独立复核。**
> §R1.0.1 挡的是实现者自审；复核员修完自己点名的 finding，就成了那段代码的实现者。
> 这个取舍在此写在明处，不默默发生。判例：XL-007 中 lane-2 复核 TF-0138 时直接改写
> TF-0129 的 AC-1 并写明"不留给下一个人"。

1. **F-1**：`harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md`
   touchedAreas 追加一行 `.agent-workbench/task-forest/**`。
   —— 无独立复核。判据：`harness validate --since 50541567d` 输出 `Spec is valid` 且退出 0。
2. **F-2**：`openclaw_runtime/src/agents/verseshell/patch-preview-baseline.ts:83-96`
   —— `total_lines` 缺席时改为先以 `file.hash` 证明单窗口即整份文件，证不得则
   `baselineTruncated` + `baselineReason: "unreadable"`。
   —— 无独立复核。判据：新增测试
   `patch-preview-baseline.test.ts` › `refuses a window that does not say how long the file is`
   通过，且 `patch-preview-baseline.ts:89` 条件改 `true` 时变红（探针 C 已验）。
3. **新增测试**：`openclaw_runtime/src/agents/verseshell/patch-preview-baseline.test.ts`
   新增上述 1 条守卫测试。—— 无独立复核。

未由审核员改动、仅记录并另立节点者：**F-3**（effect receipt sink 粘性 null）。

---

## 8. 收口

- 节点 TF-0067 置为 `done` / `progress 100`。
- 半径判定读数 21（含本记录），上限 40，未越档，无需调档上报。
- 本次未改动任何旗标默认值，未启用 `tx.commit` 或任何 `tx.*`，
  未为 patch 新建第二条审批通道，未追溯改写任何已有提交。

---

## 9. 复核结论撤回：对真实运行时的实测推翻 §1–§8 的通过判定

> **本节推翻本记录前八节的结论。TF-0067 判定由「通过」改为「不通过」。**
> 前八节的每个读数本身都成立，但它们全部建立在一个未经��验的前提上：
> 测试替身（fake responder）如实反映了真实运行时的响应契约。**该前提是假的。**

### 9.1 §6.6 的"无法验证"是可以验证的——我起初放弃得太早

§6.6 我把 `file.hash` 与"行拼接文本"的哈希语义等价性记为"无 live runtime，无法验证"。
这个判断错了。仓库内实际存在可运行的真实运行时：

- `resources/bin/win32-x64/ae.exe`（14,879,232 bytes），由
  `provision-verseshell-binary` 对committed manifest 校验后落盘；
- `governed-exec.real.test.ts:25` 已有 `describe.runIf(win32 && existsSync(binary))`
  的真实二进制用例，pinned catalog digest
  `sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7`，
  `VERSESHELL_OPERATION_CATALOG_COUNT = 31`。

复核员以同一机制起了一次性探针（`VerseShellProcessManager` +
`VERSESHELL_PATCH_PREVIEW_PROFILE_ID`，跑完即删，未提交），
直接向真实运行时索取 `ops.list` / `file.hash` / `file.read_range` / `file.diff`。
探针确认 `ops.list` 返回 `count: 31`，与 pinned catalog 一致——即所测即所用。

注：`verseshell-runtime/` ���录内的 Rust 源码是 **v0.3.0**，不含任何 ACI observation
协议，与 pinned 的 `ae.exe`（`VERSESHELL_RUNTIME_VERSION 1.0.0`）不是同一物，
不能用它来推断 op 契约。

### 9.2 实测所得的真实响应契约

**`file.hash`**（唯一一个实现读对了的 op）

```json
{"bytes":10890,"content_hash":"sha256:dd83c233…","path":"…/big.txt"}
```

`content_hash` 与整份文件**原始字节**的 sha256 逐字符一致（复核员本地独立计算
`dd83c233…` 相同）。—— §6.6 的前半问题就此定案：`file.hash` 是**字节哈希**。

**`file.read_range`**（3 行小文件，单窗口路径）

```json
{"content_hash":"sha256:3eca7ea4…","end_line":3,
 "lines":[{"line":1,"text":"alpha"},{"line":2,"text":"bravo"},{"line":3,"text":"charlie"}],
 "path":"…/small.txt","start_line":1,"total_lines":3,"truncated":false}
```

- 正文字段名是 **`lines`**，且是**对象数组** `{line, text}`，**不是**字符串。
- **不存在 `text` 字段，也不存在 `content` 字段。**
- `total_lines: 3` —— 对 `"alpha\nbravo\ncharlie\n"` 而言是 Rust `.lines()` 语义
  （不计尾随空行）；实现假定的 `split("\n").length` 是 **4**。
- 运行时**自己**就返回 `truncated` 布尔，实现完全没有读它。

**`file.diff`**

```json
{"content_hash":"sha256:3eca7ea4…","diff":[" alpha","-bravo","+BRAVO"," charlie"],
 "path":"…/small.txt","truncated":false}
```

- `diff` 是**字符串数组**，不是字符串。
- **没有 `handle` 字段，也没有 `artifact` 字段**（大 diff 复测同样没有）。

### 9.3 与实现的逐条对撞

| op | 运行时实际返回 | 实现读取 | 实际结果 |
|---|---|---|---|
| `file.hash` | `content_hash`（字节哈希） | `readString(data,"content_hash","hash")` | ✅ 唯一读对的 |
| `file.read_range` | `lines: [{line,text}]` | `readTextField(data,"text","content")`（`patch-preview-baseline.ts:55`） | ❌ **恒 `undefined`** |
| `file.diff` | `diff: string[]` | `readString(data,"diff","text","unified")`（`patch-preview.ts:139`）——`readString` 要求 `typeof === "string"` | ❌ 恒 `undefined` → `unified: ""` |
| `file.diff` | 无 `handle` | `readString(data,"handle")`（`patch-preview.ts:140`） | ❌ **artifact 恒不存在** |

`normalizeAciObservation` 不做 `lines → text` 转换（`normalizer.ts:73-103` 只校验
artifact handle 与 stdout/stderr stream），且 `request()` 丢弃其返回值、返回原始
observation，故 `observationData()` 看到的就是上表左列。**没有中间层能救。**

### 9.4 后果（这不是边角，是主干失效）

1. **`readTextField` 恒 undefined ⇒ `readRange` 返回 `{}` ⇒ `first.text === undefined`
   ⇒ 每个已存在目标一律 `truncated: true, reason: "unreadable"`。**
   即 **update 与 delete 的 preview 对真实运行时完全不可用**，
   恒报 `conflict: "baseline-unreadable"`、恒 `commitEligible: false`、恒不产 diff。
   只有纯 add（走 `renderAddedDiff`，不需要 baseline）能出结果。
2. **第 3 片（分页 baseline）整体不可达**——它在第一个窗口就因缺 text 返回了，
   永远走不到 `planBaselinePages`。而即便修好字段名，`total_lines` 的 `.lines()` 语义
   与 `stitchBaselinePages` 的 `join("\n")` 对尾随换行差一个字节，
   拼接结果永远哈希不回 `file.hash` ⇒ **恒 `torn-stitch`**。§6.6 的后半问题同样定案：
   该风险是**真的**，不是假设。
3. **AC-3 的 artifact 链恒为空**：`file.diff` 不返回 `handle`，
   `normalizeDiffArtifacts([])` ⇒ `diffArtifacts` 永不写入记录 ⇒
   `artifactRef` 永远缺席。结构上那条链（§5.1 AC-3 四段）确实接通了，
   但**production 中永远不会有任何东西流过它**。
   讽刺的是这恰好落进它自己 §AC-3 的措辞里——"『没有归档 diff』与『归档为空』是两种
   不同的断言"——真实情况是**永远是前者**。
4. **运行时自报的 `truncated` 被完全忽略**，而这本是最直接的诚实信号。

### 9.5 为什么前八节的门禁全绿却没抓到

全部 preview 测试用的是 `fakeClient(cwd, responder)`，responder 由实现方按
**实现自己的假设**编写：`pagedRepo` 返回 `{text, content_hash, total_lines}`，
`file.diff` 返回 `{diff: "@@ paged @@"}`（字符串）、artifact 测试手工塞 `handle`。
于是测试与实现互相印证，形成闭环。

我在 §2 跑的两发变异探针**确实是真守卫**——但它们守的是"实现是否自洽"，
不是"实现是否对得上运行时"。这正是本轮章程警告的那类东西的一个更隐蔽的变体：
**不是空守卫，而是守错了对象的守卫。** 一整套绿灯可以什么都不说明，
只要替身是照着被测代码写的。

**我自己的 F-2 修复也建立在同一个错误模型上**（我用 `baselineMatchesHash(first.text, hash)`）。
方向仍是 fail-closed 因而不使情况变坏，但它在真实运行时下是**不可达代码**。

### 9.6 判定变更

| 项 | §5 原判 | 实测后 |
|---|---|---|
| AC-1（六案，尤其 precondition conflict / concurrent mutation） | PASS | **FAIL** — update/delete preview 对真实运行时不可用，六案仅在替身下成立 |
| AC-2（仅 ClawX journal 可提交） | PASS | **PASS（维持）** — 拒绝闸门与 no-verseshell-import 是纯本地结构事实，不依赖运行时响应 |
| AC-3（diff artifact 关联） | PASS | **FAIL** — 链路结构成立但恒空；`file.diff` 不提供 handle |
| desired_outcome-2（commit 前有 baseline hash / change list） | PASS | **部分 FAIL** — baseline hash 有（file.hash 读对了），change list 对 update/delete 恒缺 |
| success_metric-3（stale write 漏检 0） | PASS | **形式上 PASS** — 因为根本产不出可提交的 preview（fail-closed 的空转，不是能力） |
| 其余（requirements 3、non_goals 3、AC-2 相关） | PASS | 维持 PASS |

**节点结论：不通过。** 已由 done 退回 `in_progress`，progress 由 100 下调至 60。

### 9.7 交回的收口判据（机械可核对，不留模糊）

1. `patch-preview-baseline.ts` 从 `lines: [{line,text}]` 解出正文；
   判据：新增一条**用真实 `ae.exe`** 的 `*.real.test.ts`，对一个 >500 行、
   以换行结尾的文件跑完整 `preview()`，断言 `baselineTruncated === false`
   且 `commitEligible === true`。
2. `total_lines` 按 `.lines()` 语义对齐，使拼接结果能哈希回 `file.hash`；
   判据：同一条真实用例中 `preconditions[0].baselineReason` 不为 `torn-stitch`。
3. `patch-preview.ts:139` 接受 `diff` 为字符串数组；
   判据：真实用例断言 `preview.diffs[0].unified` 非空且含 `-`/`+` 行。
4. AC-3 的 artifact 来源需重新裁定——`file.diff` 不返回 handle，
   现有写法不可能满足。**这是契约级问题，不是实现 bug**：
   要么改由 `data.artifacts`/result 面取得（需确认该 op 是否产 artifact），
   要么修订 AC-3 的措辞。判据：给出结论并落进边界规则，
   且真实用例能断言 `artifactRef` 在应有场景下非空——或 AC-3 明确改写。
5. 运行时自报的 `read_range.truncated` 必须被读取并纳入诚实性判定；
   判据：存在一条断言 `truncated: true` 时不产 diff 的测试。
6. **所有 preview 的 op 解码必须有至少一条真实二进制用例背书**，
   不得只由 fake responder 覆盖——这是本轮失效的根因。

### 9.8 为什么复核员不就地修

按本轮章程："修的是既有行为与既有契约的偏离 → 你修；需要新的设计决策、新的表面、
或改协议正文 → 不修，另立节点。"

第 1–3、5 条属可机械修复的解码偏离，但第 4 条（AC-3 的 artifact 来源）**需要契约级裁定**，
且第 6 条要求重建整条真实二进制测试路径——这是一层新的测试表面，不是一处 finding 的收口。
四者互相咬合：不定 artifact 来源就无法写第 4 条的判据，而只修 1–3 会产出一个
"diff 能出、artifact 永远空"的半成品，恰是本节点 AC-3 已经踩过的坑。
因此整体交回 TF-0067，不由审核员分片自实现。

### 9.9 对 §7 的更正

§7 中由审核员自实现的两处修复维持不变（F-1 使 validate 转绿，仍然必要；
F-2 方向正确且 fail-closed），但须知 **F-2 在真实运行时下是不可达代码**，
它在第 9.7 条第 1 项落地之后才会真正生效。届时应连同复核。
