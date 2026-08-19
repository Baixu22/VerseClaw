# Coding Runtime P6 整体验收报告（2026-08-19）

> 阶段：**P6 整体** — 并发锁统一/硬化（A）+ Git Checkpoint v2（B）合并验收
> 规范依据：`docs/dev/coding-runtime-p6-p7-development-spec.md` §2.1（A+B 必须同时覆盖）/ §6.1 / §6.2 / §7 / §8 / §12.6；
> `harness/specs/tasks/coding-runtime-p6-p7-extension.md` → Scope Sequence 第 3 步「P6 independent acceptance: A then B, then **combined P6 regression**」
> 程序基线：`c673f0f29`（未 commit / 未 checkout / 未 reset / 未 clean；工作树含大量其它 workstream 的既有 WIP）
> 前置报告：`CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md`（verdict=ACCEPT_WITH_RESIDUAL）、`CODING-RUNTIME-P6B-ACCEPTANCE-2026-08-18.md`（同）、`CODING-RUNTIME-P6B-EVIDENCE-2026-08-18.md`
> 结论边界：本报告只覆盖 **P6 整体**。不是 P7 验收、不是 UFTK GA / canary / 整体成熟度结论。
> 产品锁：`liveReady=false`、`productApproved=false`、`defaultOn=false` 未变；全部 UFTK flag 默认 false。

---

## 0. 验收裁定

**verdict = ACCEPT_WITH_RESIDUAL**

P6A 与 P6B 各自的 10 项验收矩阵已在两份前置报告中逐项独立取证通过（合计 20/20）。本报告**不复述**那 20 项，只做单阶段验收在结构上做不到的三件事：

1. **A↔B 接缝的独立取证**——两阶段 restore（B）与文件级 UFTK 锁（A）真正对撞；
2. **合并回归**——A、B 两套在同一进程内一起跑，验证没有跨套件状态泄漏；
3. **P6 residual 台账合并**——含 P7 期间已实际消除的项。

### 本次合并验收的发现

**接缝存在一处零覆盖。** `git-checkpoint-transaction.ts:223-225` 以注释形式声明了它**不取**任何 per-path 锁的理由：

> "The P6A workspace barrier is a workspace-scoped writer lock: it already excludes every UFTK read/write lock under the root."

这条声明此前**从未被端到端验证过**：

| 层 | 已有覆盖 | 覆盖到的对撞 |
|---|---|---|
| P6A `lock-core.fairness.test.ts` | 有 | 合成 key，层级 barrier 公平性 |
| P6B `git-checkpoint-safety.test.ts`（3 例） | 有 | `acquireWorkspaceRestoreBarrier` **两侧都是 workspace-scope**（barrier vs barrier） |
| **真实 restore vs 真实文件级锁** | **无** | — |

规范 §6.1 的原文是「barrier 期间新 UFTK 写 **prepare** 等待或有界失败」，而"新 UFTK 写 prepare"是**文件级**获取，不是另一个 barrier 持有者。若该声明为假，后果不是"少一层保护"，而是**restore 既不取 per-path 锁、又不排除 per-path 写**——一次 UFTK 写可以落在 apply 中途。属于必须实测的项。

**实测结论：声明成立**，双向成立，见 §2。这是一处覆盖缺口而非缺陷；补测后该声明不再依赖代码阅读。

---

## 1. 合并验收的取证方式

不接受"A 通过 + B 通过 ⇒ P6 通过"。新增探针文件（本次产出，已入库）：

| 文件 | 用例数 | 覆盖 |
|---|---:|---|
| `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-transaction.p6-seam.test.ts` | 5 | 真实两阶段 restore ↔ 真实 `acquireCodingRuntimeFileLocks` 双向对撞 |

---

## 2. A↔B 接缝逐项实测

命令：

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/git-checkpoint-transaction.p6-seam.test.ts --maxWorkers=1 --reporter=verbose
```

结果：**1 file / 5 tests PASS**，7.10s。

| 接缝断言 | 结果 | 实测内容 |
|---|---|---|
| prepared restore 排除文件级 **writer**，settle 后放行 | PASS | `prepare()` 持 barrier 期间，对 in-scope 文件 `acquireCodingRuntimeFileLocks(mode:"write", 250ms)` 抛 `E_LOCK_TIMEOUT`；`applyAndSettle()` 后同一获取成功，文件内容为 checkpoint 版本 |
| prepared restore 排除文件级 **reader** | PASS | barrier 是 writer 锁，故 shared read 亦被排除——否则并发读会观察到半恢复的树 |
| barrier 是**工作区级**而非 scope 级 | PASS | scope 外的 `keep.txt`（restore 不会碰它）同样被排除。刻意钉住此项：排除面**宽于**变更面是安全方向，防止后来者以为"barrier 已经是 scope 级"而去收窄它 |
| in-flight 文件写使 restore prepare **有界失败**而非抢先 | PASS | 外部持文件写锁时 `prepare()` 返回 `rejected` / `status=failed`（reason 含 lock/timeout），且 dirty 文件**零变化**；写锁释放后同一 restore 成功 |
| 因锁被拒的 prepare **不泄漏 barrier** | PASS | 拒绝后另一路径的写锁可正常获取——若泄漏 barrier，进程内后续所有写都会死锁 |

### 2.1 单一锁权威（代码层独立核对）

接缝成立的结构性原因，逐条核对而非引述文档：

- `localLockStates` 在全仓**只有一处**：`lock-core.ts:64`。不存在第二套进程内调度器。
- `acquireWorkspaceRestoreBarrier`（`file-lock-manager.ts:609`）本体就是
  `acquireLocalLocks([workspaceScopeKey(root)], "write", …)`——barrier **不是并行机制**，而是同一调度器上的一把工作区级写锁。
- `locksOverlap`（`lock-core.ts`）令 workspace-scope key 与该 root 下**每个**文件 key 重叠；
  `blockedByActiveLeases` 因此在 barrier 持有期间挡住文件级写/读，
  `blockedByEarlierWaiters` 则提供跨层级的排队公平性（barrier 排队时后到的 reader 不能饿死它）。
- barrier 的全部消费方：`git-checkpoint.ts:1632`（P5/P6B 单发 restore）、
  `git-checkpoint-transaction.ts:232`（P6B 两阶段）、`auto-checkpoint.ts:290`（P7 取工作区**读**租约，故排在同一把写 barrier 之后）。
  A → B → C 三阶段共用同一权威，无旁路。
- `acquireCodingRuntimeFileLocks` 对 `acquireLocalLocks` 的调用**不受 flag 门控**（`concurrencyV2` 只门控跨进程 read marker），
  故上述层级排除在 flag off 时同样成立。

---

## 3. 合并回归

A 套 + B 套在**同一 vitest 进程**内一起跑（单阶段验收从未这样跑过，跨套件状态泄漏只会在这里暴露）：

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/file-lock-manager.test.ts \
  src/agents/coding-runtime/file-lock-manager.xproc-read.test.ts \
  src/agents/coding-runtime/lock-core.test.ts \
  src/agents/coding-runtime/lock-core.fairness.test.ts \
  src/agents/coding-runtime/file-transaction-service.concurrency.test.ts \
  src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts \
  src/agents/sessions/tools/file-mutation-queue.test.ts \
  src/agents/coding-runtime/git-checkpoint.test.ts \
  src/agents/coding-runtime/git-checkpoint.restore.test.ts \
  src/agents/coding-runtime/git-checkpoint.scoped.test.ts \
  src/agents/coding-runtime/git-checkpoint-safety.test.ts \
  src/agents/coding-runtime/git-checkpoint-lifecycle.test.ts \
  src/agents/coding-runtime/git-checkpoint-safety-retention.test.ts \
  --maxWorkers=1 --reporter=verbose
```

| 项目 | 结果 |
|---|---|
| P6 合并回归（A∪B 单进程） | **13 files / 131 tests PASS**，77.31s，exit 0 |
| A↔B 接缝探针 | **1 file / 5 tests PASS**，7.10s |
| coding-runtime 全目录（含 P7） | 见 §5 门禁表 |

---

## 4. §6.1 / §6.2 矩阵状态

两阶段矩阵合计 **20/20 PASS**，逐项证据与实测数字见前置报告，本报告不复述：

- §6.1（P6A 并发锁）10/10 → `CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md` §3 + §3.4（性能）
- §6.2（P6B Git Checkpoint v2）10/10 → `CODING-RUNTIME-P6B-ACCEPTANCE-2026-08-18.md` §3

其中 **3 项是在独立验收期先被证伪、修复后才成立**，不是文档问题：

1. §6.1 层级 writer barrier 失效（跨作用域饿死保护不成立）；
2. §6.1 亚毫秒争用不计数（`waitedMs` 取 1ms 下限并无条件记录后修复）；
3. §6.2 scoped restore 用 `read-tree` 整体覆盖 index，会动 scope 外条目（改 `update-index --add --remove` 后修复）。

规范 §6.1 / §6.2 的勾选框已于本次回填（此前 20 项全空，属记录缺口，非实测缺口）。

---

## 5. P6 residual 合并台账

| ID | 内容 | 当前状态 |
|---|---|---|
| P6A-R1 | 非 Linux 平台无 process starttime 提供者，pid 复用检测退化为 `staleMs` 年龄界 | **已消除**（P7 承接 D：`src/shared/process-start-time.ts`，win32/darwin 提供者 + pid 级 TTL 缓存，12/12 实测；可用性经 `inspectCodingLocks().pidReuseDetectionAvailable` 对外可见） |
| P6B-R3 | safety ref 与普通 checkpoint 共用 ref 命名空间，可被 retention/prune 删除 | **已消除**（P7 承接 A：`refs/openclaw/uftk-safety/` 独立命名空间 + 每个删除点断言命名空间 + 显式命名的 `retainSafetyCheckpoints`；8 例实测） |
| P6B-R? | retention 排序为秒级精度，同秒突发下 `maxCount` 可删掉最新 checkpoint | **已消除**（P7 验收期发现并修复：改用 commit subject 内已有的毫秒 ISO 戳作排序键，不改元数据格式） |
| P6-R-carry | safety snapshot 在 scope 含"磁盘上不存在的文件"时整体失败（`git add -A -- <不存在路径>` pathspec 未匹配） | **已消除**（P7 期间发现的 P6B 遗留缺陷：`writeCheckpointCommit({ skipMissingPaths: true })` + safety 层回归测试）。P6B 的作用域测试一律用目录 scope，故零覆盖 |
| P6-R1 | `harness validate` diff 模式 exit 1 | **仍开放**，非 P6/P7 引入：变更集含约 250 个其它 workstream 文件。结构性校验（`--no-diff`）通过。把外部路径写进 `touchedAreas`/`residualPaths` 等于伪造归属，故不做 |
| P6-R2 | 跨平台 starttime 未接入 `session-write-lock` / `infra/stale-lock-file` | **已消除（2026-08-19 实修，用户授权后）**：两处默认提供者改为 `getCachedProcessStartTime`，非 Linux 上 pid 复用检测由静默降级变为真正生效。兼容性双向安全（Linux 委派同一 `/proc` reader，单位不变；Windows/macOS 旧代码从不写入 `starttime`，故无旧值可被误读）。新增 `src/infra/stale-lock-file.test.ts`（10 例，此前两模块零专属测试）。同时修掉两个由此暴露的真实缺陷，见 §5.2 |
| P6B-R4 | recovery 目录默认落在 `<stateDir>/uftk-recovery/<id>`，偏离规范初稿字面的 `.openclaw/recovery/<id>` | **已决定并记录**：收卡时代为决定接受该偏离，规范 §4.2 与头部第 8 行已就地更正。理由是硬的——往工作区写备份会新增 untracked 条目，直接破坏 §6.2 不变量「scope 外路径 `git status` 前后一致」；P5 已用同一理由把 checkpoint 锁文件放 state dir。调用方仍可用 `recoveryDir` 显式改回工作区内路径 |
| P6-R5 | `tsgo:core:test` 外部临时允许项 `goal-wake-runtime.test.ts` | **仍开放**：归 goal-loop workstream 消除；不占 P6/P7 额度。收卡时代为决定记为临时允许项，P7 已按规定重新确认归属（mtime 未变，仍属该 workstream） |
| P6-R7 | `resolveRecoveryDir`（P6B 导出）零引用死代码 | **已消除（2026-08-19 实修）**：细看后发现它不只是零引用，而是与 `git-checkpoint-safety.ts` 里真正写入的路径构造**重复且已漂移**（一份 `path.resolve(stateDir)`，一份不走）——相对 `stateDir` 下会把调用方指向 snapshot 从未写入的目录，正是 `recovery_required` 之后唯一要走的那次查找。已单源化到写入方模块 + 删除重复定义与失效 import + 新增等价性回归 |

**六项 P6 residual 已消除**：四项由 P7 消除（不是转移、不是重新表述），两项（P6B-R7 单源化、P6-R2 跨平台 starttime 接线）于 2026-08-19 用户授权后实修。余下三项：P6B-R4 已在收卡时决定并记录在规范 §4.2；P6-R1（harness diff 基线）与 P6-R5（外部 workstream 类型错误）都不是 P6/P7 的缺陷，归属见 §5.3。

### 5.2 R2 实修，以及它暴露的两个真实缺陷（2026-08-19，用户授权后）

**R2 本体**：`session-write-lock.ts` 与 `infra/stale-lock-file.ts` 的默认 starttime 提供者由 Linux-only 的 `/proc` reader 改为 `getCachedProcessStartTime`。此前后果不是崩溃而是**静默降级**：非 Linux 上「pid 存活但已被复用」与「pid 存活且仍是原 owner」不可区分，一个被死进程遗留、pid 已被重分配的锁会一直被判为存活，直到 age bound 到期。

兼容性双向安全，逐条核对而非推断：

- **Linux**：`process-start-time.ts` 的 linux 分支直接委派 `getProcessStartTime` **本体**，值与单位完全不变，旧锁比较结果不变。
- **Windows / macOS**：旧 reader 恒返回 `null`，而写入端有 `if (starttime !== null)` 守卫，所以这两个平台的旧锁**从未记录过** `starttime`；新代码读到 `undefined` 即跳过比较，不存在「用新单位去比旧值」的窗口。

这两个模块此前**零专属测试**（只被 coding-runtime 间接覆盖），这正是缺口能跨五个阶段存活的原因。新增 `src/infra/stale-lock-file.test.ts`（10 例），其中钉住的核心不对称是：**「无法证明被复用」必须退化为 age bound，绝不能读成「已被复用」**——否则会从存活 owner 手里抢走锁。

接线过程中查出两个真实缺陷，都是接线本身引入或暴露的：

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | **自身 pid 每秒重探**。`session-write-lock` 在 `payload: () => {…}` 里为**每一次**锁获取写 owner payload，其中包含 `getCachedProcessStartTime(process.pid)`。共享 TTL 是 1s，于是会话写入热路径上每秒重探一次；实测冷 PowerShell 探测 **912–1297ms** | 会话写入路径每秒最多一次近 1s 的同步 stall，而**自身进程的启动时间在进程生命周期内不可能改变**，重新验证毫无收益 | `process-start-time.ts` 为 `process.pid` 增加**无 TTL 的永久 memo**（仅自身安全：任何其它 pid 都可能被复用，那正是这个 token 存在的理由）。测试种子同步清除该 memo，否则探针注入对自身 pid 会失效。新增 3 例：50 次调用 + 跨 TTL 仅 1 次探测、自身不占用有界缓存槽位因而不会被淘汰、reset 种子确实清除 memo |
| 2 | **死 pid 白跑子进程探测**。`shouldRemoveDeadOwnerOrExpiredLock` 原本**先探测 starttime、后判 `isPidDefinitelyDead`**。而 `process-start-time.ts` 的模块契约明写「每个调用方都先查 `isPidAlive`，死 pid 会短路」——该函数违反了这个前置条件 | 每个「owner 已死」的锁清理都白跑一次 PowerShell（约 900ms），而结果根本不受影响：死 owner 无论如何都是 stale | 调换顺序：先 `isPidDefinitelyDead`（廉价的 `process.kill(pid,0)`），仅在存活时才比较 starttime。六种输入组合逐一核对语义**完全等价**（dead+mismatch / dead+match / dead+无 token / alive+mismatch / alive+match / alive+无 token）。新增 2 例：死 owner 判定时探测计数为 0、存活 owner 仍探测 1 次 |

回归：`infra` 全套 **6 files / 31 tests PASS**、`process-start-time` **15/15**、`embedded-agent-runner`（session-write-lock 的主要消费方）**7 files / 53 tests PASS**、coding-runtime 全目录 **29 files / 256 tests PASS**。`tsgo:core:test` 错误集合未变，四个变更文件均不在其中。

### 5.3 关于 P6-R5（外部 workstream 的类型错误）

R5 不是「等谁批准」，而是**归属问题**。`tsgo:core:test` 的 12 个错误分布在 5 个文件，**全部 untracked**（从未提交），且其中两个的 mtime 就在本会话进行中：

| 文件 | 错误 | 修它意味着什么 |
|---|---|---|
| `goal-wake-runtime.test.ts` ×2 | `alreadyAcked` 不存在于 `GoalWakeAckResult` | 测试断言了一个生产类型里没有的字段——**要修就得替对方实现这个特性**，语义我无从得知 |
| `session-drain-service.test.ts` ×1 | `reason` 不存在于 `{ ok: false }` | 要么给生产联合类型加字段（发明对方 API），要么削弱对方的断言 |
| `session-activity-projection.test.ts` ×2 | `MissionRunRecord` 未导出；`"killed"` 不属于 `SubagentLifecycleEndedReason` | 后者需要知道 `"killed"` 是否是合法 reason |
| `session-reset-service.stop/.subagent-stop.test.ts` ×7 | 测试 fixture 缺 `SessionEntry` 必填的 `updatedAt` | 纯机械，但仍是对方正在编辑的文件 |

一个 typecheck 不通过的 WIP 测试文件是**正常的开发中状态**，不是已发布代码里的缺陷。改它不是修 bug，而是逼别人未完成的工作先编译过，并且会与对方正在进行的编辑冲突。因此判定标准始终只有一条：**错误集合中不得出现任何 P6/P7 文件**（本次实测：无）。

### 5.4 形式门禁的诚实记录

P6B 报告 §5 曾记「形式门禁悬空项：规范 §11 要求 P6A 独立验收经用户确认后 P6B 才成立」，并在 §6 写「P6 收卡尚需：用户确认 P6A 与 P6B 两份 verdict」。实际发生的顺序是：

- 用户以「**进入 p7**」授权 P7 启动。按规范 §11「P6 整体验收通过且用户确认后，P7 才可进入讨论/实施」，该授权即构成对 P6 的确认——这是解锁 P7 的唯一门。
- `TF-0075` 随后收为 `done`（100%，with residual）。
- 但**本报告（P6 整体验收）在当时并不存在**，而 §12.6 与 harness spec 的 Scope Sequence 都要求它。也就是说 P6 收卡时缺一份规范要求的交付物；本报告即补齐该缺口，并借机补上唯一未被覆盖的 A↔B 接缝取证。

记录此项是为了让"P6 已收卡"这句话对应到可核查的交付物集合，而不是对应到一次口头确认。

---

## 6. 门禁（2026-08-19 本次合并验收时刻实跑）

| 门禁 | 结果 |
|---|---|
| P6 合并回归（A∪B 单进程，13 文件） | **13 files / 131 tests PASS**，77.31s |
| A↔B 接缝探针 | **5/5 PASS**，7.10s |
| coding-runtime 全目录（含 P7） | **30 files / 266 tests PASS**（含 R7 等价性回归与 `inspectCodingLocks()` 10 例） |
| `infra` 全套（含新增 `stale-lock-file.test.ts`） | **6 files / 31 tests PASS** |
| `process-start-time`（含自身 pid memo 3 例） | **15/15 PASS** |
| `embedded-agent-runner`（session-write-lock 主消费方） | **7 files / 53 tests PASS** |
| 承接 D（shared-core `process-start-time`） | **12/12 PASS** |
| `tests/unit/coding-runtime-contract.test.ts` | **9/9 PASS**（flag 数 12，全 false） |
| `dcs-prod-flags-catalog` | **4/4 PASS** |
| `typecheck:node` | **0 error**（exit 0） |
| `typecheck:web` | 收卡后复跑变红：`Sidebar.tsx` 13 项 + `SessionActivityPanel.tsx` 1 项，均为 renderer 文件，mtime 09:26/09:09（复跑当分钟仍在被写）。归属可判定：`tsconfig.web.json` 的 `include` 为 `["src","shared"]`，而本阶段全部 TS 改动都在 `openclaw_runtime/src/**`，**无一落在其范围内**。详见规范 §7 |
| `tsgo:core` | **0 error**（exit 0） |
| `tsgo:core:test` | 5 项外部文件（3 项 RLG WIP + `goal-wake-runtime.test.ts` + `session-activity-projection.test.ts`）；**无任何 P6/P7 文件**，含新增接缝测试。详见规范 §7 |
| `contract:check` | PASS |
| `lint:bom` / `lint:dcs` | exit 0 / exit 0 |
| `eslint`（新增接缝测试） | exit 0 |
| `git diff --check` | exit 0（仅其它 workstream 文件的 CRLF 提示，无空白错误） |
| `verseshell:test` | **15 files / 141 tests PASS** |
| `config-schema-parity` | 128/129，唯一失败为预存的 `runtime.memory.candidateGeneration`；P6/P7 新 leaf 均不在失败集合 |
| `harness validate --no-diff` | `Spec is valid` |
| `harness context` | exit 0 |
| flag / 产品锁 | 12 项 flag 全 false；`liveReady`/`productApproved`/`defaultOn` 三项未动 |

**说明**：全目录 29 files 已覆盖 P6A / P6B / P7 三份定向清单中位于 `src/agents/coding-runtime` 的全部文件；
定向清单里唯一位于该目录之外的 `src/agents/sessions/tools/file-mutation-queue.test.ts` 由上方 P6 合并回归覆盖。
`tsgo:core:test` 的 5 项外部文件本次实测归属未变（均 untracked，`session-activity-projection.ts` mtime 2026-08-19 00:07
即本次会话进行中由并发 workstream 写入），按规范"不得擅自修复无关文件"不予处理，且**不**列为常设允许项。

---

## 7. 边界声明

- 本报告是 **P6 整体验收**，不覆盖 P7（P7 见其独立报告，verdict 待用户确认）。
- P6 全部能力仍**无生产调用方**、**无 flag 翻转**、**无模型对外 schema 变更**。
- 用户可见 `README.md` / `README.zh-CN.md` / `README.ja-JP.md` **刻意未同步**：规范 §12.5 把这三份的同步条件写为"如果用户可见行为变化"，而 P6/P7 全部 flag 默认关闭且无生产工具路径 import，故零用户可见变化。把一个关着且未接线的能力写进用户 README，本身就违反"不声称 GA / canary / 成熟度"。本工作树中这三份文件的改动全部属其它 workstream（Workgroups 拖拽分组、composer footer、Runtime Lifecycle Governance Phase 2），P6/P7 未触碰。
- 本地绿灯**不**构成 UFTK GA、canary 或整体成熟度结论。
- 本次未使用 `git reset --hard` / `git clean -f`，未 commit、未 checkout、未修改无关 workstream 文件。
