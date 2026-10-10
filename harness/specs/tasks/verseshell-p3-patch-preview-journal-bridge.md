---
lifecycleStatus: archived
id: verseshell-p3-patch-preview-journal-bridge
title: VerseShell P3-01 Patch Preview 与 ClawX Journal Bridge
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 让 patch 改动在 VerseShell 上只产生 preview、base hash、precondition 与 diff artifact，ClawX write journal 保持 commit/undo/stale-write guard/recovery 的唯一 authority，不引入第二个 VerseShell transaction owner。
touchedAreas:
  - harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md
  - harness/specs/rules/verseshell-patch-preview-journal-bridge-boundary.md
  - openclaw_runtime/src/agents/verseshell/patch-preview.ts
  - openclaw_runtime/src/agents/verseshell/patch-preview-contract.ts
  - openclaw_runtime/src/agents/verseshell/patch-preview-baseline.ts
  - openclaw_runtime/src/agents/verseshell/patch-preview.test.ts
  - openclaw_runtime/src/agents/verseshell/patch-preview.real.test.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/patch-preview-baseline.test.ts
  - openclaw_runtime/src/agents/verseshell/patch-preview-artifacts.test.ts
  - openclaw_runtime/src/agents/apply-patch-preview-binding.ts
  - openclaw_runtime/src/agents/apply-patch-preview-binding.test.ts
  - openclaw_runtime/src/agents/apply-patch-effect-receipt.ts
  - openclaw_runtime/src/agents/apply-patch-effect-receipt.test.ts
  - openclaw_runtime/src/agents/apply-patch-effect-receipt.store.test.ts
  - openclaw_runtime/src/agents/tool-display-apply-patch.ts
  - openclaw_runtime/src/agents/tool-display-apply-patch.test.ts
  - openclaw_runtime/src/agents/tool-display-common.ts
  - openclaw_runtime/src/agents/tool-display-config.ts
  - openclaw_runtime/src/agents/apply-patch-preflight.ts
  - openclaw_runtime/src/agents/apply-patch-preflight-support.ts
  - openclaw_runtime/src/agents/apply-patch-paths.ts
  - openclaw_runtime/src/agents/apply-patch-types.ts
  - openclaw_runtime/src/agents/apply-patch.ts
  - openclaw_runtime/src/agents/verseshell/policy-profile.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - openclaw_runtime/src/agents/verseshell-foundation-flags.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - shared/dcs/prod-flags-catalog.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - electron/utils/verseshell-runtime-request.ts
  - docs/dev/verseshell-foundation/P3-PATCH-PREVIEW-REVIEW-2026-09-01.md
  - docs/dev/verseshell-foundation/P3-PATCH-PREVIEW-REPAIR-PLAN-2026-09-02.md
  - docs/dev/verseshell-foundation/P3-DECISIONS-2026-09-02.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - patchPreview flag 默认关闭时，model tool surface 不出现 preview_patch。
  - 任一前置 gate（verifiedRuntime / typedAci / facade / governedExec / artifactResults）关闭或 kill switch 生效时，preview_patch 不物化。
  - 显式启用后 preview_patch 只读：逐目标返回 base hash、precondition、change summary digest 与 unified diff，且不写入任何文件。
  - 新增目标已存在报 add-over-existing，删除目标缺失报 missing-target。
  - baseline 超出单次 ranged-read 上限时按窗口分页读满整份文件；重建结果必须先与 `file.hash` 对齐才可使用。
  - 超过运行时自身 diff 上限的改动，preview 仍给出完整 unified diff（host 侧渲染）。
  - preview 期间目标被改动时（`file.diff` 回报的 content_hash 与 baseline 不符）报 torn-stitch 且不可提交。
  - effect receipt store 打不开时下一批次重试而非永久静默，且失败可见。
  - 超出分页预算（窗口数或字节数）、任一窗口读不到、或拼接结果哈希不符时，报 baselineTruncated 加对应 baselineReason（over-cap / unreadable / torn-stitch）且不产出 diff、不可提交。
  - patch 中的绝对路径、`..` escape、NUL、超长文本与超量路径在任何 runtime 请求之前 fail-closed。
  - 每个 apply_patch 批次在产出 journal evidence 时记一条 effect receipt，且只在产出时记：journal 关闭即无 receipt，不引入第二个旗标。
  - receipt 写不进去（store 打不开或 insert 抛错）不改变 apply_patch 的结果，也不改变工作树。
  - 未经 preview 的写入不带 approvalId、不带 approvalDecision；recovery_required 记为 unknown 而非 applied。
  - apply_patch 的显示行给出 patch 声明的 A/M/D 目标；带 preview_id 时额外标注，畸形 patch 不抛错也不显示误导性摘要。
  - `file.hash` 的非 E_NOT_FOUND 错误上抛，不被读作「目标不存在」。
  - apply_patch 不带 preview_id 时行为与既有完全一致；带 preview_id 时写日志在第一次写入之前重算 change summary digest。
  - preview 后目标被他人改动、patch 结果不同、preview_id 未知或该 preview 自称有冲突/截断时，commit 被拒绝且工作树逐字节不变。
  - 被拒绝的 commit 释放全部 target lease 并丢弃 prepared 快照，不留下悬挂锁或 prepared 批次。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - coding-mutation-consistency-boundary
  - comms-regression
  - renderer-main-boundary
  - verseshell-foundation-p0-boundary
  - verseshell-process-lifecycle-boundary
  - verseshell-readonly-facade-boundary
  - verseshell-patch-preview-journal-bridge-boundary
forbiddenPatterns:
  - 默认开启 patchPreview 或修改 liveReady/productApproved/defaultOn
  - 从桥接面请求 file.apply_patch、file.write、file.edit_range、file.replace_exact、file.remove 或任何 tx.* operation
  - 在 VerseShell 侧建立第二个 journal、undo 栈、batch 状态机或 stale-write guard
  - 用截断的 baseline 产出被当作完整结果的 diff
  - 把未经 file.hash 证明的拼接 baseline 当作完整 baseline 使用
  - 分页读取不设窗口数与字节数上限，或越界后仍读前缀充当整份文件
  - 把 file.hash 的非 E_NOT_FOUND 失败降级为「目标不存在」
  - 由调用方提供期望 digest（只接受不可伪造的 previewId；digest 必须由 host 侧 preview 记录）
  - preview 不匹配时就地和解、修补或改用较新意图提交
  - 在 apply-patch 通用写入路径里 import 任何 verseshell 模块
  - 为 preview 新建第二条审批通道，或在 approval_ledger 里为一次无人工决策的写入登记 approved
  - 让 effect receipt 的写入失败影响 apply_patch 的结果或工作树
  - adapter 内 spawn、child_process、MCP client、Gateway HTTP 或 native fallback
  - 只补部分配置面（type/zod/labels/help/runtime-feature-leaves 必须同步）
  - 新增旗标不进 shared/dcs/prod-flags-catalog.ts —— §R1 A4 的第四处（运维目录）是「该旗标处于什么 rollout 阶段、默认为何如此」的唯一落盘位置，缺它等于把设计意图留成无法引用的口头解释（XL-008 判例）
featureFlags:
  - patchPreview remains explicit opt-in and independently fail-closed with verifiedRuntime, typedAci, facade, governedExec, artifactResults, and the kill switch.
rollback:
  - Disable the patchPreview flag; preview_patch disappears and apply_patch plus its write journal are unchanged.
  - Keep the tool absent whenever any readiness, policy, or catalog contract is unavailable; never add a fallback inside the adapter.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p3-patch-preview-journal-bridge.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-core.config.ts --maxWorkers=1 src/agents/apply-patch-preview-binding.test.ts src/agents/apply-patch.test.ts src/agents/apply-patch-consistency.test.ts src/agents/apply-patch-effect-receipt.store.test.ts
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.unit-fast.config.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-tools.config.ts --maxWorkers=1 src/agents/tools/write-journal.test.ts
  - pnpm exec vitest run tests/unit/uas-04-coding-mutation-consistency.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run typecheck:node
  - git diff --check
acceptance:
  - The reviewed clawx-patch-preview-v1 profile lists only file.diff, file.hash, and file.read_range, holds only the file.read capability, and enumerates every mutation and tx.* operation as denied.
  - A single mechanical gate refuses denied and unlisted operations before any request leaves the adapter, and a full preview run requests read operations only.
  - Preview output carries per-target base hashes, preconditions, conflicts, and a change summary digest bound to the pre/post identity of every target; commit, undo, and recovery stay with the ClawX write journal.
  - Truncated baselines, missing targets, and non-not-found hash failures are reported honestly instead of being smoothed into a diff.
  - Focused tests cover the denied-operation boundary, update/add/delete previews, conflicts, bounds, digest stability, and default-off tool construction; the truncation guard has an observed regression probe.
  - The commit gate lives in the generic apply_patch path with no VerseShell import, recomputes the digest from what preflight itself read, and refuses on unknown id, ineligible preview, or any drift — leaving the workspace byte-identical, the leases released, and the prepared snapshots discarded.
  - A verified commit records the previewId and digest as write-journal provenance; a patch applied without a previewId behaves exactly as before, proven by the unchanged existing apply_patch, write-journal, and UAS-04 suites.
  - The preview sequences a batch the way the write path does: a second hunk on a path sees the first hunk's result, every hunk binds against the same pre-batch identity, and one diff per path reports the cumulative post-image rather than an intermediate one.
  - A baseline past the single-read cap is read in bounded windows that tile the file with no gap and no window over the runtime's own cap, and the rejoined text is accepted only after it hashes to the digest `file.hash` reported for that target.
  - Every paging failure — over the window or byte budget, an unreadable window, or a stitch that does not hash back — reports `baselineTruncated` with a named `baselineReason`, requests no diff, and stays commit-ineligible; the guard has an observed regression probe that neuters the hash check and shows the torn-stitch case turning green.
  - The preview binding outlives the bounded in-process store: one RC-04 effect receipt per journalled batch, naming the write journal as the domain executor, carrying the previewId and preview digest when there was one, and gated only by the write journal's own existing flag rather than a new one.
  - An effect receipt never authorizes: no approval row is written for an unapproved write, `recovery_required` is recorded as `unknown` rather than `applied`, and a store that cannot open or that throws leaves the patch result and the workspace unchanged.
  - The receipt is proven to land, not merely to have a call site: an isolated-state-dir test lets the real `resolveSink` construct the real store with its real default options and asserts one row with the expected digest, journal ref and null approval decision — and an observed regression probe that stops the store being constructed turns that assertion red.
  - AC-3 is one chain, not a claim, and it is bounded by what the runtime can supply. The pinned `file.diff` reports no artifact handle at any diff size, so the association rests on the identifiers that do exist: the commit gate reads the previewId and change summary digest back out of the host-side preview record (no parameter exists through which a caller could name its own), the journal evidence carries them, and the receipt records the previewId as `approval_id` with the digest committed under `proposal_digest`. `artifact_ref` stays null rather than empty, so "no diff archived" remains distinguishable from "an empty archive". What a reviewer saw stays re-derivable because the write journal keeps a committed batch's pre-image on disk, and that retention is asserted by a test rather than assumed. The handle plumbing is retained as a capability so a runtime that does emit handles is wired on arrival.
  - The unified diff a preview reports is rendered host-side from the hash-proven baseline and the bound post-image, so a change larger than the runtime's own 200-entry cap is shown in full; `file.diff` is still requested, and the `content_hash` it reports is compared against the baseline's to catch a target that moved during the preview.
  - An effect receipt store that cannot be constructed is retried on the next batch and reported once per interval rather than latching the sink off for the process, so one transient failure cannot silently end the audit trail; the write path still never fails because of it.
  - AC-1's six cases each have a test: precondition conflict, concurrent mutation after the preview, failed commit with rollback, abort (both mid-paging in the preview and on the write path, leaving no prepared batch), undo of a previewed commit through the one journal that committed it, and restart recovery of a prepared batch.
  - `tx.commit` has a recorded final disposition rather than an open loop: permanently denied, with the reopening condition named as an ownership change of the ClawX write journal rather than a flag on this bridge.
  - An apply_patch call is legible to a person: its display line names the patch's declared A/M/D targets and marks a previewed commit, reached through the real `resolveToolDisplay` path, bounded on a 512 KiB argument, and never throwing on a malformed patch.
docs:
  required: false
---

# VerseShell P3-01 Patch Preview 与 ClawX Journal Bridge

Phase 4 的第一片只解决**归属**问题，不解决写入问题。

pinned catalog（`operation_catalog_count = 31`）本身就带一整套写入与事务面：
`file.apply_patch`（ordered find/replace，可带 `expected_hash`）、`file.write`、
`file.edit_range`、`file.replace_exact`、`file.remove`（agent 模式移入 trash 并返回
`restore_token`），以及 `tx.begin / tx.commit / tx.rollback / tx.savepoint / tx.restore`
配合自己的 journal 目录。ClawX 侧在 TF-0015 / UAS-04 已经有一套完整的
`write-journal.ts` + `apply-patch-preflight.ts`（排序路径租约、prepared → committed /
rolled_back / recovery_required、`recoveryRef`、`undo_write`）。

因此本片的交付物是一条**只读**桥：patch 文本在 ClawX 侧解析并算出 post-image，
VerseShell 只负责观测（`file.hash` 的乐观并发 token、`file.read_range` 的 bounded
baseline、`file.diff` 的 unified diff），产出 precondition 与 change summary digest。
adapter 在请求发出之前机械拒绝上面每一个写入/事务 operation —— 这就是「不建立第二个
journal」从声明变成可核对事实的地方。

未在本片内完成、留给后续片的部分：审批与变更摘要 UI、`tx.commit` 的最终处置结论。
在唯一 journal authority 被端到端证明之前，不得启用任何 VerseShell 侧提交路径。

## 第 2 片：提交闸门

`apply_patch` 增加一个可选的 `preview_id`。**调用方永远不提供期望 digest** —— 只给一个不透明
id，期望值来自 host 侧 `preview_patch` 落进有界进程内存储的记录，所以调用方无法伪造一个
「自己的 patch 必然满足」的期望。

闸门位置是 `applyPreparedBatch` 在**第一次写入之前、仍持有全部 target lease 时**：从 preflight
自己读到的内容重算 change summary digest（`baseHash` 取编码后字节，`postHash` 取解码后
post-image 文本，因此与只见过文本的 preview reader 可比），与记录比对。不一致、id 未知、或
preview 自称有冲突/截断，一律抛出并**释放 lease、丢弃 prepared 快照**——不修补、不改用较新意图。
通过时把 `previewId` 与 digest 记进 write-journal evidence 作为溯源。

不带 `preview_id` 时整条路径与既有完全一致；这一点由既有 apply_patch / write-journal / UAS-04
套件原样通过来证明。

## 第 3 片（进行中）：分页 baseline

前两片把 baseline 限死在一次 ranged read 内。`file.read_range` 的硬上限是 500 行，所以任何
超过 500 行的文件都直接 `baselineTruncated` → 不产出 diff → 不可提交 —— 也就是说 preview
对绝大多数真实源文件不可用。本片把这条路打开，但**不放宽诚实性**：

窗口按 `MAX_BASELINE_LINES` 步长平铺，窗口数上限 `MAX_BASELINE_PAGES`、累计字节上限
`MAX_BASELINE_BYTES`，两条上限任一越界即按原来的方式拒绝，绝不读前缀充当整份文件。

关键区别在于：**一次读是原子观测，多次读不是**。两个窗口之间落下的一次写入会拼出一份磁盘上
从未存在过的 baseline，而它看起来完全正常。所以拼接结果必须先与该目标的 `file.hash` 对齐才
可使用；对不上就报 `torn-stitch` 并放弃 diff。这条校验没有引入新假设 —— 它用的正是提交闸门
已经依赖的那条同一性关系（ClawX 侧内容哈希 = 运行时 `file.hash`），只是把拒绝提前到读取阶段。

拒绝原因不再压成一个布尔：`baselineReason` 区分 `over-cap` / `unreadable` / `torn-stitch`，
否则三种成因不同、处置不同的失败在输出里无法分辨。

仍未在本片内完成：审批与变更摘要 UI、`tx.commit` 的最终处置结论。

## S1：把 preview 绑定记进 RC-04 的 effect receipt

评测发现的问题不是 preview 算错了，而是它**记在了哪里**。VS-P3-01 的 preview store 是一个
进程内 Map、上限 32、无状态机、无幂等键、无过期、重启即失 —— 作为提交闸门的热路径缓存
是对的，作为审计记录毫无价值。而 RC-04 的 `effect_receipts` 已经具备幂等键、digest-only
隐私、append-only、identical-content 与 content-conflict 区分，且 `effect-receipt.ts` 自己
的头注释写明它"解释并关联域 journal 的结果，从不授权重放" —— 那句话正是为
`tools/write-journal.ts` 这类域 journal 写的。所以两者不是竞争关系：Map 是闸门的缓存，
receipt 是记录。

两条继承而非新造的性质：

- **不新增旗标。** 只有当这一批产出了 journal evidence 才写 receipt，而
  `createJournalEntries` 在 `runtime.coding.writeJournal.enabled` 关闭时返回 `[]`。没有
  journal 就没有要关联的东西，也就没有 receipt —— 回滚沿用该旗标在
  `shared/dcs/prod-flags-catalog.ts` 里已登记的那一条。
- **fail-open。** `write-journal.ts` 明写 journal 失败绝不阻塞写入路径；关联记录比 journal
  更弱，因此更不得阻塞。store 打不开、insert 抛错，一律吞掉。

`recovery_required` 映射为 `unknown` 而非 `applied`：RC-04 把 unknown 停在
`needs_reconciliation` 且永不自动重放，这正是回滚未完成的批次应得的处置。`prepared` 不产
receipt —— 为一个从未进入写入循环的批次开收据，就是断言一个不存在的 effect。**不写
`approval_ledger`**：那张表建模的是授权，而此片没有任何人工决策，写进去等于把未审批的写入
记成已审批。

## S2：让人看见 apply_patch 改了什么

`apply_patch` 的 display spec 原本是 `detailKeys: []`，于是人在时间线上只能看到
「🩹 Apply Patch」—— 没有文件、没有计数、也看不出这次写入是否经过 preview 闸门。信息一直
就在参数里，只是没人读。

两条刻意的边界：本片读的是 **patch 声明的目标**，即意图而非结果，故用与
`formatCommittedSummary` 相同的 A/M/D 字母渲染，让读者能把意图和结果对照而不是混为一谈；
以及它扫描信封头而不调用真解析器 —— 显示路径不得在畸形 patch 上抛错，也不该对一个
512 KiB 参数做解析器级的工作。

S2 **不依赖 VerseShell，也不依赖 `patchPreview` 旗标**：`apply_patch` 自己的 preflight 早
已算出 `previewEntries`，而 patch 文本本来就是它的参数。所以它在 VS-P3-01 未通电时依然有
效 —— 这是刻意的：人类可见性先建在默认就在跑的那条路上，再让 VerseShell preview 作为它的
一个增强来源。

## AC-3：diff artifact 与 approval / change summary 的关联

节点 AC-3 要的是**关联**，不是渲染 —— 一个 approval id、一份 change summary digest 和"复核者
真正会看到的那些 diff"必须落在同一条记录上。三段接线：

`preview_patch` 把 `file.diff` 回报的 artifact handle 收进 preview 记录（`diffArtifacts`，
归一化后去重、排序、限量 64 条 / 单条 256 字符）→ 提交闸门从**记录**读回并放进
`VerifiedPatchPreview` → journal evidence 带出 → effect receipt 写进 `artifact_ref`，同时把
未截断的完整清单放进被摘要的 `proposal`。

两条刻意的性质：handle 只能来自 host 侧 preview 记录，`verifyPatchPreviewBinding` 的入参里
没有任何可以让调用方指定 artifact 的位置 —— 否则提交可以引用一份没人渲染过的 diff。以及
"没有归档 diff"与"归档为空"是两种不同的断言：无 handle 时 `artifactRef` 整个字段缺席，而不
是一个空数组。

RC-04 的 `artifact_ref` 是单列，多个 handle 在 512 字符内 join，超出部分以 `+N` 标注 —— 截断
必须可辨认，而完整集合仍被 `proposal_digest` 承诺。

## `tx.commit` 的最终处置

结论与理由写在 `harness/specs/rules/verseshell-patch-preview-journal-bridge-boundary.md`
第二条：**永久拒绝**，并写明唯一的重开条件是 ClawX write journal 的整体所有权更替（另立任务，
不是给本桥加旗标）。前两片把这一条记作"待后续片裁定"，现已收口，不再作为开放回路悬置。

## 本节点范围内不含人工确认 UI

节点的 requirements / acceptance_criteria / success_metrics 里没有任何一条要求人类可见面：
AC-3 说的是"关联"，desired_outcome-2 说的是"commit 前有 baseline hash / operation id /
change list"。人工确认（preview → 人工审批 → 带 previewId 提交）是另一件事，走 ClawX 已有的
exec-approval 平面（`exec.approval.request` / `waitDecision` / gateway RPC / native prompt /
channel 投递），按用户裁决挂 M6/round-2。这里写明是为了不让"节点已收口"被读成"人工确认已具备"。

## 测试路由（新增测试文件必读）

`vitest.scoped-config.ts` 会把 `getUnitFastTestFiles()` 判定为 unit-fast 的文件从各 scoped
config 里**排除**，改由 `vitest.unit-fast.config.ts` 承接。该判定是动态的，且在文件被 git
跟踪之后才生效 —— 所以**同一条命令在提交前后会跑到不同数量的文件**：本任务实测
`apply-patch-effect-receipt.test.ts` 与 `tool-display-apply-patch.test.ts` 在未跟踪时落在
agents-core（5 files / 63 tests），提交后被判为 unit-fast 并从 agents-core 排除
（4 files / 45 tests），两者都改由 unit-fast 执行（66 files / 494 passed）。

后果是一条 requiredTests 可以名列六个文件却静默只跑四个 —— 与一个永不报警的空守卫无法区
分。因此新增测试文件后必须按效果核对落到哪个 config，而不是只看命令里写了什么：
`node -e "import('./test/vitest/vitest.unit-fast-paths.mjs').then(m => console.log(m.getUnitFastTestFiles().length))"`
可直接查 membership。`apply-patch-effect-receipt.store.test.ts` 因为碰 fs/SQLite 而不属
unit-fast，仍留在 agents-core；`verseshell/patch-preview*.test.ts` 虽属 unit-fast，但
verseshell config 用显式 include，故在两处都跑。
