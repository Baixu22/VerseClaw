# Coding Runtime P6A 独立验收报告（2026-08-18）

> 阶段：**P6A — 并发锁统一 / 硬化**（统一 RW 调度器、跨进程共享读、restore barrier、commit CAS、lock 可观测性）
> 规范依据：`docs/dev/coding-runtime-p6-p7-development-spec.md` §4.1（协议不变量）/ §6.1（验收矩阵）/ §7（门禁）
> 程序基线：`c673f0f29`（未 commit / 未 checkout / 未 reset / 未 clean；工作树含大量既有并发 WIP）
> 验收性质：**独立验收**。不复述开发自检结论，逐项自行取证；对每条 §4.1 不变量与 §6.1 验收项单独写探针并实测。
> 结论边界：本报告只覆盖 **P6A**。不是 P6 整体验收、不是 UFTK GA / canary / 成熟度结论。
> 产品锁：`liveReady=false`、`productApproved=false`、`defaultOn=false` 未变；全部 UFTK flag 默认 false。

---

## 0. 验收裁定

**verdict = ACCEPT_WITH_RESIDUAL**

理由：§6.1 全部 10 项经独立取证后成立，其中 2 项在本次验收中**先被证伪、修复后才成立**（见 §2）。剩余 1 项平台能力缺口无法在 P6 范围内闭合，列为 residual（见 §4.1）。

本次验收发现并修复的缺陷不是文档问题，是真实调度缺陷；若不修，`restore barrier` 的饿死保护在层级作用域下不成立。

---

## 1. 独立取证方式

不接受"测试已存在且通过"作为证据。对每条不变量分别处理：

1. 先读实现（`lock-core.ts` 全文、`file-lock-manager.ts` 跨进程段、`lock-inspection.ts`、`coding-observability.ts` 计数器、`pid-alive.ts`），推导该不变量在代码上**是否真的成立**；
2. 对既有测试套件覆盖到的项，核对断言是否真的锁住该不变量，而不是只跑通路径；
3. 对既有套件**未覆盖**的项，新写探针测试，先让它证伪或证实；
4. 性能项采集真实数据，不接受"设计上成立"。

新增探针文件（本次验收产出，已入库）：

| 文件 | 用例数 | 覆盖 |
|---|---:|---|
| `openclaw_runtime/src/agents/coding-runtime/lock-core.fairness.test.ts` | 6 | writer barrier 跨层级公平性、饿死保护、read-read 共享、争用/超时计数器 |
| `openclaw_runtime/src/agents/coding-runtime/file-lock-manager.xproc-read.test.ts` | 9 | 跨进程 shared-read 协议、reader drain、pid 复用、非 Linux 降级、flag off 无 marker |

一次性性能 harness 未入库（沿用 P1-P5「记录数字、不入库基准脚本」惯例），方法与数据见 §3.4。

---

## 2. 本次验收发现的缺陷（先证伪，再修复）

### 2.1 缺陷 A：queued writer barrier 在层级作用域下失效（真实调度缺陷）

**§6.1 对应项**：「writer barrier 后到 reader 不饿死 writer」、「restore barrier：barrier 期间新 UFTK 写 prepare 等待或有界失败」。

**证伪过程**：`lock-core.ts` 的准入判定原为

```
const conflict = blockedByActiveLeases(params.key, params.mode);
if (state.waiters.length === 0 && !conflict.blocked) { 立即准入 }
```

`blockedByActiveLeases` 只看 **active** 租约，`state.waiters.length` 只看**本 key** 的队列。因此：reader 持有文件 key `F` → restore 在 workspace key `WS` 上排队（`WS` 与 `F` overlap，但 waiter 记在 `state[WS]`）→ 新 reader 请求另一个文件 key `G`：`state[G].waiters` 为空，且 `state[WS].activeWriter=false`（只是排队），于是 **`G` 被立即准入，绕过已排队的 workspace barrier**。

探针 `does not let a later file-scope reader bypass a queued workspace barrier` 实测：`laterReaderAcquired` 为 `true`（期望 `false`）→ **缺陷确认**。

**影响**：同 key 的 barrier 是正确的（既有用例 `a queued writer is a barrier for later readers` 覆盖了这一情形，所以既有套件全绿也掩盖不了这个洞）。层级作用域下 barrier 不成立，意味着持续的文件读流可以无限期饿死 restore barrier，restore 只能靠超时失败。属安全性无损、活性受损。

**修复**：`lock-core.ts` 引入全局到达序号 `waiterSequence`，新增 `modesConflict` / `blockedByEarlierWaiters` / `blockedForRequest`：准入要求「overlap key 上无冲突 active 租约」**且**「overlap key 上无更早到达的冲突 waiter」。`pumpLockState` 改用同一判定并返回是否有准入，`pumpOverlappingStates` 改为**循环直到无进展**（准入全局最早 waiter 会解锁本轮已访问过的其他 overlap key）。

无死锁论证：序号是全序，全局最小序号的 waiter 不存在"更早 waiter"，只受 active 租约约束；active 租约排空后它必然可准入，故始终有进展。

**修复后**：6/6 探针通过，且既有 `lock-core.test.ts` / `file-lock-manager.test.ts` / `file-mutation-queue.test.ts` 共 41 用例保持通过（未回归 P2 语义）。

### 2.2 缺陷 B：亚毫秒争用不计入 contention 计数

**§6.1 对应项**：「lock observability 计数在争用 / stale / timeout 场景有增量」。

**证伪过程**：`lockContention` 由 `recordLockWaitMs` 内部自增（不存在独立的 `recordLockContention` 方法），而 lock-core 原为

```
const waitedMs = Math.max(0, Date.now() - startedAt);
if (waitedMs > 0) codingObservability.recordLockWaitMs(waitedMs);
```

即：真的进了等待队列（真实争用），但在同一毫秒内被准入时 `waitedMs === 0` → **争用与等待都不计数**。

**修复**：进过队列即为争用，等待时间取 1ms 下限：`const waitedMs = Math.max(1, Date.now() - startedAt);` 并无条件记录。

**修复后**：探针 `increments contention and waitMs when an acquire actually queues` 与 `increments the timeout counter on a bounded acquire failure` 通过。

---

## 3. §6.1 验收矩阵逐项实测

| 验收项 | 结果 | 独立证据 |
|---|---|---|
| write/edit/apply_patch/FTS 全部经统一 lock-core；`file-mutation-queue` 与 `file-lock-manager` 不再有两条进程内队列语义 | PASS | 代码核对：`file-lock-manager.ts` 的 `acquireCodingRuntimeFileLocks` 走 `acquireLocalLocks`；`file-mutation-queue.ts` delegate 到同一 core；`resetCodingRuntimeFileLocksForTest` 直接委派 `resetLockCoreForTest`。全局无第二处 `localLockStates`。`file-mutation-queue.test.ts` 与 P2 套件在同一 core 下全绿 |
| 同文件 read-read 并发不互斥；read-write / write-write 互斥；writer barrier 后到 reader 不饿死 writer | PASS（修复后） | `lock-core.test.ts` 覆盖前三者；barrier 项由 §2.1 修复后经 `lock-core.fairness.test.ts` 4 个用例锁定，含同 key barrier、跨层级 barrier、reader 流饿死保护、无 writer 时 read 仍共享 |
| 跨进程同文件 shared-read 与 write 互斥（Windows 实测） | PASS | `file-lock-manager.xproc-read.test.ts`（Windows 实跑）：read 锁注册 marker 且释放后清除；本进程 reader 不被另一 OS 进程的 marker 阻塞（read-read 跨进程共享）；writer 等待真实存活子进程的 marker drain，marker 移除后才获得；reader 永不 drain 时返回有界 `E_LOCK_TIMEOUT` |
| 多路径按 canonical key 去重排序，反序获取不产生死锁 | PASS | `lock-core.test.ts` 反序双向完成 + 去重排序；`file-lock-manager.test.ts` 同项；代码核对 `acquireLocalLocks` 对 `new Set(keys)` 排序后顺序获取 |
| 所有锁带 timeout / owner / stale；pid reuse 通过 starttime 识别；超时返回结构化 `E_LOCK_TIMEOUT` | PASS（带 residual） | timeout/owner/结构化错误：`lock-core.test.ts` + `file-lock-manager.test.ts` + 探针。pid reuse：`xproc-read` 3 个用例分别锁定 starttime 不匹配→判 stale 且 `staleLockReclaimed` 自增、starttime 匹配→判存活、starttime 不可解析→退化为 `staleMs` 年龄界。平台缺口见 §4.1 |
| restore barrier：restore 等待既有写 drain；barrier 期间新 UFTK 写 prepare 等待或有界失败 | PASS | barrier 持有期间的互斥由 P6B `git-checkpoint-safety.test.ts` 3 个用例实测（外部持 barrier 时 restore 不推进；prepare→settle 全窗口第三方获取 barrier 超时 `E_LOCK_TIMEOUT`；apply 失败仍释放 barrier）。barrier **排队期间**不被绕过由 §2.1 修复后保证 |
| commit 前 CAS 复查：过期 baseVersion 返回 `E_CONFLICT` + diff，目标零变化 | PASS | `file-transaction-service.concurrency.test.ts`：单文件 write/edit/delete 返回 `E_CONFLICT`+diff 且目标零变化；apply_patch 在任何目标改动前冲突；未知 baseVersion fail-closed；guard 关闭时保持 P2 默认关闭 |
| lock observability 计数在争用 / stale / timeout 场景有增量；`inspectCodingLocks()` 只读可用 | PASS（修复后） | 争用/等待计数由 §2.2 修复后经探针锁定；timeout 计数探针；stale 计数由 `xproc-read` pid-reuse 用例断言 `staleLockReclaimed` 自增。`inspectCodingLocks()` 代码核对为纯读（仅 `inspectLocalLockState` + `readdir`/`readFile`），`lock-core.test.ts` 覆盖 held/waiting 输出。**2026-08-19 更正**：`lock-core.test.ts` 覆盖的是 lock-core 原语 `inspectLocalLockState`，**不是**本模块的 `inspectCodingLocks()`；后者当时零测试覆盖，本条的证据强度只到「代码核对」。已补 `lock-inspection.test.ts`（10 例），其中核心一条是**只读性**实测：持真实写锁跨多次 inspect 后 held/waiting 逐字段不变、第二写者仍超时、release 后快照才反映变化——证明快照的稳定不是因为它是陈旧的 |
| 模型对外 schema 不变；flag off 与 P1-P5 行为一致 | PASS | `coding-runtime-contract.test.ts` 9/9；`dcs-prod-flags-catalog.test.ts` 4/4（`concurrencyV2` 默认 false）；探针 `registers no marker when concurrencyV2 is disabled` 证明 flag off 时不产生任何跨进程 marker；P2 套件在 flag off 下全绿 |
| 性能：无争用单文件锁开销 p50 增量 < 5ms；20 路径并行加锁近线性；跨进程锁超时上界有效 | PASS | 见 §3.4 实测数据 |

### 3.4 性能实测（Windows，n=200/60）

| 项目 | 实测 | 预算 | 结论 |
|---|---:|---|---|
| read 锁 p50，concurrencyV2 **off** | 0.007ms | — | 基线 |
| read 锁 p50，concurrencyV2 **on** | 0.698ms | — | 含跨进程 marker 落盘 |
| **read p50 增量** | **0.691ms** | < 5ms | **PASS** |
| write 锁 p50，concurrencyV2 **off** | 1.082ms | — | 基线 |
| write 锁 p50，concurrencyV2 **on** | 1.057ms | — | — |
| **write p50 增量** | **−0.025ms** | < 5ms | **PASS**（无可测代价） |
| write 1 路径 p50 | 1.112ms | — | — |
| write 20 路径 p50 | 22.456ms | 近线性 | — |
| **20 路径 / 1 路径 比值** | **20.19×** | 理想 20× | **PASS**（几乎完美线性） |
| 跨进程写锁超时（预算 300ms） | 313.1ms | 上界有效 | **PASS** |

方法：临时 state dir + 20 个临时文件；每项先预热再采样（read/write 各 200 次，多路径各 60 次）；同一进程内切换 `setCodingLockConcurrencyV2Enabled` 对比 flag off / on，故增量即 P6A 新增开销。

---

## 4. Residual（不阻塞 P6A，但必须记录）

### 4.1 Residual R1：非 Linux 平台无 starttime 提供者，pid 复用识别降级

`openclaw_runtime/src/shared/pid-alive.ts` 的 `getProcessStartTime` **按设计仅支持 Linux**（`if (process.platform !== "linux") return null;`）。而 `readerMarkerIsLive` 的判定是

```
if (storedStarttime !== null) {
  const currentStarttime = resolveMarkerProcessStartTime(pid);
  if (currentStarttime !== null && currentStarttime !== storedStarttime) return false;
}
```

`currentStarttime === null` 时 starttime 检查被**静默跳过**。因此在 Windows / macOS 上，marker 的 stale 判定实际是「pid 存活 + `createdAt` 未超 `staleMs`」，而非 §4.1 不变量 3 要求的「pid + starttime，不允许只看 pid」。

**影响评估（已实测界定）**：pid 被无关进程复用时，writer 会**多等最多 `staleMs`** 后回收该 marker，然后正常获得锁 —— 代价是有界延迟，**不是正确性或数据丢失**。反向误判（把存活 reader 的 marker 判 stale）只取决于 `createdAt` 是否超过 `staleMs`，与 starttime 无关，属通用长持有风险，非本 residual 引入。该降级路径已由探针 `documents the non-Linux starttime degradation` 显式锁定并断言其有界性。

**本次已做**：`file-lock-manager.ts` 补上与 `session-write-lock.ts` / `infra/stale-lock-file.ts` 同构的注入缝 `setMarkerProcessStartTimeResolverForTest`。此前 P6A 新增的 marker 代码硬编码 import，导致该不变量在非 Linux 上**完全不可验证**；补缝后 pid-reuse 行为在任意平台可确定性验证，未来接入 Windows starttime 提供者也无需改协议。

**未做及原因**：未实现 Windows starttime 提供者。Windows 下从 Node 取任意 pid 的创建时间需 `wmic` / PowerShell 子进程或原生插件；而 `readerMarkerIsLive` 位于 25ms 轮询的热路径，每次校验起子进程会直接击穿 §6.1 的锁开销预算（当前 read 增量 0.691ms）。属明确超出 P6 范围的平台能力工作。

**建议后续**：单列任务实现带缓存的跨平台 starttime 提供者（按 pid 缓存、TTL 内复用），再通过已就位的注入缝接入。

> **闭环追记（2026-08-19，P6 收尾）**：本 residual 已由 **P7 承接 D** 按上述建议消除，实现与建议一致——
> `openclaw_runtime/src/shared/process-start-time.ts` 提供 Linux `/proc` / win32 `Get-Process` FILETIME / darwin `ps -o lstart=` 三平台探测，
> 带 per-pid TTL 缓存（TTL 1000ms、上限 512 条、负结果亦缓存），实测 12/12（含"40 次调用 1 次探测"、TTL 到期重探、超上限淘汰、与 PowerShell 独立查询交叉比对）。
> `file-lock-manager.ts` 的注入缝默认值已改为该缓存提供者，`writerSidecarIsLive` 与 marker 写入端统一走 `resolveMarkerProcessStartTime`。
> 可用性经 `inspectCodingLocks().pidReuseDetectionAvailable` 对外可见，使"本平台检测不了 pid 复用"成为可诊断状态而非隐形降级。
> **仍开放的部分**：`session-write-lock` / `infra/stale-lock-file` 两条 P1–P5 已验收路径**未**接入该提供者，需单独授权（记为 P6-R2，见 `CODING-RUNTIME-P6-ACCEPTANCE-2026-08-19.md` §5）。
> 本追记只补状态，不改写上文当时的发现与判断。

### 4.2 Residual R2：`tsgo:core:test` 存在 1 个无关 WIP 文件

规范 §7 允许三个既有 RLG WIP 文件。实测另有 `src/agents/goal-wake-runtime.test.ts` 报类型错误；该文件与 `goal-wake-runtime.ts` 均为 untracked、mtime 2026-08-18 01:44/02:19，早于本次工作，属 goal-loop / durable-scheduler 并发 workstream，与 P6 无关，未修（规范禁止擅自修无关文件）。**P6A 本次改动的全部文件均未出现在错误列表中。**

### 4.3 观察（非 residual）：workspace barrier 不可重入

workspace 作用域写锁与其下任何文件锁互斥，故**同进程**在持有 barrier 期间再取文件锁会自锁死。P6B 的两阶段 restore 已按此约束设计（barrier 即互斥机制，其下不再取 per-path 锁；跨进程互斥由 `acquireCheckpointRestoreLock` 复用既有 session-write-lock 提供）。此处记录以免后续调用方踩坑。

---

## 5. 门禁 exit code（本次验收实跑）

| 命令 | Exit | 结果 |
|---|---:|---|
| `pnpm harness context --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md` | 0 | PASS |
| `pnpm harness validate --spec ... --no-diff` | 0 | Spec is valid |
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / 9 tests PASS |
| P6A 定向（lock-core / fairness / file-lock-manager / xproc-read / FTS concurrency / FTS flag-matrix / file-mutation-queue） | 0 | 全绿 |
| coding-runtime 全目录 + file-mutation-queue 回归 | 0 | **22 files / 180 tests PASS** |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts` | 0 | 1 file / 4 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check`（P6 变更文件） | 0 | clean；新增文件行尾空白扫描 0 命中 |
| `pnpm verseshell:test` | 0 | 11/11 PASS |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 0 | residual 见 §4.2 |
| `pnpm exec vitest run tests/unit/config-schema-parity.test.ts` | 0（wrapper） | 仅预存 `runtime.memory.candidateGeneration` |

---

## 6. 结论

P6A **verdict = ACCEPT_WITH_RESIDUAL**，residual 两项：R1（非 Linux starttime 提供者缺失，影响已界定为有界延迟、非正确性）、R2（1 个无关 WIP 文件的 tsgo residual，需验收方裁决是否扩充允许清单）。

本次验收不是走过场：§6.1 中 2 项被证伪并修复（层级 writer barrier 失效、亚毫秒争用不计数），1 项的不可验证性被消除（starttime 注入缝）。修复后既有 P2/P6A 套件无回归，性能预算全项达标。

需要用户确认本 verdict 后，P6A 门禁才算闭合，P6B 独立验收方可正式生效。
