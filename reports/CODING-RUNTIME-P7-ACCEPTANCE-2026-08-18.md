# Coding Runtime P7 独立验收报告（Independent Acceptance）

> 日期：2026-08-18
> 阶段：**P7（C）—— exec 文件副作用撤销 / worktree bridge / 自动 checkpoint**
> 依据：`docs/dev/coding-runtime-p6-p7-development-spec.md` §4.3、§6.3、§7
> 开发自检：`reports/CODING-RUNTIME-P7-EVIDENCE-2026-08-18.md`
> 任务图：`TF-0076`（依赖 `TF-0075`，已 done）
>
> **verdict：ACCEPT_WITH_RESIDUAL**
>
> 结论边界：本地绿灯不代表 UFTK GA / canary / 整体成熟度。产品锁 `liveReady=false` / `productApproved=false` / `defaultOn=false` 未变；全部 UFTK flag 仍为 `false`；P7 代码未接入任何生产工具路径。

---

## 1. 验收方式

不以"复跑已绿的测试"作为验收。做法是：对每个新模块找出**若实现有错则一定会出问题**的形状，写探针复现，确认缺陷后再修，并留下回归用例。共写 3 组探针，**3 组全部命中真实缺陷**。

---

## 2. 发现并修复的缺陷

### 缺陷 1（活性 / 严重）—— bridge 在 prepare 与 apply 之间泄漏工作区 barrier

- **位置**：`checkpoint-worktree-bridge.ts` `restoreCheckpoint`
- **成因**：`prepare` 已持有 P6A 工作区 barrier + 跨进程 restore 锁；此后到 `applyAndSettle`（其 `finally` 才释放）之间的区域 —— `getMergeQueue()`、`findWorktreeMergeOverlaps()`（内部 `normalizeWorktreeRelPath` 会对 `..` 抛异常）—— **完全没有 try/catch**。该区域一旦抛异常，`release()` 与 `applyAndSettle` 的 `finally` 都不会执行。
- **影响**：工作区 barrier 被永久持有到进程退出，**阻塞该进程内全部 UFTK 写工具与后续所有 restore**。同时原始异常直接抛给调用方，而非结构化结果 —— 违反"失败必须结构化"。
- **探针实测**：注入一个抛异常的 `getMessageQueue`，随后 `acquireWorkspaceRestoreBarrier` 以 `E_LOCK_TIMEOUT` 失败 → 泄漏确认；同时调用方收到裸 `Error: merge-queue read blew up`。
- **修复**：把 prepare 之后到 apply 之前的整段包进 try/catch，异常时 `await preparedRestore.release()` 并返回结构化 `failed`（附 safetyRef/recoveryRef）。与 `prepare` 自身的纪律一致。
- **回归**：`checkpoint-worktree-bridge.leak-probe.test.ts`（2 例：barrier 可再次获取 / 结构化 `failed` 且零改动）。

### 缺陷 2（安全网缺失 + 诚实性）—— gitignored 副作用路径

- **位置**：`exec-side-effect-undo.ts` 与 `git-checkpoint.ts` 的 `filterMatchablePathspecs`
- **成因**：P3 的工作区快照遍历**包含** gitignore 文件（只跳过 `.git` / `node_modules` / `.venv` 等），因此 `sideEffects` 会含 gitignored 路径。而 `git add -A -- <显式指定的 ignored 路径>` 直接失败（`The following paths are ignored by one of your .gitignore files`），于是 safety snapshot 整体失败 → restore 报 `failed`，理由是一句裸 git 错误。
- **进一步**：即便修掉崩溃，restore plan 的 `removePaths` 来自 `ls-files --others --exclude-standard`（**排除** ignored 文件），所以 ignored 文件既不会被恢复也不会被删除 —— 若此时仍回报 `undone`，就是**声称撤销了一个实际没被撤销的路径**。
- **影响**：任何 exec 碰到构建产物（极常见）都会让 undo 失败或失真。
- **探针实测**：`.gitignore` 含 `src/generated.txt`，exec 同时改 `src/a.txt` 并创建该产物 → undo 返回 `failed`（不是 `undone`，所以不是静默数据错误，但安全网在此形状下缺失）。独立最小脚本复现 `git add` 拒绝行为。
- **修复**：
  1. `skipMissingPaths` 扩展为同时过滤 gitignored 路径（新增 `listIgnoredCheckpointPaths`，tolerant `check-ignore`）—— 与"缺失路径"同理：git 不会 stage 的路径对快照树没有贡献。
  2. exec undo 把 gitignored 副作用归类为**不可撤销**：默认结构化 `unsupported` + 零改动；`allowPartial: true` 才继续，并在 `skipped` 中列出。**不删除** ignored 文件 —— 那会删掉开发者的本地 `.env` / 配置。
- **回归**：`exec-side-effect-undo.ignored-probe.test.ts`（3 例：默认拒绝并点名、`allowPartial` 撤销可撤销部分且回报 skipped、全部 ignored 时拒绝）。
- **过程更正**：第一版 `check-ignore -z -- <paths>` 恒以 `fatal: -z only makes sense with --stdin` 失败（exit 128），被 catch 吞掉 → 过滤器恒空，修复看似生效实则无效。改为换行分隔 + `core.quotePath=false`，并跳过含换行的路径（不可往返，交给 `git add` 报真实错误）。

### 缺陷 3（正确性）—— retention 排序只有秒级精度，可删掉最新 checkpoint

- **位置**：`git-checkpoint-lifecycle.ts` 的排序，`git-checkpoint.ts` 的 `readCheckpointRecords`
- **成因**：排序用 git `creatordate:iso8601`，只有**秒**精度。同一秒内创建的多个 checkpoint 排序不确定（相等字符串 → 稳定排序退化为 ref 名序 ≈ commit hash 序，实质随机）。而 P6B 承诺的"最新 checkpoint 永远受保护"完全依赖这个排序：`ordered[0]` 若不是真正最新的那个，真正最新的就可能落在 `maxCount` 之外被删除。
- **放大因素**：P7 的 auto-checkpoint 按 turn 突发创建，同秒碰撞从理论变成常态。
- **实测**：`maxCount: 1` + 同秒两个 auto checkpoint → 应删 1 个，实际删 0 个（两个都被判为受保护）。这是"保护过度"的一面；反面（真正最新的被删）由同一根因导致。
- **为何自检没抓到**：自检的 retention 用例用 `serviceAt(dateIso)` 钉住 `GIT_AUTHOR_DATE`，人为拉开时间差，恰好绕开了同秒碰撞。全目录回归（用例更多、创建更密）才暴露。
- **修复**：改用 checkpoint commit **subject 行里已有的毫秒级 ISO 时间戳**（`OpenClaw UFTK git checkpoint <ISO ms>`）作为排序键 —— 数据本来就在，**不改元数据格式、不加第二套元数据存储**。`GitCheckpointRecord` 新增 `createdAtMs`（消息毫秒戳，缺失则退化为解析 git creatordate）；`listCheckpoints` 与 `retainCheckpoints` 按它数值排序。P5 checkpoint 的 subject 同样带该戳，因此一并受益。
- **刻意分离**：`maxAgeMs` 仍用 `Date.parse(record.createdAt)`（git creatordate）。"多旧"本身是粗粒度问题，且 `GIT_AUTHOR_DATE` 是调用方唯一能影响的字段（回填 checkpoint 时用）；"谁最新"才需要亚秒精度。两者读不同字段是设计决定，已就地注释说明。
- **回归**：`auto-checkpoint.test.ts` 新增"同秒突发中保留真正最新的那个"（6 个突发 checkpoint，断言 `listCheckpoints` 顺序恰为创建序倒序，且 `maxCount:1` 的 `kept` 恰为最后创建的那个）；`git-checkpoint.scoped.test.ts` 的元数据往返用例补断言 `createdAtMs`（含无戳消息退化分支）。

---

## 3. 验收矩阵逐项判定

### 3.1 承接项

| 项 | 判定 | 依据 |
|---|---|---|
| 承接 A：safety ref 不可误删 | **PASS** | 独立命名空间 + retention 只枚举 checkpoint 前缀 + 删除点 `assertRefInNamespace` 断言；端到端"大量 auto checkpoint + `maxCount:0,maxAgeMs:0` + 一次 `recovery_required`"后 safetyRef 与 recoveryRef 仍读出 restore 前内容；`collectGarbage` 亦不影响 |
| 承接 B：exec undo 覆盖守卫 | **PASS** | 本层显式调用 `scopeIsCoveredByCheckpointScope`；窄 checkpoint + 更宽 scope 的数据破坏形状直接复现为"文件仍逐字节存在"；变窄必须显式 `allowPartial` 并回报 `skipped` |
| 承接 C：三方并发正确性 | **PASS** | 创建不取写锁（以真实持锁 + 第二写者超时证明排他性）；quiesce 下等待 barrier；40 次读租约洪流中 barrier 仍被授予（不饿死）；三方并发全部 settle 无死锁，`lockContention` 有增量、`lockTimeout` 无增量 |
| 承接 D：跨平台 starttime | **PASS（选择实现而非顺延）** | win32/darwin 提供者落地；两个间隔 1.1s 的真实子进程 starttime 严格递增；pid 级缓存 40:1 摊薄、负缓存、TTL 重探、超限淘汰；win32 与独立 PowerShell 查询交叉比对一致 |

### 3.2 §6.3 其余项

| 项 | 判定 |
|---|---|
| exec undo：路径作用域恢复；非文件副作用 / 工作区外路径结构化拒绝；raw command 不落盘 | **PASS**（结果 JSON 不含任何命令文本，仅 `commandId`/`commandHash`） |
| worktree bridge：与 merge queue / conflict policy 协同；冲突可见、内容不静默丢失 | **PASS**（三种 policy 均零改动拒绝；只读队列，不 `processMergeQueue`；探测不消耗队列项） |
| auto checkpoint：默认 false；label 绑定 requestId；retention 生效；工具 schema 不变 | **PASS** |
| P6 回归全过；产品锁与全部 flags 保持 false | **PASS**（28 files / 250 tests） |

---

## 4. 门禁复核（修复后）

| 门禁 | 结果 |
|---|---|
| coding-runtime 全目录回归 | **28 files / 250 tests PASS**（P7 收卡时刻数字；2026-08-19 P6 收尾补入 A↔B 接缝探针后为 29 files / 255 tests，差额即该 1 file / 5 tests，非回归） |
| `coding-runtime-contract.test.ts` | 9/9 PASS（flag 数 12） |
| P6A 定向 | 67/67 PASS |
| P6B 定向（6 文件） | 63/63 PASS |
| P7 定向（4 文件，含恢复建议） | 59/59 PASS |
| P7 探针（2 文件） | 5/5 PASS |
| 承接 D（shared-core） | 12/12 PASS |
| `dcs-prod-flags-catalog` | 4/4 PASS |
| `typecheck:node` / `typecheck:web` | 0 error |
| `tsgo:core` | 0 error |
| `tsgo:core:test` | 3 项既有 RLG WIP + `goal-wake-runtime.test.ts` 1 项外部项；**无任何 P6/P7 文件** |
| `contract:check` / `lint:bom` / `lint:dcs` | PASS |
| `eslint`（P7 源码 + 测试全量） | exit 0 |
| `git diff --check`（P7 文件） | exit 0；新增未跟踪文件 trailing whitespace / BOM / 控制字节均为 0 |
| `verseshell:test` | 15 files / 141 tests PASS |
| `config-schema-parity` | 128/129，唯一失败为预存项 |
| `harness validate --no-diff` | `Spec is valid` |
| `harness validate`（diff 模式） | **exit 1**，非 P6/P7 引入，见 §5 |

**验收期一次自我发现的错误**：`tsgo:core:test` 一度出现我自己的探针文件 `exec-side-effect-undo.ignored-probe.test.ts`（TS2352）。根因是我在两个测试文件里用了 `status: "ok"`，而 `CodingExecEventStatus` 的合法值是 `succeeded | failed | timeout | cancelled | denied | running` —— `"ok"` 根本不存在。主测试文件因 `...overrides`（`Partial<CodingExecEvent>`）把对象类型放宽而侥幸通过类型检查。两处均改为 `"succeeded"`，`tsgo:core:test` 恢复为"无 P6/P7 文件"。

---

## 4b. 完整率专项复核（应"保证开发完整率 100%"追加）

在验收通过之后，对"规范点名但未做/未接线"的项做了一轮独立清查。**又发现 6 处缺口**，均已补齐：

| # | 缺口 | 性质 | 处置 |
|---|---|---|---|
| 1 | **`lint:dcs` 门禁从未跑过** | 真门禁遗漏。该 type-aware oxlint 的文件清单**恰好包含** P7 改动的 `types.openclaw.ts` / `zod-schema.ts` / `runtime-feature-leaves.ts`，而 §9 DoD 明确要求过 lint | 已跑，exit 0；并把 `lint:dcs` 与 `eslint <变更文件>` 补进规范 §7 与 harness `requiredTests`（两处此前**完全没有 lint 条目**） |
| 2 | **harness `requiredTests` 与实际严重不同步** | 可执行契约失真：P6A 定向缺 3 个验收期新增文件、P6B 定向缺 safety-retention、无承接 D、无全目录回归、无探针、`validate` 仍为 diff 模式 | 全部补齐，`validate` 改 `--no-diff` |
| 3 | **§2.2「P7 可选产物」的"恢复建议"未实现** | 规范为 P7 点名的三项产物中唯一未建的一项（patch export 与 review diff 已有） | 新增 `git-checkpoint-recovery-advice.ts`（纯函数，无 git/锁/文件）+ 10 例测试 |
| 4 | **`export { CodingRuntimeError, FULL_CHECKPOINT_SCOPE }` 是死代码** | P7 引入的零消费者再导出，还给两个已有归属的符号造了第二条误导性 import 路径 | 已删（连同仅为再导出而存在的两个 import） |
| 5 | **`processStartTimeProviderAvailable` 只有测试在用** | 未接线的能力探测 | 接入 `inspectCodingLocks().pidReuseDetectionAvailable` —— 它回答的正是 P6A residual R1 那个问题，使"本平台无法检测 pid 复用"可诊断而非隐形 |
| 6 | **§12 要求同步上游规范指针，未做** | 文档落地清单漏项 | `docs/dev/coding-runtime-development-spec.md` 的状态行、P6/P7 段、M6/M7 里程碑全部同步 |

**过程中自己抓到的两个错误**（都由我写的守卫或核对发现，不是外部反馈）：

- 恢复建议文本里写了 "Never use \`git reset --hard\` or \`git clean -f\`" —— **本身就包含这两个禁用串**，被我自己的守卫测试判红。守卫有价值不该放宽，故改措辞（"git's destructive whole-tree reset or force-clean primitives"）。顺带把 4 个 P7 相邻模块全部纳入 P6B 那个禁止项源码扫描（`CHECKPOINT_MODULES` 由 4 扩至 8），新模块不该成为禁用原语溜回来的缺口。
- 我在规范里先填了"29 files / 268 tests"，那是未实测的估数；实测为 **28 files / 250 tests**，已改正。

**一处刻意不动**：`git-checkpoint-transaction.ts` 的 `resolveRecoveryDir` 导出零引用（确属死代码，且是我在 P6B 写的）。但 P6B 已收卡，在无功能收益的情况下改动已验收模块的公开面不是 P7 该做的决定，故记为 residual R7 交由裁决，而非自行删除。

补齐后复跑：全目录 **28 files / 250 tests PASS**，typecheck:node/web 与 tsgo:core 均 0 error，`tsgo:core:test` 错误集合回到「3 项 RLG WIP + `goal-wake-runtime.test.ts`」（P7 期间短暂出现的 `session-activity-projection.test.ts` 已由其归属 workstream 自行消除，故**不列为常设允许项**）。

---

## 5. Residual（保留，不阻塞 P7 收卡）

| # | 项 | 影响 | 处置建议 |
|---|---|---|---|
| R1 | `harness validate` diff 模式 exit 1 | 变更集含 vs origin/main 37 个 + 324 个脏/未跟踪文件，约 250 个属其它 workstream。已把 P7 自己的 `src/shared/process-start-time.ts(.test.ts)` 补入 `touchedAreas`，并核实剩余未覆盖项**无任何 P6/P7 文件**。拒绝把外部文件写进 `touchedAreas`/`residualPaths`（伪造归属比门禁红更糟） | 仓库层面约定 `diffBase` 或清理脏树；跨 workstream 事项 |
| R2 | 承接 D 未接 `session-write-lock.ts` / `infra/stale-lock-file.ts` | 这两条 P1–P5 已验收路径在非 Linux 上仍无 pid 复用检测（有界延迟，非正确性） | **2026-08-19 用户授权后已实修闭环**，并连带修掉 2 个真实缺陷（自身 pid 每秒重探、死 pid 白跑子进程探测）。详见 `CODING-RUNTIME-P6-ACCEPTANCE-2026-08-19.md` §5.2 |
| R3 | win32 starttime 探测为 PowerShell 子进程（首次数百 ms） | 仅真实争用触发（`isPidAlive` 先短路），每 pid 每秒 ≤1 次；**自身 pid 已改为永久 memo（每进程 ≤1 次）** | 若成热点再考虑原生绑定 |
| R4 | `withWorkspaceQuiesce` 为可选辅助，auto checkpoint 默认不强制 quiesce | 不加 quiesce 时 turn 起点 checkpoint 可能与并发 restore 交错 | 由生产接线方决定（P7 尚未接线到生产） |
| R5 | 外部 workstream 临时 tsgo 允许项 1 项（`goal-wake-runtime.test.ts`） | 不占 P6/P7 额度；归属已按规定重新确认（untracked，mtime 与 P6 记录一致） | 归 goal-loop workstream 消除 |
| R6 | P7 模块均未接入生产工具路径 | 能力存在但无生产调用方；flag 全 false | 接线属独立决定，需另行授权 |
| R7 | `resolveRecoveryDir`（P6B 导出）零引用 | 死代码，无功能影响 | P6B 已收卡，删除其公开面需裁决；不由 P7 自行处理。**2026-08-19 已裁决并实修闭环，见下方追记** |

> **R7 闭环追记（2026-08-19，用户授权按建议收尾）**：裁决前重新细看，发现它比"零引用死代码"更值得处理——
> `git-checkpoint-transaction.ts` 的这份导出与 `git-checkpoint-safety.ts` 里**真正写入**的路径构造是两份重复定义，
> 且**已经漂移**：一份走 `path.resolve(stateDir)`，另一份不走。也就是说在相对 `stateDir` 下，
> 按恢复建议去查"我的 recovery 数据在哪"的调用方会被指向 snapshot 从未写入的目录——而这恰好是 `recovery_required` 之后
> 操作者唯一要走的那次查找。故处置不是删掉未用的那份，而是**单源化**：
> 规范化的 `resolveRecoveryDir` 移入 `git-checkpoint-safety.ts`（写入方所在模块，且 transaction 已 import 它，无循环依赖），
> 写入方改为调用它，`transaction.ts` 的重复定义与随之失效的 `node:path` import 一并删除。
> 新增回归 `reports a recoveryRef that resolveRecoveryDir reproduces exactly`：断言 `settled.recoveryRef` 与
> `resolveRecoveryDir(state, restoreId)` 逐字符相等，且该路径下确实存有 restore 前字节。
> 行为无变化（测试中 `stateDir` 本就是绝对路径，`path.resolve` 为恒等），消除的是两份定义之间的漂移可能。

---

## 6. 结论

**verdict：ACCEPT_WITH_RESIDUAL。**

P7 的四个承接项全部落地并实测（承接 D 选择实现而非顺延），三个新模块与其边界承诺一致，且验收阶段发现并修复了 3 个真实缺陷 —— 其中缺陷 1 会永久阻塞工作区、缺陷 3 会删掉刚创建的 restore point。剩余 6 项 residual 均已记录且不属于 P7 单方可解决范围。

**不得据此声称** UFTK GA、canary 或整体成熟度：全部 flag 仍为 false，产品锁未变，P7 能力没有任何生产调用方。
