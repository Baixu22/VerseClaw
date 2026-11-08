# TF-0865 checkout writer transfer 窄复核

- `requested_model`: DeepSeek v4.1 Flash。当前工具未提供实际模型身份确认；本报告只记录 requested model，不从角色文案推测实际模型。
- 工作树：`D:/ClawX-work/session-task-unified-relay-20261109`
- 分支/HEAD：`codex/unified-effect-admission-20261109` / `dbe8f3e5c39ebef350705937dc05b9790c1d3b63`
- TF-0865 原状态：`in_progress`，进度 `25.0`。本次未改 Task Forest，未调整节点状态。
- 复核方式：只读代码、差异、契约和已有测试；未运行测试，未发其他会话消息，未修改 repo。
- 并发状态说明：复核开始时 `worktree-writer.ts` 尚未显示为脏；复核过程中该文件被外部并发修改，随后重新读取。最终只读快照含 `worktree-registry.ts`、`worktree-service.ts`、`worktree-writer.ts`、`checkout-writer-ownership.test.ts` 四个已修改文件及未跟踪的 `harness/specs/tasks/unified-effect-admission.md`。本报告按最终重新读取的 transfer 实现判断。

## 具体结论

当前 `transferCheckoutWriter` 已覆盖“同一物理 root 内，旧 writer 已 drain、全部 operation 已 settle、生成新 epoch/token、旧 token 立即失效、同 requestId/同 digest 重放返回同一凭据”这条核心路径，方向正确。

它还不是完整的原子 checkout transfer 权威。关键缺口有三处：

1. `resolveExecutionCheckout` 对新 base/managed 映射的解析、`claimWriter` 的 writer 获取、`transferWriter` 的 owner 切换是三个可被插入的时点。writer credential 没有携带 mapping 的 `scopeKey/revision/recordDigest`，因此映射在解析后、`beginWrite` 前变化时，现有同 root writer 独占仍可能成立，但 execution owner 语义已经过期。
2. `managed_worktree_scopes` 的注册与同一物理 root 的 `state_leases` 没有共同 CAS。相同 base 下两者受同一个 `.merge.lock` 串行化；跨 base 或直接 DB 插入时，第三方可在解析和 claim 之间改变 base/managed 归属。`findManagedWorktreeByRoot` 的全表读取和随后 `loadWorktreeRegistryScope` 也不是同一 authority snapshot。
3. Task claim/session binding 与 runtime writer 位于不同权威域。`transferCheckoutWriter` 只做资源 owner 轮换，无法单独证明 TaskSystemStore 已提升目标 claim epoch、目标 session generation/binding 已就绪，也无法覆盖跨 DB 崩溃窗口。可以允许短暂“双方都不能写”的可用性空窗；不能出现双方都可写或 target 无 task proof 却获得 active writer。

另需明确一次 transfer 的 lease 语义。当前实现将 `expiresAt` 设为 `null`；资源层“过期不转移”可以保留，但目标 task owner 的 lease、process settlement 和 expiry 必须由组合准入重新核验，不能由这次 writer 轮换替代。

## 原子 writer transfer 的最小事务不变量

建议把可执行 transfer 定义为“显式意图 + 单点提交 + 前向恢复”，而不是先 release 再 claim：

1. **单一 resolution snapshot。** 每次解析至少固定 `{canonicalRoot, baseRoot, worktreeId|null, generation, incarnation, mappingScopeKey, mappingRevision, recordDigest}`。`worktreeId === null` 必须是明确的“无 managed mapping”事实，并带可校验 fence，不能只是扫描未命中后的 fallback。
2. **source 静止。** 提交前重新验证 source credential 仍匹配当前 row；source 为 `draining`；所有 operation 均为 `settled`；需要覆盖的旧 generation 进程已结束或已由 owner 给出可审计结果。unknown/running operation 一律拒绝 transfer。
3. **同一提交点切换 owner。** 在一个短 SQLite 写事务中重新读取 mapping 与 `state_leases`，用 CAS 核对 resolution snapshot、source `root/incarnation/generation/epoch/token/owner`，然后只发布一次 `epoch + 1` 的新 token/owner。删除“旧已 release、新尚未 claim”的独立两事务窗口。
4. **旧凭据在提交后立刻失效。** target credential 返回前，source 的 `begin/settle/transfer/release` 与 maintenance 都已因 epoch/token 不匹配而拒绝。target credential 只有在 mapping snapshot、task/session/binding 和目标 generation 全部匹配时才可开始 effect。
5. **幂等记录属于 transfer，不只属于 claim。** 持久化至少应能恢复 `{transferId, requestDigest, sourceEpoch, sourceOwnerDigest, targetEpoch, targetOwnerDigest, mappingRevision, outcome}`。同 `transferId + digest` 重放返回同一结果且不得再增 epoch；同 ID 不同 digest 冲突；不同 ID 基于已退休 source epoch 必须 stale。
6. **跨任务库使用 durable intent/outbox。** 先用 task owner 的 pending operation 阻止 source effect，再提交 writer transfer，最后由同一 `transferId` 完成 task claim epoch/binding 提升。目标 effect admission 必须同时核对 task epoch 与 writer transfer receipt。崩溃恢复采取前向完成或隔离；如果两侧状态矛盾，保持双方不可写并要求 owner 核对。
7. **mapping 插入与 writer 获取互斥。** managed registration 在同一事务中检查目标 root 的当前 writer；writer 活动时拒绝 mapping 变化。跨 base 的路径不能只依赖各自的文件锁，必须有全局 canonical-root 的 DB 唯一性或 CAS fence。反过来，base/managed 切换只能在显式 transfer 中进行。
8. **跨 root transfer 先占目标、后切 source。** 若 handoff 更换 checkout，目标 root 只能是 reservation，不得提前进入 effect；source 在提交前继续是唯一权威。两侧 `state_leases` 的元数据切换应在同一 runtime SQLite 事务内，锁/claim 顺序固定为 canonical root 字典序，避免死锁。提交后 source stale、target active，旧 operation 只能 settle 其 source epoch。

## 幂等与第三方插入竞态测试建议

1. **commit 后、结果返回前崩溃。** 子进程完成 transfer 后在响应前退出；重启/reset DB handle，用同一 `transferId + digest` 重试。断言只增一次 epoch、返回同一 target token/owner，source 仍 stale。
2. **重复与冲突重放。** 同一 transfer 并发两次：得到同一结果；同一 ID 改 owner/task epoch/contract revision：`request_conflict`；两个 requestId 争同一 source epoch：恰好一个成功，另一个 stale。
3. **pending/unknown 阻断 transfer。** source 有 running operation、settle 为 unknown、或旧 generation 进程仍活时，transfer 均拒绝；owner 提供结算事实后才可重试成功。测试应读回 writer row 和实际文件。
4. **解析后插入 managed mapping。** 用一个进程解析独立 root 并停在 claim 前，用另一个进程以 barrier 注册该 path 为 managed。只允许一个结果：若 source writer 尚未取得，mapping 先提交、claim 返回 owner/changed；若 writer 已取得，registration 返回 writer busy。禁止 mapping 与 writer 分别提交成“半转移”。
5. **claim 后、begin 前 mapping 变化。** 先取得 independent source credential，再让第三方注册/替换 base-managed mapping。下一次 `beginWrite` 必须以 mapping/authority 变化拒绝，且不能触碰目标文件；source 行保留可结算或可释放事实。这是现有测试没有覆盖的关键 TOCTOU。
6. **两个 base scope 争同一物理 root。** 两个 Node 进程同时从各自 scope 注册同 canonical root。断言数据库最终只有一个 owner；败者无 record、无 writer；后续 `findManagedWorktreeByRoot` 不返回 ambiguous 双记录。该测试验证全局 canonical-root fence，而不是把重复检测留给事后报错。
7. **跨 root handoff 崩溃矩阵。** 分别在 writer commit 前、writer commit 后 task binding commit 前、binding commit 后 receipt 发布前注入退出。每种情况重启后断言 source/target 不可能同时 `beginWrite`；对应 `transferId` 重放收敛到唯一 receipt。
8. **cleanup/recreate 第三方插入。** 在解析与 transfer 之间执行 cleanup 或同 path 新 incarnation 创建。transfer 必须因 generation/incarnation/mapping revision 变化拒绝，不能自动采用替换目录；cleanup 不能删除已转移 owner 的保留资源。

## 建议优先级

- **P0：** 在真实工具入口接线前，为 “resolution/mapping revision + source epoch/token + transfer request digest” 加入同一 CAS/事务快照。仅凭当前单 root writer 独占，不能证明 base/managed owner 未变。
- **P0：** 为 Task claim 与 writer transfer 增加 `transferId` 关联的 intent/receipt，并覆盖两个 DB 提交点和进程退出恢复，保证任何时点不存在两个可写 owner。
- **P1：** registration/create 路径对目标 canonical root 检查现有 writer，并让跨 base 并发插入产生可回读的确定性拒绝。
- **P1：** 把现有顺序 transfer 测试扩展为真实多进程幂等/竞态测试；现有同 root drain、epoch、旧 token 负例可保留作为下层覆盖。

## 补充复核（2026-11-09）：mapping 风险收敛

本节覆盖前文的 mapping 全局 CAS 与“两个 authority 共享事务”表述。直接 SQLite 改写不属于合法并发路径，不纳入生产竞态前提。

### 裁定

在正常运行的生产约束下，没有合法调用路径可以把一个此前已有的 base root 重新登记成另一个 managed mapping，同时保持同一 path instance 和 generation。

因此：

- `mappingScopeKey + mappingRevision` 的全局 CAS 从 P0 降为未来扩展场景；当前不引入第二 fence。
- 不要求 TaskSystemStore 与 runtime writer 共用一个数据库事务。跨 DB 窗口由组合准入使用 durable intent/receipt、fail-closed 和 forward recovery 收敛。
- 当前同 root 的 `state_leases` 独占、record generation、native incarnation 和 base directory instance 校验足以覆盖正常 create/cleanup/claim/transfer 路径上的 mapping 变化。

### 生产调用顺序

**同一 base/id 的重复 create。** 进程先拿到 base 下的 `.merge.lock`；从固定路径 `base/.openclaw/worktrees/id` 读取记录，发现路径已存在或旧 record 未 cleaned 时直接拒绝。不存在“先建立第二个 intent 再覆盖旧 mapping”的合法步骤：

```powershell
service = createWorktreeService(baseRoot)
old = service.create("same-id")             # root = base/.openclaw/worktrees/same-id
retry = service.create("same-id")           # worktree_already_exists，原 root/record 保持不变
```

两个合法进程争同一 base/id 时，也是同一文件锁下的“一个先提交、一个看到已有路径/非 cleaned record 后拒绝”。胜者生成一个 generation；败者不能建立第二个 mapping。

**不同 base 试图取得同一 root。** 合法记录必须满足：

```text
record.root = base/.openclaw/worktrees/record.id
record.id  = safeWorktreeId(inputId)
```

`safeWorktreeId` 只产生单段文件名，不允许 `/` 或 `\`；两个不同 base 的 managed root 因而不能在没有 path alias 的正常目录树中指向同一路径。连接/symlink 到既有 managed root 会在 root native identity 检查处被拒绝。若 B 的子目录树与 A 的固定 managed 后缀重合，结论仍是二者 root 不同，不能形成同一物理 root 的两个合法 managed record。

**cleanup 后同 id 重建。** cleanup 删除目录但保留同 id 的 `cleaned` record。下一次 create 只在路径不存在时创建新 record，并重新执行 `randomUUID()`；旧 record 被新 record 替换而不是并存：

```powershell
old = service.create("one")                 # generation = G1
service.cleanup("one")                      # root removed; record("one").status = cleaned
next = service.create("one")                # generation = G2; G2 != G1
service.claimWriter("one", G1, owner, req)  # worktree_stale_generation
```

即使文件系统碰巧复用了相同 `dev/ino/birthtimeNs`，generation 仍由新 UUID 改变；旧凭据不会因此重新有效。

**已有 managed root 再作为另一个 service 的 base。** 这是合法的相邻场景，但不是“重新登记该 root”：

```powershell
managed = createWorktreeService(A).create("m")       # M = A/.openclaw/worktrees/m
nested  = createWorktreeService(M).create("n")       # M/.openclaw/worktrees/n
```

`nested.root` 与 `managed.root` 不同，M 的原 managed record 没有被改写。对 M 做 execution 解析时，`resolveExecutionCheckout(M)` 会优先找到 A 下的原 managed owner；若某调用方绕过它并直接用 `createWorktreeService(M).claimWriter(null, ...)`，得到的是同物理 root 上的另一 generation 竞争者，但仍命中同一个 `state_leases(scope, lease_key=canonicalRoot)`，只能有一个 active writer。这不构成 mapping 被并发插入。

### 支撑文件内容

`openclaw_runtime/src/agents/worktree-service.ts`：

```ts
const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "wt";
if (safeId === '.' || safeId === '..') throw new Error('unsafe_worktree_id');

const wtRoot = hardenFsRoot(path.join(rootDir, safeId));
if (pathEntryExists(wtRoot) || (s.records.has(safeId) && s.records.get(safeId)?.status !== 'cleaned')) {
  throw new Error(`worktree_already_exists:${safeId}`);
}

const rec: WorktreeRecord = {
  id: safeId, generation: randomUUID(), root: wtRoot, baseRoot: resolved,
  createdAtMs: Date.now(), status: "creating", writeSet, backend,
  registration: { operationId: createOptions?.operationId ?? randomUUID(), requestDigest, phase: "intent" },
  ...(owner ? { owner: { ...owner, retention: owner.retention ?? "keep" } } : {}),
};
s.records.set(safeId, rec);
saveWorktreeRegistryScope(s);
mkdirSync(wtRoot);
rec.registration.rootIdentity = filesystemInstance(wtRoot);
rec.registration.phase = "allocated";
saveWorktreeRegistryScope(s);
```

`openclaw_runtime/src/agents/worktree-registry.ts`：

```ts
if (data.schema !== 1 || ... 
  || literalRoot(record.root) !== literalRoot(path.join(baseRoot, ".openclaw", "worktrees", record.id))) {
  throw new Error("worktree_registry_invalid");
}

if (lstatSync(root).isSymbolicLink()) throw new Error("worktree_root_redirected");
```

`openclaw_runtime/src/agents/worktree-service.ts` 的 cleanup 保留 cleaned record：

```ts
if (rec.status === "cleaned") { ...; return; }
// remove checkout
rec.status = "cleaned";
saveWorktreeRegistryScope(s);
```

现有测试也直接覆盖了该事实：`tests/unit/worktree-registry-restart.test.ts` 的 `retains missing records and gives recreated managed checkouts a new generation` 断言 cleanup 后 `next.generation !== old.generation`。

### 修订后的最小不变量

1. claim/begin 继续在同一个 base `.merge.lock` 下按 record generation 和 root/native incarnation 复核；base claim 继续按目录 instance 校验。这部分已是有效 fence。
2. transfer 继续要求 source row 匹配、source drained、全部 operation settled，再在一个 runtime SQLite 事务内切到新 epoch/token/owner；需要新增的是 transfer receipt/幂等事实，不需要 mapping 全局 revision 表。
3. create/cleanup 与 transfer 的合法竞态由现有 base lock、record generation 和 `state_leases` root key 决定；不把直接 DB 篡改、手工伪造 `state_json` 或绕过 service 写表当作合法输入。
4. Task/session/binding 与 writer 不共享事务。组合层持久化 `transferId` intent，source effect 先进入 pending/draining；writer 提交后可重放。目标 effect admission 要求 task owner 的目标 epoch/binding 与 writer transfer receipt 同时匹配。崩溃后执行 fail-closed forward recovery：缺 task 侧提交就完成提升；缺 writer receipt 就保持双方不可写并重试该 transfer；状态矛盾则隔离，不开放任何 writer。
5. 全局 canonical-root 唯一性、跨 scope mapping revision CAS、对直接 DB 插入的防御属于未来 import/adopt API、外部数据库管理或状态损坏修复扩展场景；当前不增加第二 fence。

### 测试收敛

- 保留/补充同 base 多进程同 id create：恰好一个 record；败者无 root、无 generation、无 writer。
- 保留 cleanup→create：新 generation 与 instance 事实，旧 claim/begin/transfer 均 stale。
- 补充 managed root 作为第二 service base：原 mapping 不被改写；nested create 是不同 root；绕过 resolve 的 base writer 与原 managed writer 仍只能争到同一个 root lease。
- 跨 DB 测试改为在组合层注入“task 已提交/writer 未提交”和“writer 已提交/task 未提交”，验证 fail-closed 前向恢复。
- 不把直接 SQL 插入两个 managed scope、手工改 `state_json` 或全局 mapping revision 争用列入本节点的生产必需竞态测试。

补充复核期间工作树持续出现外部并发修改；最近一次只读快照新增了 `shared/task-system/identity.ts`、`shared/task-system/runtime.ts`、`shared/task-system/store.ts`、`openclaw_runtime/src/agents/execution-task-authority.ts` 和 `tests/unit/durable-task-authority-access.test.ts` 等变化。该列表仅记录观察时点，不代表完整状态。本次未修改 repo、未运行测试、未调整 TF-0865 状态，也未发送其他会话消息。


