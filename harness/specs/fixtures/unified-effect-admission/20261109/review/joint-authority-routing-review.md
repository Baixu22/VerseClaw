**TF-0865：显式 clone authority 接入任务 owner 的窄设计复核**

**建议采用“实例级 authority 访问参数 + 原 TaskSystemStore”这一条接线。** 保留 `resolveTaskDomain` 作为唯一文件/Git 身份解析；`resolveExecutionDomain` 只决定该本地域使用哪个既有任务 authority。所有生产任务入口用同一个打开函数取得原 TaskSystemStore，并在 guard、排队委派、Mission tick 中固定 authority 身份和注册版本。任务合同、claim、epoch、operation、验收记录继续只存在原 `task-ledger.sqlite3`，OpenClaw state 仅保存现有注册和 Mission 调度记录。

当前注册尚未贯通：**30 个生产 `new TaskSystemStore` 仍绕过显式注册，Store 内部两个跨工作树判断也仍只比较本地域。** 单改 Main 或 task_control 的构造参数不足以交付；运行中 guard、Gateway accept/reconcile、子任务回交和清理都必须使用同一 authority。

Mission 已有持久记录、tick revision/activeTickId 防重、checkpoint、恢复和 reviewer；它缺的是 canonical task 引用及执行凭据的贯通，不能将 Mission revision、taskLedgerRootId 或 reviewer 的 complete 当作任务合同 revision、claim epoch 或业务验收回执。

读取时间：2026-11-09 05:27–05:33:57 +08:00。main 与工作树 HEAD 均为 `dbe8f3e5c39ebef350705937dc05b9790c1d3b63`；工作树 `D:/ClawX-work/session-task-unified-relay-20261109`，分支 `codex/unified-effect-admission-20261109`。读取 15 个核心文件，调用边界仅做定点搜索/短片段回读。[源码哈希与调用点清单](D:/tmp/unified-management-20261109/joint-authority-routing-evidence.json) 已落盘。观察到 worktree-registry、worktree-service 和 checkout-writer 测试存在其他开发中的修改；下文 WorktreeService 引用来自所读工作字节。本轮没有修改源码、图或 Git 状态，没有运行测试。

**现有注册能证明什么**

[execution-domain.ts](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/execution-domain.ts:56) 已实现：

- 本地与 authority 都调用原 `resolveTaskDomain`；没有 remote URL、仓库名或标题匹配。
- 注册保存在现有 `execution_domain_registrations`，含 local/authority root identity、authority DB identity、actor、operationId/requestDigest、projectRevision、registration revision。
- 读取时验证 root/DB 未被替换、authority 为直接本地 authority、数据库存在且 schema=6、三张核心任务表存在。失败返回 `unavailable`。
- 成功返回 `authority` 的 id/root/database，同时将 worktree 设为实际执行 checkout。这个拆分正好适配 TaskSystemStore：互斥按 authority，文件与 claim 限制按实际工作树。
- 未注册返回 `independent`；同一 Git common dir 的 worktree 由原 identity 自然共用域，独立 clone 默认独立。

[WorktreeService](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/worktree-service.ts:408) 只导出 `taskAuthority` / `registerTaskAuthority` 包装。本轮限定生产目录搜索没有找到二者的实际调用方；`resolveExecutionDomain` 的生产消费者也只有这个包装。它目前是可调用的注册/探测入口，尚不是任务 Store 路由入口。

另外，`expectedProjectRevision` 当前可省略；TaskSystemStore 构造没有 authority pin，也没有注册版本参数。注册代码允许 expectedRevision 匹配后的重新注册，却没有读取 local task DB 是否已有独立任务，也没有检查当前任务执行是否已静止。它的注释要求 trusted owner，但调用参数中的 actor 字符串本身不构成授权。

**实际构造与 resolve 调用清单**

以下是限定搜索目录 `shared`、`electron`、`openclaw_runtime/src` 中非测试生产代码的全部直接构造命中。每个文件的具体行号和源行保存在 evidence JSON；下面按行为列出全部 30 处。

| 文件 / 入口 | `new TaskSystemStore` 行 | 本轮必须接入的边界 |
|---|---|---|
| [Main task-system-service](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/task-system-service.ts:15)：openTaskSystem | 31 | 列表、分页、sessionSnapshot、命令统一入口；先读注册，再判断 selected authority DB 是否存在。 |
| 同文件：assertManagedTaskAdmission | 87 | 委派前原 claim/epoch 及 delegation reservation；当前本地 DB 不存在会直接 return，registered 不可沿用这一降级。 |
| 同文件：read/startManagedSessionEffect | 127、138 | 只读合同→最终 owner 回读→事务内 expectedContract 校验；还要固定两次读取的 authority basis。 |
| 同文件：selectManagedSessionTask、handoffManagedSessionTask | 155、174 | selected reference 与换代必须操作同一 authority。 |
| 同文件：persistentTaskChatContext | 193、216 | 首次 binding、Fork 继承及 coordinator 环境二次打开；两个 Store 必须同域，worktree 各按真实执行位置。 |
| 同文件：taskSystemCommand claim/recover/其余凭据动作 | 280、296、311 | claim、原 owner recover、checkpoint/handoff/submit/accept/cancel 等，不能重新退回 local DB。 |
| [shared runtime](D:/ClawX-work/session-task-unified-relay-20261109/shared/task-system/runtime.ts:7)：inheritReference / worktree release | 11、20 | Fork 引用继承；清理前从 authority 检查实际 checkout 的未完成任务。 |
| 同文件：keepTaskRun / renew / finishRun | 44、55、83 | guard 中固定的 route 贯穿 beginRun、30 秒续期和 endRun；不能只保留裸 TaskDomain 而忘掉注册身份。 |
| 同文件：createTaskRuntimeGuard / readPersistentTaskContext / restoreTaskModelContext | 104、130、151 | 每次执行与压缩后 prompt 恢复均读相同合同；authority 不可用不能变成空任务。 |
| 同文件：executeTaskGuarded binding / effect | 226、244 | 同一 route 下取凭据、assertOwner、beginOperation、工具验证和结果对账。 |
| [task_control](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/tools/persistent-task-tool.ts:52) | 60、136 | 工具构建时的 pinned credential 与每次 execute 打开必须来自同一固定 authority；模型参数不提供 DB 路径或 resolver。 |
| [persistent-task-delegation](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/persistent-task-delegation.ts:8)：capture/prepare/dispatch/return | 11、36、79、99 | 排队前捕获、child generation 落盘后转移、丢回执记录、终态归还必须保留同一 authority 和 expectedParent。 |
| [Gateway tasks](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/gateway/server-methods/tasks.ts:153)：contract.reconcile / receipt / accept | 174、224、271 | 服务端从可信 session/workspace 解析 authority，再读 effect/verifier receipt；不可仅 Main 接入而 Gateway 验收仍查另一本地库。 |

原 `resolveTaskDomain` 调用逐项如下。**它们不能统一替换成另一个文件解析器**：物理路径比较与 authority 选择是不同用途。

| 文件 | 行号 | 处理 |
|---|---|---|
| `shared/task-system/identity.ts` | 17（定义） | 保持原实现。canonicalPath、Git commondir、bootstrap legacy DB 冲突等只在这里判断。 |
| `execution-domain.ts` | 58、65、90、91 | 保持物理解析，叠加注册判断。 |
| `task-system-service.ts` | 29、85、125、136、153、172、191、211、250、280、296、311 | DB 选择及 domain 比较改用有效 authority；真正 worktree 路径仍来自 local 物理解析。 |
| `shared/task-system/runtime.ts` | 9、18、101 | DB/guard 入口改走 authority；78 的结束匹配只取 `.worktree`，可以继续原物理解析。 |
| `persistent-task-tool.ts` | 58、130 | 解析 authority 并保持工具实例 pin。 |
| `persistent-task-delegation.ts` | 10、34、79、97 | 有效 authority；46 的 child 重试比较只取实际 `.worktree`，保持物理语义。 |
| Gateway `tasks.ts` | 172、222、269 | 有效 authority。 |
| `shared/task-system/store.ts` | 822、1070 | child delegation 与 handoff 目前按本地域 id 拒绝；需以实例持有的可信 authority 验证器比较有效 authority，不删掉检查。recover 在 1301 继续调用 handoff，也受影响。 |

另有独立验证脚本直接构造：`scripts/evaluate-durable-task-continuity.mjs:83`；`scripts/verify-durable-task-system.mjs:51、69、121、131`（69/121 为子进程脚本文本）。原 resolve 在对应 83、50、69、121。它们是独立本地域的测试/评估入口，可以显式保留 local fixture 模式；不能因此让生产 guard 默认为绕过注册。

**推荐的最小接线形状**

用一个小型、实例级的访问参数承载解析结果与校验能力，不新增 Store 类层次、插件注册器或进程全局 setter。建议逻辑分两层：

1. **原 registry owner 适配器**调用 `resolveExecutionDomain`，得到 local、effective authority、root/DB identity、registration revision 及可信 project revision。它负责 `independent/registered/unavailable` 的显式分支。
2. **shared TaskSystemStore 打开入口**接受该实例访问参数，实例内固定 authority 与物理 worktree。`shared` 不反向读取 runtime 配置，不 import OpenClaw state DB；Main/runtime 的组合入口提供适配器。

拟议接口形状，仅表示职责：

```ts
type TaskAuthorityBasis = {
  local: TaskDomain;
  authority: TaskDomain; // authority id/root/database + local.worktree
  registrationRevision?: number;
  projectRevision?: number;
  // registered 路径同时固定现有 root/database instance identity
};

// 内部依赖，由可信 Main/runtime 组合入口提供，不能来自模型参数。
type TaskAuthorityAccess = {
  basis: TaskAuthorityBasis;
  assertCurrent(): void;
  resolveRelated(worktree: string): TaskAuthorityBasis;
};
```

真正新增的产品能力是“打开原 Store 时携带已核验的 access”。无需再复制 task_contracts/claims/events，也无需把注册行放入第二个任务 owner。具体名称可合并进既有模块；不必为此建通用服务容器。

TaskSystemStore 可在现有 `now` 参数之后接受内部 access，原独立 fixture 继续使用本地域方式。生产 30 个构造统一经过打开入口；runtime guard 保存 access，heartbeat/恢复/结束复用该 access。相关目标 worktree 的验证也从同一 access 进入，检查有效 authority id 和 DB identity 相同，再继续保留 `claim.worktree === domain.worktree`。

这保留现有文件验收边界：Store 在 `:1536、:1710` 等处按 `domain.worktree` 解析 artifact。不能为了让 clone 通过就把 worktree 改为 authority checkout，否则 claim 与产物检查会指向错误文件。

`readManagedSessionEffect` 与 `startManagedSessionEffect` 当前由 [workspaces-api](D:/ClawX-work/session-task-unified-relay-20261109/electron/services/workspaces-api.ts:1313) 分两次调用，第二次已传最初合同 revision/digest（1351）。最小增量是同时传内部 authority basis；最终事务前确认 route 未变，而不是重新解析后接受另一个 authority 中碰巧相同的 TaskID/revision。

`expectedProjectRevision` 必须来自项目/环境 owner 的真实当前值。当前调用链还没有该参数入口；不能用注册行里的值与自身比较，也不能把 coordinator bindingRevision 当成同义字段。暂时没有该 owner 值时，至少固定并核对 registration revision 与 authority instance，不能对外声称项目 revision 已受保护。

**显式依赖怎样送到 shared runtime**

建议给现有 shared runtime 边界增加内部 access 参数，或提供一个薄 runtime facade 绑定固定依赖；两者只选一种。运行时已存在的调用点很少：

- `agent-tools.before-tool-call.ts:1205` 创建 guard，`:1340` 执行受管效果。
- `embedded-agent-runner/run/attempt.ts:3325` 创建模型上下文 guard，`:3328` 重新注入上下文，`:6166` 结束 run。
- `sessions.lifecycle.ts:606` Fork 引用继承。
- `worktree-service.ts:726` 任务引用清理屏障。
- Main `task-system-service.ts:202` 的 Fork 引用继承。

`agent-tools.ts:1356` 创建 task_control，其 options 必须携带同一 execution access；任务工具初始化与 later execute 不能各取当前全局路由。`subagent-spawn.ts:1772、1790` 的 capture/prepare 和排队恢复 `:351` 要保存 authority basis；`PreparedTaskDelegation` 现在只有 workspace+record，应补固定 authority 引用，不能恢复时仅凭 workspace 重新选 DB。

以上边界只做定点调用检查，没有扩大到全仓生命周期审查。

**可选架构与选择理由**

| 方案 | 修改面与结论 |
|---|---|
| **推荐：原 execution-domain 适配器 + shared 实例 access** | 30 处构造集中在 5 个消费模块；增加 Store 内两处目标 authority 校验和 guard/委派 pin。保留 registry 单一 writer、Store 单一 task owner；无需全局可变解析器。shared runtime 的依赖在少量上述边界注入。 |
| 把注册读取/判断下沉为 shared 纯函数，持久 registry 读写仍由原 owner 适配 | 也可行；便于 Main/runtime 共享路由算法，额外拆分并搬迁代码较多。若现有 Main bundle 导入 runtime adapter 造成边界/依赖问题可采用，但仍不能让 shared 自己选 OpenClaw state namespace 或写第二份注册。 |
| Main 通过 Gateway 同步/异步 RPC 获得 route，然后本地直接开 Store | 只拿一次 JSON 结果不足以解决 route 变更和 DB 替换；Main effect 入口当前同步，改造面更大。不作为最小方案。若采用，仍需要本地 identity/current 校验以及可信 authority pin。 |
| 全局 `setTaskDomainResolver` 或直接让 identity.ts 查注册库 | 不采用。会把文件身份与业务路由混在一起，且并发 run、测试和多实例可以改变彼此的解析行为。 |

**必须失败闭合的边界与独立 clone 策略**

| 条件 | 最小正确行为 |
|---|---|
| 首次解析，没有显式注册 | 保持 independent；同 remote 的两个 clone 不自动联合；原 common-dir worktree 继续天然共域。只有该模式允许首次创建自己的任务 DB。 |
| 已注册且 authority DB 缺失/被替换/模式不符 | 返回 unavailable 并停止任务效果、claim 和自动恢复；不能落回 local、返回空任务或创建同名新库。 |
| registry 无法读取/namespace 不一致 | 拒绝既有受管 route。Main 与 runtime 必须使用同一配置 owner 的注册 namespace；不能把“读了另一份空 registry”当未注册。已有 run 的 expected authority pin 能识别该退化。 |
| local clone 已有独立任务 DB，再请求联合 | 现有 register 没有这个检查。最小版拒绝自动转换，保留本地历史；不把已有 TaskID/claims 拷到 authority。后续迁移需独立的 owner 对账，不属于本次最小接线。 |
| authority 链/循环、root 或 DB instance 变更 | 复用现有 rejection；旧任务保持可核实状态，不生成替代身份。 |
| 排队、运行或工具实例中的注册 revision 改变 | 不升级旧实例的权限；原实例停止新效果并留下恢复原因。新执行重新从 owner 获得 route/合同/epoch。 |
| 独立 clone 请求移交到另一个未联合域 | 原 domain mismatch 继续拒绝。只有两个实际 checkout 经显式注册解析到同一 authority，才走原 handoff/delegation 事务。 |
| authority 文件检查后消失 | 当前 Store 构造会 mkdir、打开并初始化 DB；单个 existsSync 预检不够。registered 模式必须禁止缺库初始化，并在打开及写事务前复核 DB identity/schema；不能在此竞态创建空 task authority。 |
| registry 重新指向另一 authority，与任务事务并发 | 两个 SQLite 库没有天然联合事务。最小可交付策略是联合关系激活后不允许在活动执行期间改投另一 authority；沿既有写入占用/静止屏障串行登记或迁移。仅“事务前再读一次 registry”不能声称消除了重新指向的竞态。 |

推荐第一轮将显式 clone 联合限制为“没有本地任务历史的 clone，登记到已存在的直接 authority”。同目标重试沿现有 operationId/requestDigest 幂等；新目标、替换 clone 或断开联合保留为明确恢复流程，不在普通 admission 中自动迁移。这是可自动执行的 owner 策略，不需要所有者手工填写 TaskID 或操作步骤。

registered 的所有读入口也应显式 unavailable，而不是 `{tasks:[]}`：当前 `openTaskSystem`、assertManagedTaskAdmission、selectManagedSessionTask、handoff、delegation 多处依靠本地库不存在直接 return/null。必须先解析路由再决定“真正独立且尚无 DB”的空状态；不能把注册故障吞掉。

**Mission 现状：有调度 owner，缺受管任务引用**

| 入口 / 存储 | 现有事实 | 缺失的 canonical 入口 |
|---|---|---|
| [MissionRunRequest / MissionRunRecord](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/mission-control/types.ts:125) | sessionKey、workspaceId、objective、字符串 acceptance、metadata；revision/activeTickId 是 Mission fencing。 | 没有 session generation、实际执行 worktree、authority basis、canonical taskNodeId、contract revision/digest、claim epoch。 |
| [mission_loop options](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/tools/mission-loop-tool.ts:25) | 只有 agentSessionKey、requester agent、config、deps。run/tick 传任务文字与摘要。 | 无 runtime workspace/generation 或受管 task 引用。应由调用上下文补入，不能把凭据字段加入模型可任填参数。 |
| [Gateway Mission parser/deps](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts:59) | parse session/workspace、摘要与 acceptance；deps 配置 lifecycle 与 spawn。 | 没有从 session/environment owner 回读 generation、规范工作树及 TaskSystemStore binding 的依赖。mission.tick/恢复必须重新验证记录中的引用。 |
| [createMission](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/mission-control/controller.ts:1039) | ensureLongTaskLedgerRoot 保存 root 到 metadata；该步骤异常被 catch 后仍创建 Mission。 | taskLedgerRootId 是长任务投影链接，不是完整 TaskContract。受管执行所需 canonical 读取失败不能沿这段 best-effort 继续。 |
| 同文件 tick `:1165–1197` | goal-wake 用 Mission revision+activeTickId 获得单 tick。 | 不校验 Task contract revision/claim epoch；两个版本号不能互换。 |
| 同文件 `:1248–1274` → task_loop | 传 sessionKey、workspaceId、taskLedgerRootId、acceptance、lineage。 | 受管 task/revision/epoch/worktree 未传入下一层。 |
| [task-loop-controller](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/task-loop-controller.ts:185) | 请求无受管引用；`:3528` 的 RoleSpawnContext 仅 agentSessionKey/requesterAgentId。 | 缺 workspaceDir、实际 generation 和受管引用。下游 capturePersistentTaskDelegationIntent 依赖 ctx.workspaceDir，缺失时返回 null；本文件没有补接该字段。 |
| [Mission store](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/mission-control/store.ts:165) | 已有 metadata_json 可持久保存内部 typed 字段，原 mission_runs/events 是调度记录。 | 可在现有 metadata 保存版本化 managedTask 引用，读回时校验；无需建立另一套任务/claim 表。 |
| Mission complete `controller.ts:1554` / 工具 resultPolicy | reviewer complete 写 Mission complete，工具报告 completion=mission_reviewer。 | 没有按 canonical task/revision/epoch/candidate 回读业务验收回执。受管 Mission 必须把 reviewer 决策和任务验收结果分开。 |
| Mission pause/resume/cancel `:1719–1759` | 改 Mission 调度状态；重启恢复在 `:1697` 把 interrupted tick 置 sleeping。 | 未显式连到受管 task 的暂停/取消/epoch 恢复；恢复后不能借当前同 session 的另一任务继续旧 Mission。 |

模型入口的 `mission_loop` 并非必然无保护：有正常 runtime guard 时，它不在 shared readonlyTools 列表中，会经过外层 `executeTaskGuarded`。但那只约束当前工具调用，不能替代 Mission 记录跨 tick/重启的绑定；Gateway `mission.run/tick` 和 goal-wake 直接进入 controller 的路径也不能靠模型工具外层提供同一保证。

**Mission 的最小受管接法**

在既有 metadata 内增加一个版本化 `managedTask` 内部引用，字段来自真实 owner：

```ts
// 拟议持久引用，不是新 claim owner。
{
  schema: 1,
  taskDomainId, taskNodeId,
  contractRevision, contractDigest,
  sessionKey, generation, epoch,
  executionWorktree,
  authorityBasis // 现有注册 revision / authority identity 的固定引用
}
```

1. **create/run 入口**：通过 MissionControllerDeps 的一个受管任务适配能力，从可信 workspace/session owner 回读 authority 与当前 canonical binding。绑定已有合同，或复用已有 task_control 的完整合同创建/领取路径。现有 `acceptance: string[]` 本身不能证明拥有 typed verification 合同，缺失时保留 Mission 记录为不可执行并给出明确原因，不猜任务、不用标题查 TaskID。
2. **每个 tick / resume / goal-wake**：先按记录回读同一 authority、session generation、contract revision/digest、claim epoch；再沿已有 Mission tick fencing 执行。合同变更/换代/只读引用拒绝旧执行。用稳定 missionId/tick identity关联 task operation，重启先对账 owner 回执，不因 tick 又发生就生成第二业务任务。
3. **task_loop / spawn**：透传执行 worktree 和受管引用到 RoleSpawnContext/dispatch。复用已有 capture→prepare→dispatch→terminal return；每个并发 writer 使用既有 decompose 得到的各自 child task，observer 只读，不能让多个 worker 共拿同一 parent claim。
4. **checkpoint/完成**：Mission 继续保存调度与 reviewer 状态；业务证据、submit/verify/accept 仍交原 TaskSystemStore 和现有 verifier/effect owner。受管结果显式返回任务验收回执，reviewer complete 只触发核实，不能自行更新 task done。
5. **暂停/取消/恢复**：Mission 的调度控制与 task/effect 控制分别调用原 owner；pending/unknown effects 保持恢复状态。缺 managedTask 的历史 Mission 可继续只读展示，获得可信完整绑定前不执行新的受管 tick。

其中 authority route、Task contract revision 和 Mission tick revision 是三套不同的并发依据，应在一个 tick 输入中并存、分别验证；不再增加第四套“统一任务完成状态”。

**实施与验收的最小切分**

先交付 authority 路由：统一 5 个构造消费模块、Store 两处跨域校验、runtime/Fork/清理调用边界；再交付 Mission managedTask 引用。不要把“注册可读”与“所有实际副作用已使用 authority”合并成同一个完成声明。

所需窄验证：独立 clone 默认隔离；注册后 Main 与 task_control 读相同 TaskID；两 checkout 对同任务只有一个 writer；clone 内 artifact 仍按 clone 路径验收；跨 clone handoff/observer/排队回交通过原 epoch；authority 缺失/替换/注册变化不创建 local DB；Mission 经模型、Gateway 和重启 tick 三入口均拒绝陈旧合同/epoch；reviewer complete 无有效任务 receipt 时不提升业务任务状态。

以上是接线设计与验收建议，本轮没有运行这些验证。它也不替代本主线另行负责的 checkout writer、process owner 与副作用联合准入；authority 注册只确定任务 owner，不授予工具权限或工作树写入权。
