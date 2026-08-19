# Coding Runtime P6B 独立验收报告（2026-08-18）

> 阶段：**P6B — Git Checkpoint v2**（路径作用域、safety snapshot、两阶段 restore、生命周期、worktree/submodule 策略）
> 规范依据：`docs/dev/coding-runtime-p6-p7-development-spec.md` §4.2（协议不变量）/ §6.2（验收矩阵）/ §7（门禁）/ §8（性能预算）
> 开发自检：`reports/CODING-RUNTIME-P6B-EVIDENCE-2026-08-18.md`（本报告**不复述**其结论）
> 前置：`reports/CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md`（verdict=ACCEPT_WITH_RESIDUAL，**待用户确认**）
> 程序基线：`c673f0f29`（未 commit / 未 checkout / 未 reset / 未 clean）
> 结论边界：只覆盖 **P6B**。不是 P6 整体验收、不是 UFTK GA / canary / 成熟度结论。
> 产品锁：`liveReady=false`、`productApproved=false`、`defaultOn=false` 未变；全部 UFTK flag 默认 false。

---

## 0. 验收裁定

**verdict = ACCEPT_WITH_RESIDUAL**

§6.2 全部 10 项经独立取证成立，其中 1 项在本次验收中**被证伪并修复**（数据破坏性缺陷，见 §2.1）。residual 3 项（§4），均不影响 flag off 行为与产品锁。

**但 P6B 门禁不能独立闭合**：规范 §11 要求 P6A 独立验收结果先经用户确认。P6A 验收报告已产出（verdict=ACCEPT_WITH_RESIDUAL），**尚未取得用户确认**，故 P6B 的形式门禁仍悬空 —— 这不是 P6B 自身质量问题，见 §5。

---

## 1. 独立取证方式

不接受开发自检的结论与"测试已通过"作为证据：

1. 重读 4 个实现模块，逐条对照 §4.2 的 7 条不变量，推导**代码上是否真的成立**，重点找自检可能自证的盲区；
2. 对每条不变量核对断言是否真的锁住语义；
3. 对推导出的风险点新写探针（本次新增 3 个用例，见 §2.1 / §3）；
4. 性能项复核 §8 预算对应的真实数据。

---

## 2. 本次验收发现的缺陷（先证伪，再修复）

### 2.1 缺陷 C：请求超出 checkpoint 覆盖范围的 scope 会**删除**该范围内容（数据破坏）

**§6.2 对应项**：「路径作用域 restore：仅恢复 scope 内…；scope 外路径 `git status` 前后一致」、「不静默覆盖/丢失用户内容」。

**证伪推导**：`buildCheckpointRestorePlan` 的 `removePaths` 定义为「scope 内、存在于工作区、但**不在 checkpoint tree 中**」的路径。而 `restoreCheckpoint(id, { paths })` 原实现在给了显式 `paths` 时直接 `scope = requestedScope`，**不校验该 scope 是否被 checkpoint 覆盖**。

于是：对一个 `scope=["src"]` 的窄 checkpoint 调用 `restoreCheckpoint(id, { paths: ["other"] })` → `other/` 下所有文件都"不在 tree 中" → 全部进入 `removePaths` → **被删除**。checkpoint 从未覆盖 `other/`，却成了删除 `other/` 的依据。

这是自检套件的盲区：自检只测了「更窄的子集」（`src` → `src/a.txt`，合法），没测「不相交/更宽的 scope」。

**影响**：走两阶段事务且 safety on 时内容可从 `safetyRef` 恢复；走普通 `GitCheckpointService.restoreCheckpoint`（无 safety）时是**静默删除**。属真实数据破坏路径。

**修复**：新增 `scopeIsCoveredByCheckpointScope(requested, recorded)`；`git-checkpoint.ts` 的 restore 与 `git-checkpoint-transaction.ts` 的 `prepare` 都改为**先读 checkpoint 元数据**，显式 `paths` 必须被 recorded scope 覆盖，否则返回结构化 `failed` + `E_GIT_CHECKPOINT_FAILED` + warning，零改动。`full` checkpoint 覆盖一切，不受限。

**修复后新增用例**（`git-checkpoint.scoped.test.ts`）：

- `refuses a requested scope the checkpoint never covered instead of deleting it` —— 返回 `failed`、reason 含 `not covered by checkpoint`、`other/c.txt` 与 `other/untracked.txt` 均未被删、warning 已发出；
- `allows any scope against a whole-tree checkpoint` —— 整树 checkpoint 不受限制；
- 既有 `restores a narrower scope than the checkpoint tree` 保持通过（合法子集未被误拦）。

---

## 3. §6.2 验收矩阵逐项实测

| 验收项 | 结果 | 独立证据 |
|---|---|---|
| 路径作用域 create：私有 ref；真实 index/worktree 零变化；scope 记录在元数据 | PASS | `ls-tree` 实测 tree 仅含 scope 内文件（scope-only tree，非整树+标记）；`indexWorktreeUnchanged=true` 且 `git status --porcelain` 前后逐字节相等；scope/label/parent 经 `listCheckpoints` 往返。代码核对：元数据走 commit message trailers，无第二套元数据存储 |
| 路径作用域 restore：仅恢复 scope 内修改/删除/新增/嵌套；scope 外 `git status` 前后一致 | PASS（修复后） | 4 类 in-scope 变化全复原；out-of-scope 内容 + `git status` 过滤行 + index 三重断言一致；scope 外 index 未被 `read-tree` 整体覆盖（scoped 分支改用 `update-index --add --remove` 仅刷新 in-scope 条目）。**§2.1 修复后**才真正满足「不动 scope 外」 |
| safety snapshot：受影响路径 dirty 内容可恢复；返回 `recoveryRef`/`safetyRef`，不静默覆盖 | PASS | `git show <safetyRef>:<path>` 实读出 restore 前内容；`recoveryRef` 下原始字节可读；safety off + in-scope dirty → `conflict` 且用户编辑零变化。at-risk 判定按 blob hash 精确（实测：改动文件与待删文件入选，未改动与缺失文件不入选） |
| 两阶段 restore：prepare 冲突失败零变化；apply 中途失败返回 `recovery_required` 或安全回退 | PASS | prepare 阶段结构冲突/not_found 均零改动实测。apply 故障注入**两条 settle 分支都实测**：removal 阶段失败（checkout 已落盘）→ 回退成功返回 `failed` + reason 含 `rolled back from safety snapshot` 且工作区回到 restore 前状态；叠加 state dir 破坏使回退也失败 → `recovery_required` + `E_GIT_CHECKPOINT_RECOVERY_REQUIRED`，且 `safetyRef`/`recoveryRef` 均可读出 restore 前内容；另有事后人工恢复用例走通 |
| restore 期间与 UFTK 写工具互斥（依赖 6A barrier） | PASS | 外部持 barrier 时 restore 不推进且文件保持 dirty，释放后完成；prepare→settle 全窗口第三方获取 barrier 超时 `E_LOCK_TIMEOUT`；apply 失败后 barrier 已释放（后置探针可获取）。barrier **排队期间**不被文件读绕过，依赖 P6A §2.1 的修复 |
| 非 git 结构化 unsupported；root `.git` 文件 worktree 主仓支持；submodule 显式 unsupported/skip+warning | PASS | 真实 `git worktree add` 建立 linked worktree（`.git` 为文件）→ create/restore 均成功，证明 `--git-common-dir` 解析生效；`git init --separate-git-dir=<…/modules/sub>` 构造 submodule 形态 → `unsupported` + reason 含 submodule + warning；nested `.git` 在 scope 内→`unsupported`，在 scope 外→显式 `skippedNestedRepos` + warning；无显式 scope 时沿用 P5 整树规则判 `unsupported` |
| 生命周期：label/list/diff/exportPatch/retention/prune/GC 可用；旧 checkpoint 不被误删 | PASS | 12 用例。retention 关键项：`maxCount=0` 仍保留最新；`protectedIds` 生效；`maxAgeMs` 只删过期项（切点落在中间 checkpoint 之前，实测只删最旧一个）；`dryRun` 不删任何 ref。整套生命周期调用前后 `git status` 与文件内容不变（prune 只删 ref） |
| 继续禁止 `git reset --hard`/`git clean -f`；不 import write-journal / FTS rollback | PASS | 剥离注释后扫描 4 个实现文件的**代码**与 **import specifier**（避免用文档字样自证）：无 `"reset"`/`"clean"` 参数、无 `--hard`、无 `write-journal` / `file-transaction-service` 依赖 |
| flag off：新 API 结构化 `disabled`，P1-P5 路径不变，无新增模型 schema | PASS | 同一实例：`pathScoped` off 时 scoped create/restore 返回 `disabled`（reason 指名 flag），整树 create 仍 `created`；lifecycle off 时 6 个方法全 `disabled` 且 ref 未被删。P5 套件 8/8 回归通过（含 nested `.git` 早期 `unsupported` 顺序，本轮曾因顺序改动退化为 `not_found`，已修复并被该回归锁定） |
| 性能：scoped restore 显著低于整树；整树无数量级退化；safety snapshot 只复制受影响文件 | PASS | 10,000 文件真实 git 仓库实测：scoped restore（10 文件）**353.9ms** vs 整树 restore **3869.5ms** = **10.9×**，且 < §8 的 p50 1s 预算；整树 create 623.9ms / restore 3869.5ms 相对 P5 基线（571.2/3196.1ms、4186.6/6674.1ms）无数量级退化；at-risk 判定 59.4ms、safety snapshot（scoped）167.1ms、scoped diff 61.9ms、exportPatch 34.6ms、listCheckpoints 28.9ms |

---

## 4. Residual（不阻塞 P6B）

### 4.1 Residual R3：safety checkpoint 与普通 checkpoint 共用命名空间，可被 retention 删除

`captureRestoreSafetySnapshot` 通过 `writeCheckpointCommit` 写入**同一** ref 前缀 `refs/openclaw/uftk-checkpoints/`，label 为 `uftk-safety-snapshot <restoreId>`。因此 safety ref 会出现在 `listCheckpoints` 中，也会被 `retainCheckpoints` / `pruneCheckpoints` 视为普通 checkpoint。

**影响**：若发生 `recovery_required` 后又执行了激进 retention（`maxCount` 很小且未传 `protectedIds`），该 safety ref 可能被删除，届时只剩 `recoveryRef` 原始字节备份可用（后者在 state dir，不受 git retention 影响，故不会双双丢失）。

**缓解（当前可用）**：`retainCheckpoints({ protectedIds: [safetyRef…] })`；`recoveryRef` 独立于 git。
**建议后续**：给 safety checkpoint 单独 ref 前缀（如 `refs/openclaw/uftk-safety/`）并在 retention 中默认排除。属契约面变更，不在 P6B 范围内擅自扩大。

> **闭环追记（2026-08-19，P6 收尾）**：本 residual 已由 **P7 承接 A** 按上述建议消除，且落地强于建议——
> 除新增 `GIT_CHECKPOINT_SAFETY_REF_PREFIX = "refs/openclaw/uftk-safety"` 外，
> 还在**每个删除点**加了 `assertRefInNamespace` 守卫（`git for-each-ref <prefix>` 只匹配到斜杠为止，两个命名空间因此天然不相交），
> 回收 safety ref 必须走显式命名的 `retainSafetyCheckpoints` 且策略非空。8 例实测，含"大量 auto checkpoint + 激进 retention"后 safetyRef 仍可读出 restore 前内容。
> 相关不变量记为 `shared/coding-runtime/README.md` 第 15 条。
> 附带修掉一个本 residual 未察觉的 P6B 缺陷：safety snapshot 在 scope 含"磁盘上不存在的文件"时整体失败
> （`git add -A -- <不存在路径>` pathspec 未匹配），即"要恢复一个被删文件时安全网反而拿不到"——P6B 的作用域测试一律用目录 scope，故零覆盖。
> 本追记只补状态，不改写上文当时的发现与判断。

### 4.2 Residual R4：recovery 目录位置偏离规范字面

规范 §4.2 写 `.openclaw/recovery/<id>`（工作区内）；实现默认 `<stateDir>/uftk-recovery/<id>`（工作区外），可用 `recoveryDir` 覆盖。原因：往工作区写备份会新增 untracked 条目，直接破坏 §6.2 硬不变量「scope 外路径 `git status` 前后一致」；P5 已用同一理由把 checkpoint 锁文件放 state dir。已由用例断言 restore 后 `git status` 为空且 `recoveryRef` 不在 repo 内。**需验收方确认接受该偏离或改回规范字面路径。**

### 4.3 Residual R5：`tsgo:core:test` 存在 1 个无关 WIP 文件

同 P6A §4.2：`src/agents/goal-wake-runtime.test.ts`（untracked，mtime 早于本次工作，goal-loop / durable-scheduler workstream）。P6B 全部 7 个文件均未出现在错误列表中。需验收方裁决是否扩充规范 §7 允许清单。

### 4.4 已复核确认无问题的项

- **trailer 注入**：label 经 `sanitizeCheckpointLabel` 去除 `\r\n\t\0`，无法换行伪造 `openclaw-checkpoint-scope:` 行；解析按行取首个 `:` 前缀为 key，故 `label: "openclaw-checkpoint-scope: evil"` 只会成为 label 值本身。已验证。
- **workspace barrier 不可重入**：两阶段 restore 未在 barrier 下嵌套取 per-path 锁（该嵌套会自锁死，本轮曾实测为 120s stall 并修复）；跨进程互斥由 `acquireCheckpointRestoreLock` 复用既有 session-write-lock，获取顺序与 P5 路径一致（barrier → 跨进程锁），两条 restore 路径不会互相死锁。已验证。
- **`checkout-index -f` 会强制递归删除挡路目录**：因此"目标路径变成目录"不是 apply 失败点，而由 prepare 的 `findCheckpointRestoreConflicts` 拦截 —— 该扫描确实在做实事，非冗余。已验证。

---

## 5. 门禁状态

工程门禁全部 exit 0（与 P6A 报告 §5 同一轮次实跑）：harness context/validate、coding-runtime-contract 9/9、P6A+P6B 定向、**coding-runtime 全目录 22 files / 182 tests**、dcs-prod-flags-catalog 4/4、typecheck:node、typecheck:web、contract:check、lint:bom、git diff --check、verseshell:test、tsgo:core、tsgo:core:test（residual 见 §4.3）、config-schema-parity（仅预存 `runtime.memory.candidateGeneration`）。

**形式门禁悬空项**：规范 §11 要求 P6A 独立验收结果经用户确认后 P6B 才成立。P6A 报告已产出但未获确认，因此 P6B 本报告在用户确认 P6A 之前不构成完成态。

---

## 6. 结论

P6B **verdict = ACCEPT_WITH_RESIDUAL**。residual：R3（safety ref 可被 retention 删除，已有缓解）、R4（recovery 目录偏离规范字面，需确认）、R5（无关 WIP 文件的 tsgo residual，需裁决）。

本次验收找出并修复了 1 个开发自检未覆盖的**数据破坏性缺陷**（§2.1：超覆盖范围的 scope 请求会删除该范围内容）。修复后全目录 182 用例通过。

P6 收卡尚需：用户确认 P6A 与 P6B 两份 verdict，并裁决 R2/R5（tsgo 允许清单）与 R4（recovery 路径）。
