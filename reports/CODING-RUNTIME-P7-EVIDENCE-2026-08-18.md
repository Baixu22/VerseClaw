# Coding Runtime P7 开发自检证据（Development Self-Check Evidence）

> 日期：2026-08-18
> 阶段：**P7（C）—— 工作流级扩展：exec 文件副作用撤销 / worktree bridge / 自动 checkpoint**
> 依据：`docs/dev/coding-runtime-p6-p7-development-spec.md` §4.3、§6.3、§7
> 任务图：`TF-0076`（依赖 `TF-0075`，已 done）
> 性质：**开发者自检**，不是独立验收。独立验收报告另出，需含 verdict 并经用户确认。
> 结论边界：本地绿灯不代表 UFTK GA / canary / 整体成熟度。产品锁 `liveReady=false` / `productApproved=false` / `defaultOn=false` 未变；全部 UFTK flag 仍为 `false`。

---

## 1. 交付内容

### 1.1 新增模块

| 文件 | 职责 |
|---|---|
| `openclaw_runtime/src/agents/coding-runtime/exec-side-effect-undo.ts` | P3 `sideEffects` → P6B 路径作用域 restore；含承接 B 覆盖守卫 |
| `openclaw_runtime/src/agents/coding-runtime/checkpoint-worktree-bridge.ts` | 以 worktree merge queue 为冲突权威协调 restore |
| `openclaw_runtime/src/agents/coding-runtime/auto-checkpoint.ts` | turn / long-task 自动 checkpoint + `withWorkspaceQuiesce` |
| `openclaw_runtime/src/shared/process-start-time.ts` | 承接 D：跨平台 starttime 提供者（pid 级缓存） |

### 1.2 修改模块

| 文件 | 改动 |
|---|---|
| `git-checkpoint.ts` | 新增 `GIT_CHECKPOINT_SAFETY_REF_PREFIX`；`writeCheckpointCommit` / `readCheckpointRecords` 参数化 `refPrefix`；新增 `skipMissingPaths` 与 `filterMatchablePathspecs` |
| `git-checkpoint-safety.ts` | safety ref 写入独立命名空间；启用 `skipMissingPaths` |
| `git-checkpoint-lifecycle.ts` | `#list` / `#retainIn` 命名空间参数化；新增 `listSafetyCheckpoints` / `retainSafetyCheckpoints`；删除点 `assertRefInNamespace` 断言 |
| `file-lock-manager.ts` | marker starttime resolver 默认指向跨平台提供者；`writerSidecarIsLive` 与 marker 写入统一走同一 resolver |
| flags 六处 | `execUndo` / `autoCheckpoint` 两个 leaf，默认 false |

### 1.3 新增测试

| 文件 | 例数 |
|---|---|
| `git-checkpoint-safety-retention.test.ts` | 8 |
| `exec-side-effect-undo.test.ts` | 18 |
| `checkpoint-worktree-bridge.test.ts` | 14 |
| `auto-checkpoint.test.ts` | 17 |
| `process-start-time.test.ts` | 12 |
| `git-checkpoint-safety.test.ts`（+1 例：absent-path 快照回归） | +1 |

---

## 2. 开发中发现并修复的 P6B 遗留缺陷

**safety snapshot 在 scope 含"磁盘上不存在的文件"时整体失败。**

- **成因**：`captureRestoreSafetySnapshot` → `writeCheckpointCommit` 用空的 temp `GIT_INDEX_FILE` 执行 `git add -A -- <scope 路径>`。当 scope 含一个磁盘上不存在的文件（正是"恢复一个被删除的文件"这一常规场景），pathspec 既匹配不到工作树也匹配不到索引条目，git 以 `fatal: pathspec '<path>' did not match any files` 整体失败。
- **实测复现**（独立最小脚本，非依赖测试框架）：空 temp index 下 `git add -A -- src/a.txt src/gone.txt src/new.txt :(exclude).openclaw` → `ADD FAILED: fatal: pathspec 'src/gone.txt' did not match any files`。
- **影响**：restore 要恢复一个已删除文件时，safety snapshot 反而拿不到 —— 安全网在最需要它的形状下缺失。属可用性/安全网缺陷，非静默数据破坏（transaction 会把它报成 `failed`）。
- **为何 P6B 没发现**：P6B 的作用域测试一律使用目录 scope（`["src"]`），目录总能匹配，该形状零覆盖。exec undo 天然按单文件传 scope，一接就炸。
- **修复**：`writeCheckpointCommit` 新增 `skipMissingPaths`，用 `filterMatchablePathspecs` 过滤掉磁盘上不存在的路径与空目录（空目录同样匹配不到）；全部过滤掉时跳过 `git add`（否则只剩 exclude pathspec 也会失败），产出合法空树，语义为"这些路径此前都不存在"。`createCheckpoint` 不开该选项，保持"用户指定不存在路径 = 结构化 failed"的既有语义。
- **回归**：`git-checkpoint-safety.test.ts` 新增 "snapshots a scope that names files absent from disk"（断言删除文件被恢复、safety tree 含 `src/a.txt` 且**不含** `src/b.txt`、`src/a.txt` 仍读出 restore 前内容）；`exec-side-effect-undo.test.ts` 的三形状端到端亦覆盖。

---

## 3. 承接项落地实测

### 3.1 承接 A —— safety ref 不可误删

| 实测 | 结果 |
|---|---|
| safety ref 写入 `refs/openclaw/uftk-safety/`，且 `for-each-ref <checkpoint 前缀>` 查不到它 | PASS |
| `listCheckpoints()` 不含 safety ref；`listSafetyCheckpoints()` 含且 label 为 `uftk-safety-snapshot ...` | PASS |
| 12 个批量 checkpoint + `pruneCheckpoints()`（maxCount 0）后 `git show <safetyRef>:src/a.txt` 仍为 restore 前内容 | PASS |
| `retainCheckpoints({ maxAgeMs: 0, maxCount: 0 })` 后 safety 内容仍可读 | PASS |
| `collectGarbage()` 后 safety 内容仍可读（safety ref 让对象保持可达） | PASS |
| **端到端**：10 个 auto checkpoint（retention `maxCount:1`）→ 一次 `recovery_required` → 再 6 个 auto checkpoint → `retainCheckpoints({maxCount:0,maxAgeMs:0})`，之后 `safetyRef:src/a.txt` = `a-precious`、`safetyRef:src/extra.txt` = `extra-precious`、`recoveryRef` 原始字节亦在，且 `pruned` 不含 safety id | PASS |
| 空策略 `retainSafetyCheckpoints()` 是 no-op（不删任何东西） | PASS |
| `retainSafetyCheckpoints({maxCount:0})` 删旧留新（最新 safety ref 受保护） | PASS |

**过程更正**：初版把该入口命名为 `pruneSafetyCheckpoints()`，但它接受 `RetentionPolicy` 并原样应用，空策略下什么也不删 —— 名字与语义不符（`pruneCheckpoints` 会自带 `maxCount:0`）。改名为 `retainSafetyCheckpoints`，并把"空策略即 no-op"写成断言，而不是在测试里补一个 `maxCount:0` 掩盖命名问题。

### 3.2 承接 B —— exec undo scope 覆盖守卫

| 实测 | 结果 |
|---|---|
| checkpoint scope=`src`，sideEffects 含 `src/a.txt` + `docs/d.txt` → `unsupported` + `E_GIT_CHECKPOINT_UNSUPPORTED`，reason 含 `not covered` 与 `docs/d.txt`，两个路径内容与 `git status` 前后完全一致 | PASS |
| **数据破坏形状直接复现**：窄 checkpoint（`src`）+ 请求 `docs/precious.txt`（磁盘有、tree 无）→ `unsupported`，该文件仍逐字节存在 | PASS |
| `allowPartial: true` → `undone`，`paths=["src/a.txt"]`、`skipped=["docs/d.txt"]`，被跳过路径原样保留，且 warn 记录了变窄 | PASS |
| `allowPartial` 但 checkpoint 一个都不覆盖 → `unsupported`（不假装成功） | PASS |
| 整树 checkpoint 覆盖任意 scope | PASS |
| 三形状（modified / added / deleted）一次撤销正确，作用域外 `docs/d.txt` 未动 | PASS |
| 撤销自身也留 safety ref（`refs/openclaw/uftk-safety/`），exec 产物不因撤销而丢失 | PASS |
| `execUndo` flag off / `pathScoped` off → 结构化 `disabled` + 零改动 | PASS |
| 未拍快照的 exec（`beforeHash=null`）→ `unsupported` 且明确不是 `noop` | PASS |
| 任一路径越界（`../escape.txt`）→ 整体 `unsupported`，连本可撤销的 `src/a.txt` 也零改动 | PASS |
| 完整 diff + 无文件副作用 → `noop` | PASS |
| checkpoint 不存在 → `not_found` + 零改动 | PASS |
| safety off + 目标已被手改 → `conflict`（不覆盖手改内容） | PASS |
| 结果 JSON 不含任何命令文本（无 `bash -lc` / `deploy` / `commandRedacted`），只有 `commandId`/`commandHash` | PASS |
| 源码不 import `exec-audit` / `write-journal`，剥注释后不含 `reset --hard` / `clean -f` | PASS |

### 3.3 承接 C —— auto checkpoint × restore barrier × UFTK 写工具

| 实测 | 结果 |
|---|---|
| 真实持有 `src/a.txt` 写锁（并以第二个写者 150ms 超时证明该锁确实排他）期间，auto checkpoint 仍完成 → 创建不取写锁，写者不阻塞它 | PASS |
| `withWorkspaceQuiesce` 下的 checkpoint 在 restore barrier 被他人持有时不推进（120ms 后仍未 settle），barrier 释放后完成 → 不会读到半应用的树 | PASS |
| 40 次连续 workspace 读租约洪流中，restore barrier 仍在 5s 内被授予 → **不饿死**（依赖 P6A 已修的层级 writer barrier） | PASS |
| 三方并发（4 个 quiesced auto checkpoint + 1 个 transaction restore + 2 个 UFTK 写者）全部 settle，无死锁；`lockContention` 有增量、`lockWaitMs` 不减、`lockTimeout` **无**增量 | PASS |

**过程更正**：第一版"创建不取写锁"用的是"写者 sleep 200ms，断言 checkpoint 先完成"的时序赛跑，结果在 Windows 上失败 —— `createCheckpoint` 要跑约 7 个 git 子进程，耗时超过 200ms。失败原因是测试假设错误，不是实现问题：我想验证的性质是"不被写锁阻塞"，而不是"比写者先结束"。改为显式持有锁句柄 + 第二写者超时证明排他性 + checkpoint 在持锁期间完成，性质不变但不再依赖时序。

### 3.4 承接 D —— 跨平台 starttime 提供者（选择"实现并实测"）

| 实测 | 结果 |
|---|---|
| `processStartTimeProviderAvailable()` 与运行平台一致 | PASS |
| 当前进程 starttime 稳定（清缓存后重读一致）、为安全整数、> 0 | PASS |
| 两个间隔 1.1s 启动的真实子进程，后者 starttime 严格更大 → pid 复用检测赖以成立的性质 | PASS |
| 已退出进程 → `null` | PASS |
| 非法 pid（0 / -1 / 1.5 / NaN）→ `null` 且**零探测** | PASS |
| pid 级缓存：首次 1 次探测，随后 40 次调用探测数不变 | PASS |
| 负结果同样缓存（20 次调用仍 1 次探测） | PASS |
| TTL 到期后重探并取到新值 | PASS |
| 超过 512 条上限时淘汰最旧，缓存不无界增长，最新条目仍命中 | PASS |
| 任意 pid 都不抛异常 | PASS |
| **win32 交叉比对**：提供者结果 == 独立 PowerShell 查询的 `StartTime.ToFileTimeUtc()` 截断到毫秒 | PASS |

**过程更正**：第一版缓存行为测试直接打真实 OS 提供者，700 个不同 pid → 700 次 PowerShell 子进程，套件被 120s 无输出看门狗杀掉。加了 `__setProcessStartTimeProbeForTest` 探测缝，让缓存语义（TTL / 淘汰 / 负缓存）用确定性假探测验证，平台探测本身仍由上面的真实 OS 用例覆盖。这与仓库既有的 `setMarkerProcessStartTimeResolverForTest` / `setProcessStartTimeResolverForTest` 约定一致。套件从被杀降到 7.18s。

**作用域自限**：只把 P6A 跨进程 marker 路径（`file-lock-manager.ts`，仅 `concurrencyV2` on 时运行）指向新提供者。**未**改 `session-write-lock.ts` / `infra/stale-lock-file.ts` —— 它们是 P1–P5 已验收路径，在无 flag 保护下改变其 stale 判定超出 P7 授权。

---

## 4. 门禁实测

| 门禁 | 结果 |
|---|---|
| `harness context` | exit 0 |
| `harness validate --no-diff`（结构性） | `Spec is valid`，exit 0 |
| `harness validate`（diff 模式） | **exit 1**，见 §5 诚实记录 |
| `coding-runtime-contract.test.ts` | 9/9 PASS（flag 数 10 → 12） |
| P6A 定向（7 文件） | 67/67 PASS |
| P6B 定向（6 文件，含新增 safety-retention） | 63/63 PASS |
| P7 定向（3 文件） | 49/49 PASS |
| 承接 D（`vitest.shared-core.config.ts`） | 12/12 PASS |
| coding-runtime 全目录回归 | **25 files / 234 tests PASS**（132.88s） |
| `dcs-prod-flags-catalog.test.ts` | 4/4 PASS |
| `typecheck:node` | exit 0 |
| `typecheck:web` | exit 0 |
| `contract:check` | `Contract check passed.` |
| `lint:bom` | `check-no-bom: ok` |
| `git diff --check -- <P7 文件>` | exit 0；新增未跟踪文件另行扫描：trailing whitespace 0、BOM 0、控制字节 0 |
| `verseshell:test` | 15 files / 141 tests PASS |
| `tsgo:core` | exit 0，无错误 |
| `tsgo:core:test` | 仅 3 项既有 RLG WIP + 1 项外部 goal-loop 项；**无任何 P6/P7 文件** |
| `config-schema-parity` | 128/129，唯一失败恰为预存 `runtime.memory.candidateGeneration`；新增 `execUndo`/`autoCheckpoint` 不在失败集合 |

### 全目录回归命令更正

`scripts/run-vitest.mjs` 在"120s 无输出"时杀整个进程组。P7 使该套件增长到约 133s，默认 reporter 运行期几乎不输出，于是被误杀（表现为 stall 而非失败）。加 `--reporter=verbose` 后每例都打印，看门狗不再误判。已写入规范 §7。

---

## 5. 诚实记录：`harness validate` diff 模式无法通过

diff 模式的变更集 = `origin/main...HEAD` + 暂存 + 未暂存 + 未跟踪。当前工作树实测：**vs origin/main 37 个变更 + 324 个脏/未跟踪文件**，其中约 250 个属于其它 workstream（RLG、goal-loop、UI、session-lifecycle 等）。

- 已做：把 P7 自己新增的 `openclaw_runtime/src/shared/process-start-time.ts(.test.ts)` 补进 spec `touchedAreas`。
- 已核：补后剩余未覆盖项中**没有任何 P6/P7 文件** —— 只剩 P1–P5 文件、task-forest proposal JSON、以及其它 workstream 的文件。
- 不做：把这些外部文件写进 `touchedAreas` / `residualPaths`。那等于伪造归属，比门禁红更糟。
- **对上一轮表述的更正**：P6 收卡时我写的"harness validate 通过"，其证据只能支撑**结构性**校验通过。diff 模式在当前多 workstream 脏树下无法通过，且并非 P6/P7 引入。规范 §7 已改为记 `--no-diff` 并附此说明。

---

## 6. 不变量与红线自查

| 红线 | 状态 |
|---|---|
| 不用 `git reset --hard` / `git clean -f` | 三个新模块剥注释源码扫描均无；由测试强制 |
| 不改模型对外 schema | 未新增/修改任何 TypeBox 工具 schema |
| 不新增结构化错误码 | P7 复用既有 7 个 `E_GIT_CHECKPOINT_*`；错误码 enum 未动 |
| 不新增第二套 merge / journal / 锁 / 审计真源 | bridge 只读 merge queue，落盘仍归 P6B transaction；三模块均不 import write-journal / FTS rollback（由测试强制） |
| 全部新 flag 默认 false | `execUndo` / `autoCheckpoint` 六处同步，默认 false，且父 `uftk.enabled` 打开也不带出（由 `dcs-prod-flags-catalog` 断言） |
| 产品锁不变 | `liveReady` / `productApproved` / `defaultOn` 未触碰 |
| 不擅自修无关文件 | 未改 `session-write-lock.ts` / `infra/stale-lock-file.ts` / `goal-wake-runtime*`；承接 D 的作用域自限见 §3.4 |
| 不把本地绿灯说成 GA / canary | 本报告标题与结论边界已声明 |

---

## 7. 已知 residual（移交独立验收裁决）

| # | 项 | 影响 | 建议 |
|---|---|---|---|
| R1 | `harness validate` diff 模式不通过（§5） | 非 P6/P7 引入；无法由 P7 单方修复 | 记为跨 workstream 问题；或由仓库层面约定 `diffBase` / 清理脏树 |
| R2 | 承接 D 未接 `session-write-lock.ts` / `infra/stale-lock-file.ts` | 这两条 P1–P5 路径在非 Linux 上仍无 pid 复用检测（有界延迟，非正确性） | 单列任务评估，需自带 flag 或独立验收 |
| R3 | win32 starttime 探测为 PowerShell 子进程（首次约数百 ms） | 仅真实争用时发生、每 pid 每秒最多 1 次；`isPidAlive` 先短路 | 若成为热点，考虑原生绑定；当前有界可接受 |
| R4 | `withWorkspaceQuiesce` 是可选辅助，auto checkpoint 默认不自动 quiesce | 不加 quiesce 时 turn 起点的 checkpoint 可能与并发 restore 交错 | 由 P7 的接线方（尚未接线到生产）决定是否强制 |
| R5 | 外部 workstream 临时允许项 `goal-wake-runtime.test.ts` 仍在 | 不占 P6/P7 额度，归属已按规定重新确认 | 归 goal-loop workstream 消除 |
