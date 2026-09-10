# VS-P3-01 三项决策的调研与裁定 — 2026-09-02

- 作者：lane-1
- 前置：`P3-PATCH-PREVIEW-REVIEW-2026-09-01.md` §9、`P3-PATCH-PREVIEW-REPAIR-PLAN-2026-09-02.md`
- 决策项：D1 diff 200 行上限 / D2 AC-3 方案 A 的长期成立性 / D3 receipt sink 粘性 null

调研说明：`anysearch` 的 API key 无效，`WebSearch` 在本会话被 harness 拒绝
（`tool_choice names an undeclared local/server tool`）。可用的是 `WebFetch` 与
仓库内实测。上游 `nervosys/verseshell`（`verseshell-runtime/Cargo.toml:11`）为私有或已移除，
GitHub 上同名 `Sinzunza/VerseShell` 是无关的 C++ 项目。**因此关于运行时的一切结论均取自
pinned 二进制的实测，不取自上游文档。**

---

## D1：`file.diff` 的 200 行上限

### 调研所得

| 来源 | 上限 |
|---|---|
| 运行时 `file.diff`（实测，3000 行文件 / 1500 处改动） | **diff 数组 200 项**，`truncated: true` |
| ClawX 自家 `shared/remote-forge/unified-diff-adapter.ts:14` | **1 MiB / 128 files / 4096 hunks / 120,000 lines** |

关键发现：**ClawX 早已有自己的 unified diff 生成器，且一直在用。**
`src/agents/tools/write-journal.ts:217` 在每次 full-file write 时调用
`generateUnifiedPatch(relPath, beforeContent, expectedContent, 4, ...)`
（`src/agents/sessions/tools/edit-diff.ts:415`），其内部是
`Diff.createTwoFilesPatch`——`diff@9.0.0`，已是 `package.json:1893` 的根依赖。

也就是说"客户端自渲染 diff"不需要新实现算法，也不引入新依赖：**同一个算法在写入侧已经
在生产中跑着**。两侧上限差三个数量级。

### 三个方案与裁定

| 方案 | 评价 |
|---|---|
| 接受上限，仅记录 | 诚实性没问题（`truncated` 已如实上报），但"让复核者看见改了什么"在 >200 行 diff 上直接失效。而 preview 的**全部价值**就是让人在提交前看见改动 |
| **本地渲染（采纳）** | 复用既有 `generateUnifiedPatch`；上限提升三个数量级；无新依赖、无新算法 |
| 等上游放宽 | 上游私有/不可达，工期不可控，且不应阻塞本节点 |

**裁定：采纳本地渲染，但保留 `file.diff` 调用。**

保留的理由不是冗余，而是三条各自独立的：

1. `file.diff` 仍是 reviewed profile 列出的 operation，AC 要求"完整 preview 只请求只读
   operation"——移除它会改动 profile 与该 AC，扩大改动面且无收益。
2. 运行时自报的 `truncated` 是一个独立的诚实性信号，值得继续读。
3. 若将来运行时开始返回 artifact handle（见 D2），这条调用就是现成的接入点。

**但必须标注来源。** 本地渲染的 diff 与运行时观测的 diff 是两种不同的断言：
前者是"ClawX 打算写入什么"，后者是"运行时观测到磁盘与提议文本的差异"。
二者输入相同（hash 证明过的 baseline + 提交闸门绑定的 post-image），因此应当一致；
但把它们混为一谈就是把"意图"说成"观测"。故 `PatchPreviewDiff` 增加
`source: "clawx" | "verseshell"` 字段。

不做 diff-vs-diff 文本比对：两个实现的 context 行数与 hunk 切分启发式不同，
文本几乎不可能逐字相同，比对只会产生噪音。同一性由 `changeSummaryDigest` 承担，
那才是提交闸门真正依赖的关系。

---

## D2：AC-3 方案 A 长期是否站得住

### 调研所得：同构产品的做法

`WebFetch` aider 官方文档（https://aider.chat/docs/git.html）：

> "Persistence happens through git, not a separate store. … aider's durable record is
> ordinary repository history … Diffs appear to be computed views rather than saved files.
> The documentation describes `/diff` as showing 'all the file changes since the last message
> you sent' — output tied to your position in the conversation, not described as a stored
> artifact."

即：**成熟的同类产品并不把 diff 存成 artifact**。耐久记录是 VCS 本身，diff 是随时可算出的视图。

### 调研所得：ClawX 自己的耐久面

`write-journal.ts` 把每次写入的 **pre-image 落盘**为 `<hash>-<base>.pre`
（`:378-383`），并在需要时用 `beforeBytes` / `afterBytes` 现算 diff（`:200-217`）。
清理时机是关键：`discardWriteJournalEntries` 只在 **rollback / undo 之后**调用
（`:439` 的注释写明"Remove journal evidence only after the matching mutation was fully
rolled back"），**committed 的快照留在盘上**。

因此"复核者看过的那份 diff"在重启后是可重建的：
pre-image 在 journal 目录、post-image 就是工作树文件、算法在 `generateUnifiedPatch`。
不依赖任何运行时 artifact handle。

### 裁定

**方案 A 成立，且不只是"迫于运行时能力"的退让，而是与行业主流一致的选择。**

- 关联由 `previewId` + `changeSummaryDigest` 承担：digest 已经绑定每个目标的 pre/post 身份，
  比一个"指向某处渲染结果"的 handle 更强——handle 证明"有人渲染过"，
  digest 证明"渲染的正是这份内容"。
- `artifact_ref` 留 `null` 而非空串，"无归档"与"空归档"仍可分辨。
- `normalizeDiffArtifacts` / `joinArtifactRefs` / `diffArtifacts` 全套保留：
  当前恒空不造成错误断言，且运行时若开始产 handle 即刻生效。

**一处需要补的短板**：上述"可重建"是我核对代码得出的结论，但**没有任何测试锁住它**。
若将来有人把 `discardWriteJournalEntries` 的调用时机改成"committed 也清理"，
D2 的整个论证就悄悄失效而无人知晓。故本轮补一条测试锁住
"committed 批次的 pre-image 快照在提交后仍然存在"。

---

## D3：receipt sink 粘性 null（TF-0148）

### 调研所得：OWASP Logging Cheat Sheet

`WebFetch` https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html：

> Operation: "**Enable processes to detect whether logging has stopped**, and to identify
> tampering or unauthorized access and deletion."
>
> Event collection: "failures in the logging processes/systems **do not prevent the
> application from otherwise running** or allow information leakage."
>
> Verification: "test **the effect on the application of logging failures** such as
> simulated database connectivity loss."
>
> Attacks on Logs — Accountability: "An attacker prevent writes in order to cover their tracks."

两条要求同时成立，且不冲突：**不得阻塞业务**（我们已满足）**且不得静默停止**（我们违反）。

现状（`apply-patch-effect-receipt.ts:179-188`）：`resolveSink()` 构造失败即把
`cachedSink` 置 `null`，入口判定 `cachedSink !== undefined` 使其此后**整个进程生命周期
不再重试、不再构造、无任何日志**。而 `EffectReceiptStore` 构造函数非惰性
（`effect-receipt.ts:217-220` 直接触碰 SQLite），故失败可以是瞬态的。
一次瞬态失败 = 该进程永久静默停写收据 = OWASP 明列的 accountability 失效。

### 裁定：修，且按 OWASP 的两条一起修

1. **不再永久锁定**：区分"确定性失败"与"瞬态失败"过于精细且不可靠——直接不缓存失败态，
   下次调用重新尝试。开销可忽略：ESM import 有模块级缓存，重复的只是幂等的
   `ensureEffectReceiptsShape`。
2. **失败必须可观测**：首次失败记一条 warning（含原因），并对重复失败限流以免刷屏。
   这正是 OWASP "detect whether logging has stopped" 的最小可行形式。
3. 保持 fail-open：仍然绝不影响 `apply_patch` 结果与工作树。

这三条合起来把 TF-0148 从"需要新设计决策"变成"有明确外部规范可依"，
因此**不再需要另立节点**，本轮直接收口，TF-0148 关掉。

---

## 落地清单

| # | 改动 | 依据 |
|---|---|---|
| 1 | preview 本地渲染 diff（复用 `generateUnifiedPatch`），`file.diff` 保留 | D1 |
| 2 | `PatchPreviewDiff.source: "clawx" \| "verseshell"` 标注来源 | D1 诚实性 |
| 3 | 测试锁住"committed 快照在提交后仍存在" | D2 短板 |
| 4 | `resolveSink` 不缓存失败态 + 首次失败告警 + 限流 | D3 / OWASP |
| 5 | 边界规则记录 D1/D2/D3 的结论与理由 | 可引用性 |
| 6 | TF-0148 关闭，理由指向本记录 | D3 |

---

# 执行记录

由 lane-1 自实现，无独立复核（同 REPAIR-PLAN §14 的留痕）。

## 7. D1 落地

- `patch-preview-contract.ts` 新增 `renderLocalDiff`，内部即写入侧在用的
  `generateUnifiedPatch`（`context: 4`）；`renderAddedDiff` 保留给只有 contents 的调用方。
- `patch-preview.ts` 的 `diff()` 改为：先本地渲染，再请求 `file.diff`，**只取它的
  `content_hash`** 与 `handle`。
- **`file.diff` 的作用被重新定义，这是本轮最有价值的一处收获。**
  原先它是 diff 的来源，现在它是一次**并发检查**：它回报的 `content_hash` 严格晚于
  baseline 证明所用的 `file.hash`。两者不一致 ⇒ 目标**在 preview 进行期间**被改动 ⇒
  该 preview 描述的状态已不存在 ⇒ 记 `torn-stitch`、置不可提交。
  这补上了原实现的一个真实盲区：先前只校验"读 baseline 期间"的撕裂，
  "读完 baseline 到出 diff 之间"那段窗口无人看守。
- **不比对两侧 diff 文本**：两个实现 context 与 hunk 启发式不同，文本不可能逐字相同。
- `PatchPreviewDiff` 未新增 `source` 字段。原方案想加，实施时判断它是**多余的**：
  `unified` 现在恒为 host 渲染，没有第二个来源可区分，加一个恒等于 `"clawx"` 的字段
  只会让读者以为存在另一种可能。语义写进类型注释与边界规则即可。
- 真实用例改为断言**完整性**：3000 行 / 1500 处改动的 diff 里
  `+CH-0` 与 `+CH-2999` 同时在场、`truncated === false`——即运行时会丢掉的那最后一行，
  现在在场。

## 8. D2 落地

新增 `apply-patch-preview-binding.test.ts` ›
`keeps the committed pre-image on disk, so the reviewed diff stays derivable`：
提交后断言 `.pre` 快照仍在、内容等于 pre-image、工作树等于 post-image。
D2 的可重放论证从此由测试承担，不再是一句只在文档里成立的话。

## 9. D3 落地

- `resolveSink` 不再缓存失败态，且首次失败记一条 `console.warn`（60 秒限流）。
- `__setEffectReceiptSink` 的类型由 `sink | null | undefined` 收窄为 `sink | undefined`——
  `null` 的唯一用途就是"钉死失败态"，那正是本次要消除的东西。
- 新增 `apply-patch-effect-receipt.store.test.ts` ›
  `recovers after a construction failure instead of going quiet for good`：
  把 state dir 指向一个**文件**使构造真的抛错（实测确认：
  `ENOTDIR: not a directory, mkdir .../blocked/state`），断言该批次 fail-open，
  且下一批次照常落行。
- **TF-0148 可以关闭。**

## 10. 变异探针

| 探针 | 变异 | 结果 |
|---|---|---|
| F | 在 `resolveSink` 的 catch 尾部恢复 `cachedSink = null` | 先在 unit-fast 的注入式用例上跑 → **全绿，未捕获**；改用真实 store 用例 → **变红**。如实记录：注入式替身看不见粘性缓存，因为它压根不走 `resolveSink` |
| H | `setWriteJournalBatchState` 在 `committed` 时删掉 `.pre` | **2 项变红**（新增的保留断言 + 既有 undo 用例） |

探针 F 的第一次失手与探针 B 同源：**替身看不见的东西，替身写的测试也守不住**。
这是本轮第三次遇到同一类问题，故已作为通则写进边界规则。

## 11. 门禁读数

| 门 | 读数 |
|---|---|
| `harness validate --since 50541567d` | **Spec is valid** |
| verseshell | **180 passed / 2 既有失败**（182） |
| └ `patch-preview.real.test.ts` | **13 passed** |
| unit-fast | **502 passed**（−1：删掉了 `tolerates an absent store`，它断言的正是被消除的行为） |
| agents-core（指定 4 文件） | **52 passed**（+2：保留断言 + 恢复断言） |
| write-journal | 19 passed |
| 根 unit（4 文件） | 147 passed |
| `tsgo:core` / `typecheck:node` / `typecheck:test` | 均 0 error |
| `check:loc` | 本任务文件无超限（`patch-preview.test.ts` 又顶到 506，已压到 491） |
| `git diff --check` | clean |

## 12. 调研可用性的如实记录

`anysearch` 返回 `invalid_api_key`；本会话 `WebSearch` 被 harness 拒绝
（`tool_choice names an undeclared local/server tool`）。实际用到的是 `WebFetch`
（aider 文档、OWASP cheat sheet）与仓库内实测。上游 `nervosys/verseshell` 私有或已移除，
GitHub 同名仓库为无关 C++ 项目——**故运行时结论一律来自 pinned 二进制实测**，
这也是本轮唯一可靠的来源。
