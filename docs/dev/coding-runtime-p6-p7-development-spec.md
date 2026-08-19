# Coding Runtime P6/P7 扩展开发规范（Development Specification）

> 状态：**P6（A+B）与 P7（C）均已收卡**（2026-08-19）。两阶段 verdict 皆为 ACCEPT_WITH_RESIDUAL 且经用户确认。
> 验收报告：`reports/CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md`、`reports/CODING-RUNTIME-P6B-ACCEPTANCE-2026-08-18.md`、**`reports/CODING-RUNTIME-P6-ACCEPTANCE-2026-08-19.md`（P6 整体）**、`reports/CODING-RUNTIME-P7-ACCEPTANCE-2026-08-18.md`；开发自检：`reports/CODING-RUNTIME-P6B-EVIDENCE-2026-08-18.md`、`reports/CODING-RUNTIME-P7-EVIDENCE-2026-08-18.md`
> P6 验收中修复 3 个真实缺陷：P6A 层级 writer barrier 失效（活性）、P6A 亚毫秒争用不计数（可观测性）、P6B 超覆盖范围 scope 请求会删除内容（**数据破坏**，已固化为 §4.2 不变量 8）。
> P7 开发中修复 1 个 P6B 遗留缺陷：safety snapshot 在 scope 含"磁盘上不存在的文件"时因 `git add -A` pathspec 未匹配而整体失败（见 §4.2 `skipMissingPaths`）。P6B 只用目录作用域测过，故未暴露。
> P6 遗留项 A/B/C/D 已在 P7 全部落地（§4.3），承接 D 选择"实现并实测"而非顺延。
> 收卡时代为决定的两项（§4.2 与 §7 已就地更正）：recovery 目录默认 `<stateDir>/uftk-recovery/<id>`；`goal-wake-runtime.test.ts` 记为外部 workstream 临时允许项、不占 P6/P7 residual 额度（P7 已按规定重新确认归属，见 §7）。
> 上游依据：`docs/dev/coding-runtime-development-spec.md`（Phase 0-5 已全量验收，verdict=ACCEPT_WITH_RESIDUAL）
> 任务图：`TF-0075`（P6，done with residual）、`TF-0076`（P7，done with residual，depends_on TF-0075）
> 适用范围：ClawX / OpenClaw Coding Runtime UFTK 的并发锁与 git checkpoint 能力扩展
> 结论边界：本规范是本地工程开发规划，不代表 UFTK GA / canary / 整体成熟度；产品锁与全部现有 flag 保持 false。

---

## 1. 为什么做这次扩展（基于当前代码的实际缺口）

P1-P5 已交付统一文件事务、并发锁、exec 审计、审计回放与 git checkpoint。当前代码的实际短板：

### 1.1 并发读写

| 现状 | 缺口 |
|---|---|
| `sessions/tools/file-mutation-queue.ts` 与 `coding-runtime/file-lock-manager.ts` 是两套进程内 RW 调度器 | 同一文件存在两条队列语义；UFTK on 时 write/edit 先过 file-mutation-queue，FTS prepare 再拿 file-lock-manager，调试与超时语义割裂 |
| `file-lock-manager.ts` 写锁复用 `session-write-lock` / `infra/file-lock-manager` | 底层只有排他锁；**读锁只在本进程生效**，跨进程 read/write 不互斥 |
| `withFileReadQueue` 已实现 | 生产读工具基本未接入；共享读没有真实调用方 |
| 锁范围是单文件 / 多文件集合 | 没有目录前缀锁、工作区级 restore barrier；git restore 期间 write 工具仍可进入 |
| `baseVersion` 检查在 `prepare` 内完成 | 没有 commit 前最终 CAS 复查；跨进程窗口靠写锁兜底，但可观测性不足 |
| 锁等待 / 争用 / stale 回收无指标 | `coding-observability.ts` 没有 lock 计数器，现场问题难以诊断 |
| `normalizePatchLockPath` 只做 Windows 小写 | realpath / symlink / hardlink / case 归一化不完整，存在锁旁路风险 |

### 1.2 Git Checkpoint

| 现状 | 缺口 |
|---|---|
| `git-checkpoint.ts` create 是整树 temp-index + `write-tree` | 无法按路径作用域创建/恢复；大仓库成本高 |
| restore 整树 `checkout-index -a -f` | 会覆盖无关路径的未提交内容；当前 dirty 文件只有 `diagnostic.beforeStatus`，不保留字节 |
| 冲突检测只覆盖“路径被目录/符号链接阻挡” | 脏文件内容冲突没有逐文件保护 / recoveryRef |
| restore 互斥用独立工作区 lock | 与 write/edit/apply_patch 的文件锁不是同一屏障 |
| 没有 checkpoint 生命周期 | 无 label、diff、export patch、retention/prune、GC、失败续跑 |
| root `.git` 为 worktree 文件、submodule 一律 unsupported | 没有主仓 worktree 支持与可配置降级策略 |
| 与 `worktree-service.ts` 并行 | 两套 git 能力面，未复用 merge queue / conflict policy |

---

## 2. 目标与阶段划分

### 2.1 P6：并发锁硬化 + Git Checkpoint v2（必须同时覆盖 A + B）

- **P6A（先做）：并发锁统一与硬化**
  1. 统一进程内 RW 调度器，保留 `withFileMutationQueue(file, fn)` 兼容签名。
  2. 跨进程共享读锁 / 写排他锁，复用并扩展既有 session-write-lock 协议，不自造第二套锁权威。
  3. 锁范围扩展：多路径稳定排序、目录前缀锁、工作区 restore barrier。
  4. 乐观并发补强：commit 前锁内 CAS 复查，结构化 `E_CONFLICT`。
  5. 锁可观测：wait / contention / stale-reclaim / timeout 计数与只读 inspect API。

- **P6B（后做，依赖 P6A）：Git Checkpoint v2**
  1. 路径作用域 create / restore / list / diff。
  2. restore 前自动 safety checkpoint（受 flag 控制），用户内容不静默丢失。
  3. 两阶段 restore 事务：prepare 冲突检查 + safety snapshot + 拿齐写锁；apply 才落盘；失败可回退或 `recovery_required`。
  4. checkpoint 生命周期：label、diff、export patch、retention/prune、GC、失败续跑。
  5. worktree / submodule 明确策略：主仓 worktree 支持；submodule 默认 unsupported 或显式 skip + warning，不做静默半支持。
  6. restore 屏障：restore 期间阻止新的 UFTK 写 prepare，等待既有写 drain。

### 2.2 P7：工作流级扩展（C，P6 验收通过后解锁）

1. **exec 文件副作用撤销**：用 P3 `CodingExecEvent.sideEffects` 选路径，调用 P6B 路径作用域 restore；只承诺工作区文件副作用，明确不承诺网络 / DB / 远端 push 回滚。
2. **与 worktree-service 协同**：git checkpoint 恢复可走 `worktree-service.ts` 的 merge queue / conflict policy / review diff，避免两套 git 能力面长期并行。
3. **自动 checkpoint**：turn 开始 / 长任务前自动创建，label 绑定 `requestId`；默认关闭，带 retention 与 observability。
4. **P7 可选产物**：checkpoint 间 patch export、review diff 视图、恢复建议。

---

## 3. 范围与非目标

### 3.1 在范围内

- P6A：统一 RW 锁、跨进程共享读、锁范围、restore barrier、CAS 复查、锁可观测。
- P6B：路径作用域 git checkpoint、safety snapshot、两阶段 restore、生命周期、worktree/submodule 策略。
- P7：exec 文件副作用撤销、worktree-service 桥接、自动 checkpoint（全部默认关闭）。
- 对应单测 / 集成测试 / 性能证据 / 文档同步 / task forest 节点。

### 3.2 非目标

- 不做 OS 级沙箱重写；VerseShell 继续负责沙箱。
- 不做分布式文件系统 / 多机一致性强保证。
- 不实现 shell 外部副作用完整回滚（网络、远端 push、数据库、依赖安装）。
- 不改变 write / edit / apply_patch / exec 模型对外 TypeBox schema。
- 不新增第二套审计 sink / 锁 / 队列 / journal / 状态真源。
- 不把本地绿灯表述为 UFTK GA / canary / 整体成熟度。
- P7 的自动 checkpoint 不默认开启，不替代 write-journal。

---

## 4. 模块与设计要点

### 4.1 P6A 并发锁

**新增 / 修改模块**

- `openclaw_runtime/src/agents/coding-runtime/lock-core.ts`
  - 唯一进程内 RW 调度器：read-shared / write-exclusive / FIFO + writer barrier。
  - 多路径稳定排序；路径去重使用扩展后的 canonical path key。
- `openclaw_runtime/src/agents/coding-runtime/file-lock-manager.ts`
  - 改为 lock-core 的兼容门面；`withFileMutationQueue` / `withFileReadQueue` 保留签名。
  - 跨进程 shared-read 协议：reader owner 注册 sidecar（pid / starttime / createdAt / leaseId），writer 等待 reader drain；reader 注册前检查 writer 锁，避免经典读写竞争窗口。
- `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts`
  - 保留对外 API，内部 delegate 到 lock-core（兼容 P1/P2 测试与既有调用方）。
- `openclaw_runtime/src/context-engine/coding-observability.ts`
  - 新增 `lockWaitMs` / `lockContention` / `lockTimeout` / `staleLockReclaimed` / `restoreBarrierWaitMs`。
- `openclaw_runtime/src/agents/coding-runtime/lock-inspection.ts`
  - 只读 `inspectCodingLocks()` 返回 held/waiting 摘要，供诊断与测试。

**协议不变量**

1. 同文件 read-read 并发；read-write、write-write 互斥。
2. 跨进程同样满足 read-read 共享 / write 排他。
3. 所有锁带 timeout、owner、stale 检测；stale 判定复用 pid + starttime，不允许只看 pid。
4. 多路径按 canonical key 排序获取，避免死锁。
5. restore barrier 是一个工作区级 writer barrier，不等同于文件状态真源。
6. CAS 复查在 commit 的既有锁内执行；不一致返回结构化 `E_CONFLICT` + diff，目标零变化。

### 4.2 P6B Git Checkpoint v2

**新增 / 修改模块**

- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint.ts`
  - 保留现有整树 API 语义；新增 `createCheckpoint(options?: { paths?, label? })` 与 `restoreCheckpoint(id, options?: { paths?, safety?: ... })`。
  - 路径作用域仍使用 temp `GIT_INDEX_FILE`，但只 `git add` / `read-tree` 目标路径，输出 tree 后写私有 ref；restore 只 `checkout-index` 受影响路径。
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-safety.ts`
  - restore 前为受影响路径生成 safety checkpoint；返回 `safetyRef`。
  - **P7 承接 A**：safety ref 写入独立命名空间 `GIT_CHECKPOINT_SAFETY_REF_PREFIX = refs/openclaw/uftk-safety`，与普通 checkpoint 前缀是兄弟关系。lifecycle retention/prune 只枚举 checkpoint 前缀，因此任何策略都枚举不到 safety ref；删除点另有 `assertRefInNamespace` 断言兜底。回收 safety ref 只能走显式命名的 `retainSafetyCheckpoints(policy)`，且空策略不删任何东西。
  - **P7 修复（P6B 遗留缺陷）**：safety snapshot 走 `writeCheckpointCommit({ skipMissingPaths: true })`。restore 的 scope 合法地包含磁盘上不存在的文件（正要被恢复的已删除文件），而 temp index 是空的、`git add -A -- <不存在的路径>` 会以 `pathspec did not match any files` 整体失败 —— 即"要恢复一个被删除的文件时，safety snapshot 反而拿不到"。P6B 的作用域测试一律用目录（目录总能匹配），因此该形状未被覆盖。`createCheckpoint` 不开此选项：用户显式指定一个不存在的路径仍是结构化 `failed`。
  - 原始字节备份目录默认 `<stateDir>/uftk-recovery/<id>`（**实现落地时相对本规范初稿的更正**：初稿写工作区 `.openclaw/recovery/<id>`，但往工作区写备份会新增 untracked 条目，直接破坏下方不变量 3「无关路径 `git status` 前后一致」；P5 已用同一理由把 checkpoint 锁文件放在 state dir）。调用方可通过 `recoveryDir` 显式改回工作区内路径。
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-lifecycle.ts`
  - `listCheckpoints` 带 label / scope / createdAt / parent；
  - `diffCheckpoints(a, b)`、`exportPatch(id)`、`retainCheckpoints(policy)`、`pruneCheckpoints()`。
  - **P7 承接 A**：新增 `listSafetyCheckpoints()` / `retainSafetyCheckpoints(policy)`，safety 命名空间只能由后者回收；`collectGarbage` 也动不了 safety 内容，因为 safety ref 让其对象保持可达。
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-transaction.ts`
  - 两阶段 restore：prepare（resolve tree、冲突扫描、safety snapshot、获取 workspace barrier 与跨进程 restore 锁）→ apply（checkout + index update + scoped extraneous removal）→ settle（成功清理 / 失败回退或 `recovery_required` + recoveryRef）。
  - **实现落地更正**：prepare 不在 workspace barrier 之下再获取受影响路径的 per-path 写锁 —— workspace 作用域锁与其下任何文件锁互斥，嵌套获取会自锁死。barrier 本身即为互斥机制；跨进程互斥由 `acquireCheckpointRestoreLock`（复用既有 session-write-lock）提供，获取顺序固定为 barrier → 跨进程锁，与 P5 路径一致。

**不变量**

1. 继续禁止 `git reset --hard` / `git clean -f`。
2. create 不改真实 index / worktree；restore 后 index 与 worktree 一致。
3. 路径作用域 restore 不得触碰作用域外路径；无关路径 `git status` 前后一致。
4. restore 前 dirty 内容必须先进入 safety snapshot；冲突不静默覆盖。
5. restore 失败必须结构化：`failed` / `conflict` / `recovery_required` + diagnostic，不假成功。
6. git checkpoint 仍不替代 write-journal 回滚；两条路径不互相污染。
7. root `.git` 为 worktree 文件时解析 `git rev-parse --git-common-dir` 支持主仓；submodule 默认 `unsupported` 或显式 skip + warning，不接受静默半支持。
8. **显式请求的 restore scope 必须被该 checkpoint 记录的 scope 覆盖**（`full` checkpoint 覆盖一切）。未覆盖时结构化拒绝、零改动 —— 否则该 scope 下的文件会因"不在 checkpoint tree 中"被判为待删除而被删掉，等于用一个从未覆盖它的 checkpoint 作为删除依据。此项为 P6B 独立验收阶段发现的数据破坏性缺陷，修复后由 `scopeIsCoveredByCheckpointScope` 强制。

### 4.3 P7 工作流扩展（C）

**P6 遗留项承接（P7 范围内必须处理，不得再次顺延）—— 全部已落地**

P6 两轮独立验收的修复与 residual 直接决定 P7 的安全性，故显式并入 P7 范围：

- **承接 A（必须）—— safety ref 独立命名空间**（P6B residual R3）。**已完成**：safety ref 迁到 `refs/openclaw/uftk-safety/`，retention 只枚举 checkpoint 前缀 + 删除点 `assertRefInNamespace` 双重保证；回收仅限显式的 `retainSafetyCheckpoints(policy)`，空策略不删任何东西。回归：`git-checkpoint-safety-retention.test.ts`（8 例）+ `auto-checkpoint.test.ts` 的端到端（大量 auto checkpoint + `maxCount:0,maxAgeMs:0` + 一次 `recovery_required`，之后 safetyRef 仍读出 restore 前内容）。
- **承接 B（必须）—— exec undo 依赖 scope 覆盖守卫**（P6B 不变量 8）。**已完成**：`exec-side-effect-undo.ts` 在本层显式调用 `scopeIsCoveredByCheckpointScope`（不只依赖 transaction 内的二次校验，因为需要在调用前算出可覆盖子集）；未覆盖 → 结构化 `unsupported` + 零改动。缩小范围必须由调用方显式 `allowPartial: true` 要求，并回报 `skipped`，绝不静默变窄。回归含"窄 checkpoint + 更宽 scope 时不会因不在 tree 中而删除文件"的直接复现用例。
- **承接 C（必须）—— auto checkpoint 与 restore barrier 的并发正确性**（P6A 修复 1）。**已完成**：`auto-checkpoint.test.ts` 实测三项 —— 创建 checkpoint 不取写锁（用真实持有的文件写锁 + 第二个写者超时证明锁确实排他，checkpoint 仍在其持有期间完成）；`withWorkspaceQuiesce` 下的 checkpoint 会等待 restore barrier 而非读到半应用的树；40 次连续 workspace 读租约的洪流中 restore barrier 仍能被授予（不饿死，依赖 P6A 已修的层级 barrier）。第四例三方并发跑完无死锁且 `lockContention` 有增量、`lockTimeout` 无增量。
- **承接 D（可单列）—— 跨平台 starttime 提供者**（P6A residual R1）。**已完成实现并实测**（未顺延）：新增 `openclaw_runtime/src/shared/process-start-time.ts`，Linux 走 `/proc`（无子进程），win32 用 `powershell -NoProfile` 取 `StartTime.ToFileTimeUtc()`，darwin 用 `LC_ALL=C ps -o lstart=`；带 pid 级 TTL 缓存（1s）+ 512 条上限 + 负结果也缓存，把 25ms 轮询热路径的 ~40 次/秒探测压到 ≤1 次/秒/pid。返回值是**平台内不透明身份令牌**（Linux 时钟节拍 / win32 FILETIME / darwin epoch ms），只与同平台同主机的同一提供者产物比较，不得当作可移植时间戳。任何失败返回 `null`，退化回 pid 存活 + `staleMs` 年龄界（即原有行为），探测绝不向锁获取抛异常。
  - **作用域自限**：只把 P6A 的跨进程 marker 路径（`file-lock-manager.ts`，仅 `concurrencyV2` on 时运行）指向新提供者。**不**改 `session-write-lock.ts` / `infra/stale-lock-file.ts` —— 那是 P1–P5 已验收路径，在无 flag 保护下改变其 stale 判定不是 P7 该做的决定；两者各自已有注入缝，可后续单独评估。

**P7 新增模块（已落地）**

- `exec-side-effect-undo.ts`：P3 `sideEffects` 路径集合 → P6B 路径作用域 restore。只承诺工作区文件副作用；网络 / DB / 远端 push / 依赖安装明确不回滚也不声称回滚。`beforeHash`/`afterHash` 为 null 表示该 exec 未拍工作区快照，此时空 `sideEffects` 是**证据缺失而非无变更**，返回 `unsupported` 而不是 `noop`。任一路径无法证明是工作区文件即整体拒绝（零改动），因为部分撤销会让工作区既不匹配 exec 前也不匹配 exec 后。只读取 P3 已持久化的 `commandId`/`commandHash`，raw command 不进入本模块。
- `checkpoint-worktree-bridge.ts`：以 worktree merge queue 为冲突权威。**刻意不调用 `processMergeQueue`** —— 它会把 worker 的文件拷进主工作区，用它"探测"冲突等于把探测变成写操作；因此桥只 `getMergeQueue()` 读队列，落盘仍由 P6B transaction 唯一负责。走 `prepare` → 查重叠 → 有重叠则 `release()` 零改动返回 `conflict`（带 `disposition`），无重叠才 `applyAndSettle`。三种 `MergeConflictPolicy` 都不放行 restore，只影响回报的处置方式：`escalate` / `return_worker` 是路由决定，不是丢弃 worker 内容的许可。
- `auto-checkpoint.ts`：turn / long-task 钩子建 checkpoint，label 形如 `uftk-auto-<trigger> <requestId>`（requestId 强制绑定）；默认关闭；retention 复用 P6B lifecycle 且把刚建的 checkpoint 加入 `protectedIds`。创建失败一律结构化返回 + warn，绝不把异常抛进它所保护的那个 turn。带 per-request 去重与 `minIntervalMs` 节流；retention 删掉的 id 会从去重表移除，避免 `skipped` 回一个已不存在的 checkpoint。
- `git-checkpoint-recovery-advice.ts`：§2.2「P7 可选产物」三项中的**恢复建议**（另两项 patch export / review diff 已分别由 P6B `exportPatch` 与 bridge 的 review 面提供）。把 restore 结果映射为有序、可执行的操作步骤。刻意**纯函数**：只读结果形状，不跑 git、不碰锁、不读文件 —— 关于"工作区可能坏了"的建议本身绝不能再把工作区弄坏，且必须能在已经失败的错误路径上安全调用。关键不对称：只有 `recovery_required` 置 `actionRequired=true`；`conflict` / `failed` / `unsupported` / `not_found` / `disabled` 都由构造保证零改动（要么 prepare 阶段拒绝，要么 apply 已从 safety snapshot 回退），把它们标成需要恢复会让操作者去找根本不存在的损坏。`recovery_required` 的步骤顺序以"先别再 restore"开头，而不是"重试"。

---

## 5. 配置与 flag 规划（全部默认 false）

新增 flag 必须同步 `types.openclaw.ts` / `zod-schema.ts` / `runtime-feature-leaves.ts` / `coding-runtime-flags.ts` / shared contract / dcs default gate：

| Flag | 默认 | 用途 |
|---|---|---|
| `runtime.coding.uftk.concurrencyV2.enabled` | `false` | P6A 统一调度器 + 跨进程共享读 + barrier + CAS 复查 + lock observability |
| `runtime.coding.uftk.gitCheckpoint.pathScoped.enabled` | `false` | P6B 路径作用域 create/restore API |
| `runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled` | `false` | P6B restore 前强制 safety checkpoint |
| `runtime.coding.uftk.gitCheckpoint.lifecycle.enabled` | `false` | P6B label / diff / export / retention / prune |
| `runtime.coding.uftk.execUndo.enabled` | `false` | P7 exec 文件副作用撤销 |
| `runtime.coding.uftk.autoCheckpoint.enabled` | `false` | P7 turn / long-task 自动 checkpoint |

- flag off 时：所有新路径不得改变 P1-P5 行为，不新增模型 schema。
- `runtime.coding.uftk.enabled`、`baseVersionGuard`、`execSideEffects`、`commandApproval`、`auditLog`、`gitCheckpoint` 现有六项保持 false。
- 产品锁 `liveReady=false` / `productApproved=false` / `defaultOn=false` 不变。

---

## 6. P6 验收矩阵（逐项实测）

### 6.1 P6A 并发锁

> 逐项实测证据：`reports/CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md` §3（矩阵，10/10 PASS）+ §3.4（性能实测数据）。
> 该报告为**独立验收**：不接受"测试已存在且通过"作为证据，未覆盖项另写探针。勾选表示已有独立取证，不是自检口径。

- [x] write/edit/apply_patch/FTS 全部经统一 lock-core；`file-mutation-queue` 与 `file-lock-manager` 不再有两条进程内队列语义。 — 代码核对 + `file-mutation-queue.test.ts` 与 P2 套件同 core 全绿；全局唯一 `localLockStates`（仅 `lock-core.ts:64`）
- [x] 同文件 read-read 并发不互斥；read-write / write-write 互斥；writer barrier 后到 reader 不饿死 writer。 — **验收期证伪后修复**：层级 writer barrier 原先失效，修复后由 `lock-core.fairness.test.ts` 4 例锁定（同 key barrier / 跨层级 barrier / reader 流饿死保护 / 无 writer 时仍共享）
- [x] 跨进程同文件 shared-read 与 write 互斥（Windows 实测；Linux 有环境时补测）。 — `file-lock-manager.xproc-read.test.ts` Windows 实跑：marker 注册/清除、跨进程 read-read 共享、writer 等真实子进程 marker drain、reader 不 drain 时有界 `E_LOCK_TIMEOUT`
- [x] 多路径按 canonical key 去重排序，反序获取不产生死锁。 — `lock-core.test.ts` 反序双向完成 + `file-lock-manager.test.ts` 同项 + `acquireLocalLocks` 对 `new Set(keys)` 排序后顺序获取
- [x] 所有锁带 timeout / owner / stale；pid reuse 通过 starttime 识别；超时返回结构化 `E_LOCK_TIMEOUT`。 — `xproc-read` 3 例分别锁定 starttime 不匹配→stale 且 `staleLockReclaimed` 自增 / 匹配→判存活 / 不可解析→退化为 `staleMs` 年龄界。**P6A 时的平台缺口（非 Linux 无 starttime 提供者）已由 P7 承接 D 消除**，可用性经 `inspectCodingLocks().pidReuseDetectionAvailable` 对外可见
- [x] restore barrier：restore 等待既有写 drain；barrier 期间新 UFTK 写 prepare 等待或有界失败。 — `git-checkpoint-safety.test.ts` 3 例（外部持 barrier 时 restore 不推进 / prepare→settle 全窗口第三方超时 / apply 失败仍释放）；排队期间不被绕过由上述 barrier 修复保证
- [x] commit 前 CAS 复查：过期 baseVersion 返回 `E_CONFLICT` + diff，目标零变化。 — `file-transaction-service.concurrency.test.ts`：write/edit/delete 均 `E_CONFLICT`+diff 且目标零变化；apply_patch 在任何目标改动前冲突；未知 baseVersion fail-closed
- [x] lock observability 计数在争用 / stale / timeout 场景有增量；`inspectCodingLocks()` 只读可用。 — **验收期证伪后修复**：亚毫秒争用原先不计数（`waitedMs` 取 1ms 下限并无条件记录）；stale 计数由 `xproc-read` pid-reuse 用例断言；`inspectCodingLocks()` 代码核对为纯读
- [x] 模型对外 schema 不变；flag off 与 P1-P5 行为一致。 — `coding-runtime-contract.test.ts` 9/9；`dcs-prod-flags-catalog.test.ts`（`concurrencyV2` 默认 false）；探针证明 flag off 时零 marker 落盘
- [x] 性能：无争用单文件锁开销 p50 增量 < 5ms；20 路径并行加锁近线性；跨进程锁超时上界有效。 — 实测（Windows，n=200/60）read p50 增量 **0.691ms**、write **−0.025ms**（均 < 5ms 预算）；20 路径 / 1 路径 = **20.19×**（理想 20×）；跨进程写锁超时 313.1ms（预算 300ms，上界有效）

### 6.2 P6B Git Checkpoint v2

> 逐项实测证据：`reports/CODING-RUNTIME-P6B-ACCEPTANCE-2026-08-18.md` §3（矩阵，10/10 PASS，含 10,000 文件真实仓库性能数据）+ `...P6B-EVIDENCE...`（开发自检）。

- [x] 路径作用域 create：私有 ref；真实 index/worktree 零变化；scope 记录在 checkpoint 元数据。 — `ls-tree` 实测为 scope-only tree（非整树+标记）；`indexWorktreeUnchanged=true` 且 `git status --porcelain` 前后逐字节相等；元数据走 commit message trailers，无第二套元数据存储
- [x] 路径作用域 restore：仅恢复 scope 内修改 / 删除 / 新增 / 嵌套路径；scope 外路径 `git status` 前后一致。 — **验收期证伪后修复**：原 scoped 分支用 `read-tree` 整体覆盖 index，会动 scope 外条目；改为 `update-index --add --remove` 仅刷新 in-scope 条目后，内容 + `git status` + index 三重断言一致
- [x] safety snapshot：restore 前受影响路径 dirty 内容可恢复；冲突返回 `recoveryRef` / `safetyRef`，不静默覆盖。 — `git show <safetyRef>:<path>` 实读出 restore 前内容；`recoveryRef` 下原始字节可读；safety off + in-scope dirty → `conflict` 且用户编辑零变化；at-risk 判定按 blob hash 精确
- [x] 两阶段 restore：prepare 阶段冲突失败时目标零变化；apply 中途失败时返回 `recovery_required` 或安全回退，工作区不混合。 — 两条 settle 分支均由故障注入实测：removal 阶段失败→回退成功返回 `failed`（reason 含 `rolled back from safety snapshot`）；叠加 state dir 破坏使回退亦失败→`recovery_required` + `E_GIT_CHECKPOINT_RECOVERY_REQUIRED`，`safetyRef`/`recoveryRef` 均可读出 restore 前内容
- [x] restore 期间与 UFTK 写工具互斥（依赖 6A barrier）。 — 见 §6.1 barrier 项；**A↔B 接缝独立取证**：`acquireWorkspaceRestoreBarrier`（`file-lock-manager.ts`）本身就是 lock-core 上对 `workspaceScopeKey(root)` 的 write 锁，`locksOverlap` 使其与该 root 下每个文件 key 重叠，故 barrier 不是并行机制而是同一调度器内的层级锁
- [x] 非 git 结构化 `unsupported`；root `.git` 文件 worktree 主仓支持；submodule 显式 unsupported / skip + warning。 — 真实 `git worktree add`（`.git` 为文件）create/restore 均成功，证明 `--git-common-dir` 生效；`git init --separate-git-dir` 构造 submodule 形态 → `unsupported`+warning；nested `.git` 在 scope 内→`unsupported`，scope 外→`skippedNestedRepos`+warning
- [x] 生命周期：label / list / diff / exportPatch / retention / prune / GC 可用；旧 checkpoint 不被误删。 — 12 用例；`maxCount=0` 仍保留最新、`protectedIds` 生效、`maxAgeMs` 只删过期项、`dryRun` 不删 ref；全程 `git status` 与文件内容不变（prune 只删 ref）。**P7 追加修复**：排序键由秒精度 `creatordate` 改为 commit subject 内已有的毫秒 ISO 戳，使"最新永远受保护"在同秒突发下也成立
- [x] 继续禁止 `git reset --hard` / `git clean -f`；git-checkpoint 不 import write-journal / FTS rollback。 — 剥离注释后扫描**代码**与 **import specifier**（避免用文档字样自证）；P7 已把守卫覆盖面由 4 个实现文件扩至 8 个（含全部 P7 checkpoint 相邻模块）
- [x] 性能：10k 文件仓库中 scoped restore 10 文件显著低于整树 restore；整树 restore 相对 P5 基线无数量级退化；safety snapshot 只复制受影响文件。 — 10,000 文件真实 git 仓库实测：scoped restore（10 文件）**353.9ms** vs 整树 **3869.5ms** = **10.9×**，且 < §8 的 p50 1s 预算；整树 create 623.9ms / restore 3869.5ms 相对 P5 基线无数量级退化；at-risk 判定 59.4ms、safety snapshot 167.1ms
- [x] flag off：新 API 结构化 `disabled`，P1-P5 路径不变，无新增模型 schema。 — 同一实例：`pathScoped` off 时 scoped create/restore 返回 `disabled`（reason 指名 flag），整树 create 仍 `created`；lifecycle off 时 6 个方法全 `disabled` 且 ref 未被删；P5 套件 8/8 回归通过

### 6.3 P7 验收矩阵（开发自检结果；独立验收待做）

- [x] exec undo：P3 sideEffects 路径集合可路径作用域恢复；非文件副作用 / 工作区外路径结构化拒绝；raw command 不落盘边界保持。
- [x] **exec undo scope 覆盖守卫（承接 B）**：sideEffects 路径超出目标 checkpoint 记录 scope 时结构化拒绝且零改动；实测不得出现「因不在 tree 中而删除」的路径。
- [x] worktree bridge：git checkpoint restore 与 merge queue / conflict policy 协同；冲突可见，用户内容不静默丢失。
- [x] auto checkpoint：默认 false；开 flag 后 turn / long-task 创建 label 绑定 requestId；retention 生效；对普通工具 schema 不变。
- [x] **safety ref 不可误删（承接 A）**：auto checkpoint 的 retention / prune 在任何策略下都不删除 safety ref；实测「大量 auto checkpoint + 激进 retention + 一次 recovery_required」后 safetyRef 仍可读出 restore 前内容。
- [x] **auto checkpoint 并发正确性（承接 C）**：auto checkpoint、restore barrier、UFTK 写工具三者并发下无饿死、无绕过、无死锁；lock observability 计数有增量。
- [x] 承接 D（跨平台 starttime）：**选择"完成实现并实测"**。win32/darwin 提供者落地，pid 级缓存实测（40 次调用 1 次探测、负结果亦缓存、TTL 到期重探、超上限淘汰），win32 与 PowerShell 独立查询交叉比对一致。可用性经 `inspectCodingLocks().pidReuseDetectionAvailable` 对外可见，使退化状态可诊断而非隐形。
- [x] §2.2「P7 可选产物」三项齐备：checkpoint 间 patch export（P6B `exportPatch`）、review diff 视图（bridge review 面）、**恢复建议**（`git-checkpoint-recovery-advice.ts`，纯函数，10 例）。
- [x] 新增 checkpoint 相邻模块全部纳入 §10 禁止项源码扫描守卫（`CHECKPOINT_MODULES` 由 4 个扩至 8 个）。
- [x] P6 回归全过（coding-runtime 全目录 **30 files / 266 tests**，2026-08-19 收尾复跑；P7 收卡当时为 28 files / 250 tests，差额为收尾补入的 A↔B 接缝探针 5 例、R7 单源化等价性回归 1 例、`inspectCodingLocks()` 覆盖 10 例）；产品锁与全部 flags 保持 false。
- [x] P7 独立验收报告落在 `reports/`，含 verdict。 — `reports/CODING-RUNTIME-P7-ACCEPTANCE-2026-08-18.md`，**verdict = ACCEPT_WITH_RESIDUAL**
- [x] P7 verdict 经用户确认。 — 2026-08-19 用户确认「按照你推荐的方案跑完这些 p6-7 的收尾工作」，`TF-0076` 已收为 `done`（见 §11）

---

## 7. 必跑命令门禁（P6 开发与验收）

```bash
# 契约与 harness
pnpm harness context --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md
pnpm harness validate --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md --no-diff

pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1

# P6A 定向
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/file-lock-manager.test.ts \
  src/agents/coding-runtime/file-lock-manager.xproc-read.test.ts \
  src/agents/coding-runtime/lock-core.test.ts \
  src/agents/coding-runtime/lock-core.fairness.test.ts \
  src/agents/coding-runtime/lock-inspection.test.ts \
  src/agents/coding-runtime/file-transaction-service.concurrency.test.ts \
  src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts \
  src/agents/sessions/tools/file-mutation-queue.test.ts \
  --maxWorkers=1

# P6B 定向
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/git-checkpoint.test.ts \
  src/agents/coding-runtime/git-checkpoint.restore.test.ts \
  src/agents/coding-runtime/git-checkpoint.scoped.test.ts \
  src/agents/coding-runtime/git-checkpoint-safety.test.ts \
  src/agents/coding-runtime/git-checkpoint-lifecycle.test.ts \
  src/agents/coding-runtime/git-checkpoint-safety-retention.test.ts \
  --maxWorkers=1

# P6 合并（A∪B 单进程，用于 P6 整体验收；跨套件状态泄漏只在这里暴露）
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  <上面 P6A 定向的 7 个文件> <上面 P6B 定向的 6 个文件> \
  --maxWorkers=1 --reporter=verbose

# P6 A↔B 接缝（真实两阶段 restore ↔ 真实文件级 UFTK 锁，双向对撞）
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/git-checkpoint-transaction.p6-seam.test.ts \
  --maxWorkers=1 --reporter=verbose

# P7 定向
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/exec-side-effect-undo.test.ts \
  src/agents/coding-runtime/exec-side-effect-undo.ignored-probe.test.ts \
  src/agents/coding-runtime/checkpoint-worktree-bridge.test.ts \
  src/agents/coding-runtime/checkpoint-worktree-bridge.leak-probe.test.ts \
  src/agents/coding-runtime/auto-checkpoint.test.ts \
  src/agents/coding-runtime/git-checkpoint-recovery-advice.test.ts \
  --maxWorkers=1

# P7 承接 D（跨平台 starttime 提供者，另一个 vitest project）
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.shared-core.config.ts \
  src/shared/process-start-time.test.ts --maxWorkers=1

# R2（starttime 接入 P1–P5 的 stale-lock 判定，**第三个** vitest project）
# 注意：src/infra/ 既不在 agents 也不在 shared-core 的 include 里；用错 config 会得到
# "No test files found, exiting with code 1"，看起来像命令写错，实则是这条门禁被漏跑。
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts \
  src/infra/stale-lock-file.test.ts --maxWorkers=1

# 全目录回归（必须带 --reporter=verbose）
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime --maxWorkers=1 --reporter=verbose

# 工程门禁
pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1
pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
pnpm run lint:dcs
pnpm exec eslint <P6/P7 变更文件列表>
git diff --check -- <P6/P7 tracked 变更文件列表>
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test

# 预存 residual 复核（只允许既有原因）
pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1
```

**两处命令形式的更正（P7 实测得出，非风格偏好）：**

- 全目录回归**必须**加 `--reporter=verbose`。`scripts/run-vitest.mjs` 会在"120s 无输出"时杀掉整个进程组；P7 使该套件增长到约 133s，默认 reporter 在运行期几乎不输出，于是会被误杀（表现为 stall 而非失败）。加 verbose 后每例都打印，看门狗不会误判。
- `harness validate` 记为 `--no-diff`。diff 模式用 `origin/main...HEAD` 加暂存/未暂存/未跟踪文件计算变更集，本工作树当前有 **37 个 vs origin/main 的变更 + 324 个脏/未跟踪文件**，其中约 250 个属于其它 workstream（RLG、goal-loop、UI、session-lifecycle 等）。把它们写进本 spec 的 `touchedAreas`/`residualPaths` 等于伪造归属，故不做。P7 已把自己新增的 `src/shared/process-start-time.ts(.test.ts)` 补进 `touchedAreas`；确认剩余未覆盖项中**没有任何 P6/P7 文件**（只剩 P1–P5 文件、task-forest proposal JSON、以及其它 workstream 的文件）。结构性校验（`--no-diff`）通过。
  - 诚实记录：P6 收卡报告里写的"harness validate 通过"，其证据只能支撑**结构性**校验通过；diff 模式在当前多 workstream 脏树下无法通过，且并非 P6/P7 引入。此处更正措辞，避免把结构性通过读成完整通过。

Residual 规则与 P1-P5 相同：

- `tsgo:core:test` 只允许既有 RLG WIP：`session-drain-service.test.ts`、`session-reset-service.stop.test.ts`、`session-reset-service.subagent-stop.test.ts`；**不得出现 P6/P7 文件**。
  - 2026-08-18 P6 验收期实测追加一项**外部 workstream 临时允许项**：`src/agents/goal-wake-runtime.test.ts`（与 `goal-wake-runtime.ts` 同为 untracked，mtime 2026-08-18 01:44/02:19，早于 P6 工作，属 goal-loop / durable-scheduler 并发 workstream）。P6 未修该文件（规范禁止擅自修无关文件），P6/P7 自身文件均未出现在错误列表中。该项**不属于 P6/P7 的 residual 额度**，应由其归属 workstream 消除；一旦该 workstream 收尾即从本清单移除。P7 验收时若此项仍在，需重新确认归属而不是默认继承。
  - **P7 已按上条重新确认归属（2026-08-18）**：两文件仍为 untracked、mtime 与 P6 记录完全一致（01:44 / 02:19，P7 期间未被触碰），故仍归 goal-loop workstream，P7 不继承、不消耗 P6/P7 residual 额度。
  - 2026-08-18 P7 期间**曾短暂出现第二项外部项**：`src/gateway/server-methods/session-activity-projection.test.ts`（与 `session-activity-projection.ts` 同为 untracked，mtime 22:47 / 22:49，即 P7 会话进行中由并发 workstream 写入）。同期该 workstream 一度让 `typecheck:node` / `tsgo:core` 变红（`session-activity-projection.ts(294,18)` TS2339），随后由其自身修复；P7 收尾复跑时该项已从错误集合消失，故**不列为常设允许项**，仅作为"并发 workstream 会短时污染门禁"的实测记录保留。P7 未触碰这两个文件。
    - **2026-08-19 P6 收尾复跑：该项又出现了**，`tsgo:core:test` 错误文件集合为 5 项（3 项 RLG WIP + `goal-wake-runtime.test.ts` + `session-activity-projection.test.ts`）。实测归属未变：两文件仍 untracked，`session-activity-projection.ts` mtime **2026-08-19 00:07**（本次会话进行中由该 workstream 写入），P6/P7 从未触碰。按"不得擅自修复无关文件"不予处理，**依然不列为常设允许项**。
      这次复现本身就是结论：该项是并发 workstream 的**反复**污染源，不是一次性事件；它的存在与消失都与 P6/P7 改动无关，因此判定标准始终只有一条 —— **错误集合中不得出现任何 P6/P7 文件**（本次实测：无，含新增的 `git-checkpoint-transaction.p6-seam.test.ts`）。
    - **2026-08-19 收卡后另见第三次外部污染，这次落在 `typecheck:web`**：`src/components/layout/Sidebar.tsx`（13 个 TS6133/TS2739/TS2741）与 `src/pages/Chat/SessionActivityPanel.tsx`（1 个 TS6133）。两者均为 tracked+modified 的 renderer 文件，mtime **09:26 / 09:09**（`Sidebar.tsx` 就在复跑的当前分钟被写入），属 Sidebar/Workgroups workstream 的在写状态。
      归属可判定而非推测：`tsconfig.web.json` 的 `include` 是 `["src", "shared"]`（仓库根 renderer `src/`），而本阶段全部 TS 改动都在 `openclaw_runtime/src/**` 下，**没有一个文件落在 web typecheck 的范围内**。同一轮 `typecheck:node` / `tsgo:core` 仍为 0 error。
      同样不予处理、同样不列为常设允许项：判定标准仍是「错误集合中不得出现任何 P6/P7 文件」。
  - P7 最终实测 `tsgo:core:test` 的错误集合恰为「3 项既有 RLG WIP + `goal-wake-runtime.test.ts` 1 项外部项」，**无任何 P6/P7 文件**，与 P6 收卡时记录一致。
- `config-schema-parity` 只允许预存 `runtime.memory.candidateGeneration`；P6/P7 新 leaf 必须同时进 type / zod / leaves。P7 实测 129 例中 1 失败，失败项恰为该预存项，新增的 `execUndo` / `autoCheckpoint` 未出现在失败集合中。
- 其他任何非零 exit、失败测试、stall、trailing whitespace、flag 翻转视为回归；不得擅自修复无关文件。

---

## 8. 性能预算

| 项目 | 预算 |
|---|---|
| 无争用单文件锁（P6A） | p50 增量 < 5ms，p95 无数量级退化 |
| 20 路径锁批量获取 | 近线性；不得出现 20 倍串行退化 |
| 跨进程锁等待 | 有超时上界，不无限阻塞 |
| scoped restore（10k 仓库，10 文件） | 明显低于整树 restore；目标 p50 < 1s |
| safety snapshot | 只复制受影响文件，耗时与 scope 文件总大小线性 |
| restore barrier | 等待可超时，超时返回结构化 `E_LOCK_TIMEOUT` |
| checkpoint diff / export | 与 tree diff 规模线性 |
| P7 exec undo | 只增加一次 scope diff + scoped restore，无全盘扫描 |

---

## 9. Definition of Done（每个阶段）

> 勾选口径：P6A / P6B / P6（整体）/ P7 四个阶段**逐阶段**核对。除最后一项外，所有阶段均已满足；
> 唯一未闭合的是 P7 verdict 的用户确认（§6.3），它不属于工程可自闭合的范围。

- [x] 代码实现且对应单测 / 集成测试落地。 — P6 合并回归 13 files / 131 tests；A↔B 接缝探针 5/5；coding-runtime 全目录 30 files / 266 tests；承接 D 15/15；`infra` 6 files / 31 tests；契约 9/9
- [x] 新增 / 修改文件通过 lint、typecheck、contract check。 — `typecheck:node`/`typecheck:web`/`tsgo:core` 0 error；`lint:bom`、`lint:dcs`、`eslint`（P6/P7 源码+测试全量）、`contract:check` 全过（`lint:dcs` 是 P7 完整率复核补入 §7 的，此前两份门禁清单均无 lint 条目）
- [x] 强制验收项（第 6 节）逐项通过。 — §6.1 10/10、§6.2 10/10、§6.3 10/11（第 11 项为用户确认）；其中 P6A 2 项、P6B 1 项是**验收期先被证伪后修复**才成立
- [x] `pnpm verseshell:test` 不回归。 — 15 files / 141 tests
- [x] 默认 flag 仍全部关闭；产品锁不变。 — `CODING_RUNTIME_FLAG_KEYS` 12 项全 false（P6/P7 新增 6 项：7–12）；`liveReady=false`/`productApproved=false`/`defaultOn=false` 未动
- [x] `shared/coding-runtime/README.md` / `MIGRATION.md` / 本规范 / 相关 README 同步更新。 — 含 §12.3 要求的上游规范指针同步（状态行 / P6-P7 段 / M6-M7 里程碑）
- [x] task forest 节点按 proposal 更新，validate + export 通过。 — `TF-0075` done、`TF-0076` in_progress；两条 deviation 在库
- [x] 不把本地绿灯表述为 UFTK GA / canary / 整体成熟度。 — 各报告结论边界段显式声明；无生产调用方、无 flag 翻转

---

## 10. 硬性禁止

1. 不 checkout / reset / clean / 提交无关 WIP。
2. 不 flip 任何 UFTK flag 或产品锁。
3. 不新增第二套锁 / 队列 / journal / 审计真源。
4. 不使用 `git reset --hard`、`git clean -f` 作为 restore 手段。
5. 不改变 write / edit / apply_patch / exec 模型对外 schema。
6. P6 实现不得绕过 P6A 直接做 P6B 的 restore 事务。
7. 不把路径作用域 restore 外推为任意 shell 副作用完整回滚。
8. 不把本地绿灯表述为 UFTK GA、canary 或整体成熟度结论。

---

## 11. Task Forest 映射

| 节点 | 阶段 | 状态 | 关系 |
|---|---|---|---|
| `TF-0075` | Coding Runtime P6：并发锁统一/硬化 + Git Checkpoint v2（A+B） | `done`（with residual） | child_of `TF-0010`，depends_on `TF-0074` |
| `TF-0076` | Coding Runtime P7：工作流级扩展（C） | `done`（with residual，2026-08-19 用户确认 verdict 后收卡） | child_of `TF-0010`，depends_on `TF-0075` |

- 一次只推进一个 ready/in_progress 节点。
- P6 内部顺序固定：先 P6A 自检与独立验收，再 P6B 自检与独立验收；P6 整体验收通过且用户确认后，P7 才可进入讨论/实施。
- P7 同样需要独立验收报告 + verdict + 用户确认，才可收为 `done`。
- 不创建 P6/P7 之外的平行节点。

---

## 12. 文档落地清单

1. 本规范：`docs/dev/coding-runtime-p6-p7-development-spec.md`。
2. Harness 执行契约：`harness/specs/tasks/coding-runtime-p6-p7-extension.md`。
3. 原规范指针更新：`docs/dev/coding-runtime-development-spec.md`。
4. 会话交接：`docs/dev/handoffs/LATEST.md`。
5. 实现完成后同步：`shared/coding-runtime/README.md`、`shared/coding-runtime/MIGRATION.md`、`README*.md`（如用户可见行为变化）。
6. 验收报告：P6A / P6B / P6 / P7 各自在 `reports/` 落地 evidence + acceptance 报告。
   - `CODING-RUNTIME-P6A-ACCEPTANCE-2026-08-18.md`（自带独立取证，evidence 与 acceptance 合一）
   - `CODING-RUNTIME-P6B-EVIDENCE-2026-08-18.md` + `CODING-RUNTIME-P6B-ACCEPTANCE-2026-08-18.md`
   - `CODING-RUNTIME-P6-ACCEPTANCE-2026-08-19.md`（**P6 整体**：A↔B 接缝独立取证 + A∪B 合并回归 + residual 合并台账）
   - `CODING-RUNTIME-P7-EVIDENCE-2026-08-18.md` + `CODING-RUNTIME-P7-ACCEPTANCE-2026-08-18.md`
7. 全量验收入口：`reports/CODING-RUNTIME-P6-P7-ACCEPTANCE-PROMPT-2026-08-19.md`。自包含，供**全新会话**独立全量验收使用（含预检、完整门禁命令、攻击面清单、外部噪声归属核验方法、verdict 格式）。P1–P5 的对应入口是 `reports/CODING-RUNTIME-FULL-ACCEPTANCE-PROMPT-2026-08-17.md`。
