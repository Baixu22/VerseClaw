# Coding Runtime P6B 开发自检证据（2026-08-18）

> 阶段：**P6B — Git Checkpoint v2**（路径作用域、safety snapshot、两阶段 restore、生命周期、worktree/submodule 策略）
> 规范依据：`docs/dev/coding-runtime-p6-p7-development-spec.md` §4.2 / §6.2 / §7；Harness 契约：`harness/specs/tasks/coding-runtime-p6-p7-extension.md`
> 程序基线：`c673f0f29`（未 commit / 未 checkout / 未 reset / 未 clean；工作树仍含大量既有并发 WIP）
> 结论边界：本报告只代表 **本地 P6B 工程自检**。**不是** P6B 独立验收、不是 P6 整体验收、不是 UFTK GA / canary / 整体成熟度结论。
> 产品锁：`liveReady=false`、`productApproved=false`、`defaultOn=false` 未变。全部 UFTK flag（含 P6B 新增 3 项）默认 false。

---

## 0. 前置门禁诚实说明（必须先读）

规范 §11 与 harness `Completion Rule` 要求：**P6B 只能在 P6A 取得独立验收结果并经用户确认、且 task-forest 节点已经 proposal apply/validate/export 之后开始**。本会话接手时的真实状态：

| 项 | 实际状态 |
|---|---|
| P6A 实现 | **已存在**（`lock-core.ts`、`lock-inspection.ts`、改造后的 `file-lock-manager.ts`、FTS commit CAS、lock observability），由本会话之前的会话完成 |
| P6A 定向测试 | 本会话独立复跑 **exit 0，5 files / 52 tests PASS** |
| P6A 独立验收报告 | **不存在**（`reports/` 下无 `CODING-RUNTIME-P6A-*`） |
| P6A 用户确认 verdict | **无记录** |
| `docs/dev/handoffs/LATEST.md` | **过时**：仍写「当前只完成规划与 task-forest 节点建立，尚未开始任何 P6 实现」 |
| TF-0075 | `in_progress`(5%)，但 `next_action` 仍指向 P6A（P6A 完成后未更新） |

因此：**P6B 的启动门禁在形式上未满足**。本会话按用户明确指令（"现在开始接手 p6b 的工作"）执行 P6B 开发，并在此明确记录：P6A 未经独立验收与用户确认，本报告不代表 P6A 已验收，也不能作为 P6 整体验收的替代。P6A 的独立验收仍是 P6 收尾的前置项。

---

## 1. 交付内容

### 1.1 新增模块

| 文件 | 职责 |
|---|---|
| `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-safety.ts` | restore 前 safety snapshot：git safety checkpoint（`safetyRef`）+ at-risk 文件原始字节备份（`recoveryRef`）；`computeAtRiskPaths` 按 blob hash 精确判定；`restoreFromRecoveryDir` 原始字节回放 |
| `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-transaction.ts` | 两阶段 restore：`prepare` / `applyAndSettle`（含 `#rollback`）；`GitCheckpointTransactionService` |
| `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-lifecycle.ts` | `listCheckpoints` / `diffCheckpoints` / `exportPatch` / `retainCheckpoints` / `pruneCheckpoints` / `collectGarbage` |

### 1.2 修改模块

| 文件 | 变更 |
|---|---|
| `git-checkpoint.ts` | `GitCheckpointScope` / checkpoint 元数据（label / scope / parent，承载于 commit message trailers）；`createCheckpoint({paths,label})`；`restoreCheckpoint(id,{paths})`；`resolveGitCheckpointContext`（`--git-dir` / `--git-common-dir` 解析，支持主仓 linked worktree，submodule 显式 unsupported）；`resolveNestedRepoPolicy`；`buildCheckpointRestorePlan`；`applyCheckpointToWorktree`（唯一落盘原语）；`writeCheckpointCommit`；`readCheckpointRecords`；P6A barrier 接线（仅 concurrencyV2 on 时） |
| `coding-runtime-flags.ts` | 新增 3 个 P6B leaf + 3 个 resolver，默认 false |
| `config/types.openclaw.ts`、`config/zod-schema.ts`、`config/runtime-feature-leaves.ts` | `gitCheckpoint` 叶子扩展为含 `pathScoped` / `safetySnapshot` / `lifecycle` 子叶 |
| `shared/coding-runtime/types.ts`、`schema.ts` | flag keys 7 → 10（全 false）；新增错误码 `E_GIT_CHECKPOINT_RECOVERY_REQUIRED` |
| `tests/unit/coding-runtime-contract.test.ts` | flag 计数 7 → 10 + P6B leaf 断言 + 新错误码断言 |
| `dcs-prod-flags-catalog.test.ts` | P6B 三 leaf 默认 false + 子叶独立解析断言 |
| `shared/coding-runtime/README.md`、`MIGRATION.md` | P6B 章节 |

### 1.3 新增测试

| 文件 | 用例数 |
|---|---:|
| `git-checkpoint.scoped.test.ts` | 16 |
| `git-checkpoint-safety.test.ts` | 16 |
| `git-checkpoint-lifecycle.test.ts` | 12 |

### 1.4 Flag（全部默认 false）

| Flag | 默认 | 作用 |
|---|---|---|
| `runtime.coding.uftk.gitCheckpoint.pathScoped.enabled` | `false` | 路径作用域 create/restore |
| `runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled` | `false` | restore 前强制 safety snapshot |
| `runtime.coding.uftk.gitCheckpoint.lifecycle.enabled` | `false` | label/diff/export/retention/prune/GC |

flag off 行为：P5 整树 create/restore/list 与 P1-P5 路径逐字节不变（由 `git-checkpoint.test.ts` + `git-checkpoint.restore.test.ts` 8/8 回归证明）；scoped/lifecycle API 返回结构化 `disabled`。未新增任何模型可见 schema，未接入 write/edit/apply_patch/exec 工具路径。

---

## 2. §6.2 验收矩阵逐项实测

| 验收项 | 结果 | 证据 |
|---|---|---|
| 路径作用域 create：私有 ref；真实 index/worktree 零变化；scope 记录在元数据 | PASS | `scoped.test.ts` "writes a scope-only tree to a private ref and leaves index/worktree unchanged"（`indexWorktreeUnchanged=true`、`status` 前后逐字节相等、`ls-tree` 仅含 scope 两文件）、"round-trips scope and label through checkpoint metadata" |
| 路径作用域 restore：仅恢复 scope 内修改/删除/新增/嵌套；scope 外 `git status` 前后一致 | PASS | `scoped.test.ts` "restores only in-scope paths and leaves out-of-scope status byte-identical"（4 类 in-scope 变化全复原；out-of-scope 内容与 `git status` 过滤行完全相等） |
| safety snapshot：受影响路径 dirty 内容可恢复；返回 `recoveryRef`/`safetyRef`，不静默覆盖 | PASS | `safety.test.ts` "captures a safety ref plus raw backups and reports them on success"（`git show <safetyRef>:src/a.txt` == dirty 内容；`recoveryRef` 下原始字节可读）；"refuses to overwrite dirty in-scope content when the safety flag is off"（返回 `conflict`，用户编辑零变化） |
| 两阶段 restore：prepare 冲突失败零变化；apply 中途失败返回 `recovery_required` 或安全回退 | PASS | `safety.test.ts` "leaves the target zero-changed when prepare hits a structural conflict"、"returns structured not_found without touching the worktree"；apply 故障注入见 §2.1 |
| restore 期间与 UFTK 写工具互斥（依赖 6A barrier） | PASS | `safety.test.ts` "serializes restore against UFTK writers through the P6A workspace barrier"（外部持 barrier 期间 restore 不推进且文件保持 dirty；释放后完成）、"holds the restore barrier for the whole prepare-to-settle window"（prepare 后第三方 barrier 获取超时 `E_LOCK_TIMEOUT`）、"releases the restore barrier even when apply fails" |
| 非 git 结构化 unsupported；root `.git` 文件 worktree 主仓支持；submodule 显式 unsupported/skip+warning | PASS | `git-checkpoint.test.ts` 非 git unsupported（回归）；`scoped.test.ts` "supports a main-repository linked worktree via --git-common-dir"、"returns explicit unsupported plus a warning for a submodule-style .git link"、"explicitly skips an out-of-scope nested repo but refuses one inside scope" |
| 生命周期：label/list/diff/exportPatch/retention/prune/GC 可用；旧 checkpoint 不被误删 | PASS | `lifecycle.test.ts` 12/12，含 "never deletes the newest checkpoint even when asked to keep none"、"honors protectedIds so a referenced checkpoint survives"、"reports a dry run without deleting anything" |
| 继续禁止 `git reset --hard`/`git clean -f`；不 import write-journal / FTS rollback | PASS | `scoped.test.ts` "forbidden git operations" 两用例（剥离注释后扫描 4 个实现文件的代码与 import specifier） |
| flag off：新 API 结构化 `disabled`，P1-P5 路径不变，无新增模型 schema | PASS | `scoped.test.ts` "returns structured disabled for scoped APIs when the pathScoped flag is off"（同一实例整树 create 仍 `created`）；`lifecycle.test.ts` "returns structured disabled for every lifecycle method when the flag is off"（且 ref 未被删） |
| 性能：scoped restore 显著低于整树；整树无数量级退化；safety snapshot 只复制受影响文件 | PASS | 10,000 文件真实 git 仓库实测，见 §2.2 |

### 2.1 apply 阶段故障注入（两条 settle 分支均实测）

注入方式：先 `prepare()`（已过冲突扫描、已拿 safety snapshot、已持 barrier），再破坏工作区使 `apply` 中途失败。

关键发现：`git checkout-index -f` **会强制递归删除挡路的非空目录**，因此「目标路径变成目录」不能让 apply 失败 —— 它由 prepare 阶段的 `findCheckpointRestoreConflicts` 拦截（该扫描确实在做实事）。真正能让 apply 中途失败的注入点是 **removal 阶段**：把一个 extraneous 文件换成非空目录，`fs.rm`（非 recursive）抛错，而此时 checkout 已经落盘 —— 这是真正的「apply 已部分改动工作区后失败」。

| 分支 | 注入 | 结果 | 用例 |
|---|---|---|---|
| 回退成功 | removal 阶段失败（extraneous 文件→非空目录） | `failed` + reason 含 `rolled back from safety snapshot`；**工作区回到 restore 前状态**（`a-precious` 与 `extra-precious` 都在），不是 checkpoint 内容 | "rolls back from the safety snapshot when apply fails mid-flight" |
| 回退失败 | 同上 + 破坏 state dir（`<stateDir>/tmp` 换成文件），使 rollback 的 temp index 也无法创建 | `recovery_required` + `E_GIT_CHECKPOINT_RECOVERY_REQUIRED` + reason 含 `safety rollback incomplete`；`safetyRef` 与 `recoveryRef` 均可读出 restore 前内容 | "returns recovery_required with recoverable refs when the rollback cannot complete" |
| 事后人工恢复 | 修复 state dir 后用普通 API restore `safetyRef` | `restored`，restore 前内容全部回来 | "recovers the pre-restore state from the safety ref after recovery_required" |

即：apply 失败时**不会假成功**，且两条分支下用户内容都可恢复。

### 2.2 性能实测（10,000 文件真实 git 仓库，Windows）

| 项目 | 实测 | 规范 §8 预算 | 结论 |
|---|---:|---|---|
| 整树 create | 623.9ms | 相对 P5 基线无数量级退化 | PASS（P5 基线 571.2ms / 3196.1ms） |
| 整树 restore | 3869.5ms | 同上 | PASS（P5 基线 4186.6ms / 6674.1ms，未退化） |
| **scoped restore（10 文件）** | **353.9ms** | 明显低于整树 restore；目标 p50 < 1s | **PASS（比整树 restore 快 10.9×，且 < 1s）** |
| scoped create（10 文件） | 597.7ms | 规范未设预算 | 与整树 create（623.9ms）接近 —— 见下方说明 |
| at-risk 判定（10 文件） | 59.4ms | 与 scope 线性 | PASS |
| safety snapshot（scoped，10 at-risk） | 167.1ms | 只复制受影响文件 | PASS |
| safety snapshot（整树 ref，10 at-risk） | 445.7ms | 同上 | PASS（差值来自整树 git ref；原始字节复制仍只 10 个文件） |
| scoped diff（10 文件） | 61.9ms | 与 tree diff 规模线性 | PASS |
| scoped exportPatch（10 文件） | 34.6ms | 同上 | PASS |
| listCheckpoints | 28.9ms | — | PASS |

**关于 scoped create 未显著快于整树 create**：`writeCheckpointCommit` 固定要跑 5 个 git 子进程（`add` / `write-tree` / `rev-parse` / `commit-tree` / `update-ref`）。在 Windows 上进程启动开销主导了这个量级，scope 缩小并不能摊掉这部分固定成本。规范 §8 只对 **scoped restore** 设了预算（已达成 10.9× 且 < 1s），create 侧无预算；如后续需要优化，方向是减少子进程数而非缩小 scope。

测量方法（一次性 harness，未入库，与 P1-P5「记录数字不入库基准脚本」惯例一致）：临时目录建 100 目录 × 100 文件 = 10,000 文件真实 git 仓库并提交（建仓 39.3s），随后按上表逐项 `performance.now()` 计时；scope 固定为 `dir00/file0..9.txt` 10 个文件，每次测量前重新 dirty 这 10 个文件。

---

## 3. 必跑命令 exit code（本会话实测）

| 命令 | Exit | 结果 |
|---|---:|---|
| `pnpm harness context --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md` | 0 | PASS |
| `pnpm harness validate --spec ... --no-diff` | 0 | Spec is valid |
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / **9 tests** PASS |
| P6A 定向 5 文件（lock-core / file-lock-manager / FTS concurrency / FTS flag-matrix / file-mutation-queue） | 0 | 5 files / 52 tests PASS |
| P6B 定向 5 文件（git-checkpoint / .restore / .scoped / -safety / -lifecycle） | 0 | 5 files / **52 tests** PASS |
| coding-runtime 全目录 + file-mutation-queue 回归 | 0 | **20 files / 160 tests** PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1` | 0 | 1 file / 4 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check -- <P6B tracked 变更文件列表>` | 0 | clean；7 个新增 untracked 文件行尾空白扫描 0 命中 |
| `pnpm verseshell:test` | 0 | 11/11 PASS |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 0 | 见 §3.1 residual |
| `pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1` | 0（wrapper） | 122 中 1 失败，仅预存 `runtime.memory.candidateGeneration`；**P6B 三个新 leaf 未出现在 unknown 列表** |

### 3.1 tsgo:core:test residual —— 比规范允许清单多 1 个文件

规范 §7 只允许三个既有 RLG WIP 文件。实测错误文件：

| 文件 | 是否在允许清单 |
|---|---|
| `src/gateway/session-drain-service.test.ts` | 是 |
| `src/gateway/session-reset-service.stop.test.ts` | 是 |
| `src/gateway/session-reset-service.subagent-stop.test.ts` | 是 |
| `src/agents/goal-wake-runtime.test.ts` | **否 —— 超出允许清单** |

`goal-wake-runtime.test.ts` / `goal-wake-runtime.ts` 均为 untracked，mtime 2026-08-18 01:44 / 02:19，**早于本会话任何改动**，属 goal-loop / durable-scheduler 并发 workstream 的既有 WIP，与 P6B 无关，本会话未修（规范禁止擅自修无关文件）。

**P6B 全部文件（4 个实现 + 3 个测试）均未出现在 tsgo:core:test 错误列表中。** 但按规范字面标准，这一项属于 residual 超出允许范围，需由验收方裁决是否扩充允许清单。

---

## 4. 未完成项与偏离（诚实清单）

### 4.1 未完成项

1. **P6A 独立验收报告与用户确认 verdict 缺失** —— 启动门禁形式未满足（§0）。这是唯一的阻塞项。
2. `tsgo:core:test` residual 超出规范允许清单 1 个无关文件（`goal-wake-runtime.test.ts`，他人并发 WIP），需验收方裁决是否扩充允许清单（§3.1）。

已在本会话补齐、不再是缺口的项：apply 中途失败故障注入（§2.1，两条 settle 分支 + 人工恢复路径均实测）、性能基准（§2.2，10,000 文件真实仓库全项实测）。

### 4.2 相对规范的实现偏离（已论证）

1. **recovery 目录位置**。规范 §4.2 写 `.openclaw/recovery/<id>`（工作区内）。实现改为默认 `<stateDir>/uftk-recovery/<id>`（工作区外），可由 `recoveryDir` 显式覆盖。原因：往工作区写备份会新增 untracked 条目，直接破坏 §6.2 的硬不变量「scope 外路径 `git status` 前后一致」；P5 已用同样理由把 checkpoint 锁文件放在 state dir。已由 `safety.test.ts` "keeps the raw recovery backup outside the workspace so git status stays clean" 断言（restore 后 `git status` 为空）。
2. **隐式 scope 下的 nested repo 策略**。当调用方未显式给 `paths` 时，即使 checkpoint 元数据记录了 paths scope，nested `.git` 仍按 P5 规则判 `unsupported`。原因：nested 策略必须在解析 checkpoint 之前裁决，否则整树 restore 在 nested 仓库下会从 `unsupported` 退化成 `not_found`（本会话实测过这个回归并修复）；且宁可保守也不做静默半支持。
3. **两阶段 restore 不在 barrier 下再取 per-path 写锁**。P6A workspace barrier 是工作区级 writer 锁，与其下任何 file 锁互斥 —— 嵌套获取会自锁死（本会话实测为 120s stall 并修复）。barrier 本身即为规范要求的互斥机制；跨进程互斥由新增的 `acquireCheckpointRestoreLock`（复用既有 session-write-lock）提供，获取顺序与 P5 路径一致（barrier → 跨进程锁），两条 restore 路径不会互相死锁。
4. **label 与 pathScoped 同门**。`createCheckpoint({label})` 也受 `pathScoped` flag 门禁，因为 label 与 scope 共用同一套 P6B 元数据 trailer 面。

### 4.3 本会话修复的自身缺陷（过程记录）

- nested `.git` + 整树 restore 从 `unsupported` 退化为 `not_found`（顺序错误）→ 已修，P5 回归 8/8 恢复。
- `prepare` 在 barrier 下嵌套取 per-path 写锁导致自锁死（120s stall）→ 已修。
- 两个源码扫描守卫用例误匹配自身文档注释 → 改为剥离注释后只扫代码与 import specifier。
- `retainCheckpoints` maxAgeMs 用例的时间锚点错误（切点落在中间 checkpoint 之后）→ 修测试，实现未变。

---

## 5. 不变量自检

1. 禁止 `git reset --hard` / `git clean -f` —— 由测试守卫强制（剥注释扫描）。
2. create 不改真实 index/worktree —— `indexWorktreeUnchanged` + `status` 逐字节相等断言。
3. 路径作用域 restore 不触碰作用域外路径 —— out-of-scope 内容 + `git status` + index 三重断言。
4. restore 前 dirty 内容先进 safety snapshot；safety off 时冲突而非覆盖 —— 两个方向都有用例。
5. restore 失败结构化（`failed` / `conflict` / `recovery_required` + diagnostic），不假成功 —— 两条 settle 分支均有故障注入实测（§2.1）。
6. git checkpoint 不替代 write-journal；不 import journal / FTS rollback —— import specifier 扫描守卫。
7. root `.git` 为 worktree 文件时经 `--git-common-dir` 支持主仓；submodule 显式 unsupported + warning —— 两个用例。

---

## 6. 结论

P6B 工程实现与自检测试已交付：**P6B 定向 5 files / 52 tests PASS，coding-runtime 全目录回归 PASS**，全部工程门禁 exit 0，10,000 文件仓库性能全项达标（scoped restore 比整树快 10.9×、353.9ms < 1s 预算），产品锁与全部 flag 保持 false。

**尚不满足 P6B 完成条件**，剩余 2 项：

1. P6A 独立验收报告与用户确认 verdict 缺失（启动门禁形式未满足，§0）—— 阻塞项。
2. `tsgo:core:test` residual 超出规范允许清单 1 个无关文件，需验收方裁决（§3.1）。

因此 `TF-0075` 不应据本报告置 done；建议置 `review_needed`，待 P6A 独立验收补齐并经用户确认后，再进入 P6B 独立验收。
