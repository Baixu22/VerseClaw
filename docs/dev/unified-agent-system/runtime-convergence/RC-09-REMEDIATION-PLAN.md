# RC-09 NO-GO 修复与重新送审计划

> 状态：approved-for-planning / implementation-not-started
> 日期：2026-08-03
> 失败候选：`fac6327a2d4c03b7517daa2fd819b891086d912c`
> 原基线：`6493d5cce6fbfa558aa26eb4cfb5a4cd71504664`
> 审计证据：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/independent-audit-2026-08-03.md`
> 当前结论：`NO-GO`；RC-10 保持 blocked，不授权真人 provider/channel 验收、default-on、promotion 或 done。

## 1. 目标与 PASS 定义

本计划不以“预计可过”或实现者自述作为保证。所谓“保证能够 PASS”只采用以下可执行定义：

1. 每个独立审计发现都有对应代码修复、反例测试和可定位证据；不存在以注释、静态数组、regex、mock-only 或恒真断言代替生产行为的情况。
2. RC-00..RC-09 严格串行；当前包的 scoped Harness、聚焦测试、全局 lint/typecheck 和独立 Verifier 未通过时，下一包不得启动。
3. 最终候选必须是自包含的 clean commit；所有声明的 source、spec、rule、lockfile、baseline 和测试均来自同一候选或其明确基线，不依赖主工作树未提交文件。
4. RC-09 的全部强制门禁在两个独立 detached worktree 中真实执行、退出码为 0、skip 数量符合固定预算、产物非空且摘要可重算。
5. 独立 Verifier 对同一 manifest 重跑全部 gate 后生成绿色 `final-report.json`；任何 gate 失败、超时、no-op、产物缺失、digest 不匹配或证据陈旧均保持 `NO-GO`。
6. 工程 PASS 只允许把程序推进到 `human_acceptance_pending`；只有用户执行 RC-10 并记录 `accepted` 才允许 `done`。

因此，本计划保证的是 fail-closed 的判定闭环：未满足全部条件时绝不宣称 PASS；满足时有第二工作树和独立身份的可复现证据，而不是文字保证。

## 2. 不可变边界

- OpenClaw Gateway/runtime 继续是 runtime authority；不得新增第二 runtime、workflow engine、receipt store、memory/context store、协议、telemetry store、router、daemon、port 或 sidecar。
- `runtime_receipts`、approval ledger 和 TaskFlow 只能复用既有 openclaw-state SQLite、事务和权限边界。
- RuntimeTaskEventLog、runtime-spine、trajectory、Observability JSONL 继续是 diagnostic/projection，不得授权 lifecycle、effect replay 或 telemetry truth。
- raw prompt、tool output、message body、credentials、cookies、环境变量和 provider payload 不得默认持久化；持久证据只允许规范化 digest、refs、identity、version、policy digest 和 bounded metadata。
- unknown effect 不自动 replay；domain journal 是 effect/idempotency truth，EffectReceipt 只解释和关联。
- npm fallback 必须显式 `degraded/unavailable`，不得贡献 receipt coverage、MCP health、readiness 或 promotion。
- `liveReady=false`、`productApproved=false`、`defaultOn=false`、`promotionAuthorized=false` 和 human/live 计数保持不变。
- 主工作树中的 Task Forest、FakeCoding UI、checkpoint、tombstone 和其他未提交 workstream 不得混入修复候选。

## 3. 审计失败基线

| 区域 | 已确认问题 | 关闭条件 |
|---|---|---|
| Evidence | RC-01 baseline 未进入候选；无完整 final manifest/Verifier report；本地 Executor 为 NO-GO | clean candidate 自包含 baseline；新 run 生成完整、相互绑定的 Executor/Verifier evidence |
| Build health | clean candidate typecheck 2 errors；lint 4 errors/120 warnings；全量 Vitest 159 failures | 新基线先全绿；候选复跑所有最终 gate 仍全绿 |
| Harness | final spec 无法覆盖累计 diff；acceptance 使用 `--no-diff` 绕过 | 每个 changed path 精确归属一个 RC；所有真实 review 均不使用 `--no-diff` |
| RC-02/03 | receipt digest 可伪造；只有 Anthropic 局部路径；seal/WireReceipt 无真实生产 caller | 所有 source provider 与八类真实入口走最终 guarded boundary；反例和端到端接线测试通过 |
| RC-04/05 | Map 仍 authoritative；raw JSON；状态越级；真实 send 前记 applied | durable owner 单写；严格 CAS 状态机；digest-only；真实 domain outcome 后才完成 reconciliation |
| RC-06 | create 绕过 revision/初态；deliveryState 未落库；三个 legacy lifecycle owner 未完成 cutover | RC-06A capability proof 真实成立；B/C/D 完成单 writer cutover、cancel/restart/child/wait 证明 |
| RC-07 | 只返回无人消费的 error 字段；静态分类不等于 enforcement | config/startup fail closed；从真实 registry 计数 owner/writer；传播和 flag-off 测试通过 |
| RC-08A/B | helper 无生产 caller；测试断言本地常量；exporter 不导出 | catalog/health/trace 真实接线；MCP initialize fixture 与 neutral OTLP fixture 通过 |
| Validator | `--phase` 未校验；reportDigest 只查 64 hex；source digest 不可移植 | canonical digest 真正重算；phase/actor/gate/source/candidate 全量 tamper tests 通过 |
| Windows gates | comms 脚本入口在 Windows no-op；channel conformance 只是源码 regex | 命令主体真实执行并生成校验产物；channel fixture 执行 adapter 行为和故障注入 |

审计报告中的所有文件行号与复现场景是本计划的初始 finding ledger。实现期间为每一项分配稳定 ID，并在对应测试名和最终 manifest 中记录，不允许只在 PR 描述中声称已修复。

## 4. 控制面复位

在改代码前完成以下动作：

1. 通过受支持的 Task Forest proposal 将 TF-0020..TF-0041 置于重新验证序列；TF-0042 保持 blocked。由于验收基础将被修改，RC-00 虽在本次审计中 PASS，也必须重新跑 Verifier。
2. proposal 应复用原 RC 节点并按 `RC-00 -> RC-01 -> RC-02 -> RC-03 -> RC-04 -> RC-05 -> RC-06A -> RC-06B -> RC-06C -> RC-06D -> RC-07 -> RC-08A -> RC-08B -> RC-09` 串行解锁，不创建平行任务真源。
3. proposal 应在用户确认后 apply；禁止 `--allow-stale`。每次只允许一个 ready/in_progress RC。
4. `STATUS.md.accepted_work_packages` 只在独立 Verifier evidence 存在后追加；当前审计事实只支持 RC-00，开始修改 RC-00 基础设施后该项也暂时移除。
5. 旧 `fac6327a2` evidence 标记为 rejected/historical，不覆盖、不复用、不刷新其 digest。新 run 使用唯一 output directory。
6. 修复或重新安装受支持的 Task Forest CLI；在此之前只允许只读检查 JSON，不直接手改 `.agent-workbench/task-forest/**`。

## 5. 规格先行修正

当前 spec 中存在会让“测试通过但目标未实现”的内在矛盾，必须在首个实现 commit 前修正并验证：

- RC-04 的“default-off best-effort mirror”不能同时满足“durable approval 是唯一 authority”。spec 必须区分 observe、cutover 和 emergency rollback；accepted 状态下生产 caller 必须可达 durable owner，Map 最多是无权威 cache。
- RC-06B/C/D 的“default-off read-only projection”不能同时满足“TaskFlow/TaskRegistry 是唯一 lifecycle writer”。每个 spec 必须包含 projection、cutover、legacy freeze 和 rollback 四阶段，验收落在 cutover 后。
- RC-07 的“default-off enforcement”不能同时满足“只允许一个 memory/context owner”。accepted 状态下 owner 唯一性必须是 startup/config invariant；可选 diagnostics flag 可以关闭，但不能恢复 multi-writer authority。
- RC-09 final spec 相对 RC-01 base 验证累计 diff，不能再声明“无 runtime 变化”且只覆盖 docs/scripts。它必须引用所有 RC specs，并为累计 changed paths 建立精确 ownership matrix。
- final spec 的 `expectedUserBehavior` 应表达“外部默认行为和产品锁不漂移、内部 authority 按已验收迁移”，而不是否认累计实现改动。
- `--no-diff` 只可用于 checked-in example 的结构检查；任何 RC 实现或 final acceptance 都必须使用真实 diff 校验。

规格修改后先运行：

```powershell
pnpm harness context --spec harness/specs/tasks/<active-rc>.md
pnpm harness validate --spec harness/specs/tasks/<active-rc>.md
```

若 Harness 因路径不归属而失败，修正 ownership 或拆分 commit；不得扩大 glob 来掩盖其他 workstream。

## 6. RC-00R：验收基础与可复现环境

### 实现

- `scripts/lib/agent-engineering-acceptance.mjs` 移除 final gate 中的 `--no-diff`；manifest 必须记录实际执行的完整命令，不能把 cached/fast gate 冒充 final gate。
- `scripts/validate-runtime-authority-convergence.mjs` 对 `engineering` 和 `human` phase 建立显式 schema；未知、缺失或不匹配 phase 立即失败。
- validator 调用 acceptance library 的 canonical report digest 实现，清除 `reportDigest` 后重算完整语义内容，再 constant-time 比较；不能只验证 64 hex 格式。
- validator 重算并校验 manifest digest、candidate commit/tree、base ancestry、changed paths、source inputs、actor separation、每个 gate 的 command/exit/count/skip/log digest、product locks 和 human residual。
- source input 使用候选 Git blob identity 和固定 EOL 策略；Executor 与 Verifier 在各自 clean checkout 重算。禁止把 dirty 主树生成的 manifest 搬入 clean checkout。
- final Harness spec 引用每个 RC task spec，生成 `changed-path -> RC owner` 清单；未分类、重复分类或排除 workstream 混入均失败。
- 增加 deterministic bootstrap：根依赖与 `openclaw_runtime` nested workspace 均以 frozen/offline 模式安装，随后验证 lockfile 和 tree 未变化。
- 修复 `scripts/comms/replay.mjs` 与 `compare.mjs` 的 Windows URL/path 处理，使用 `fileURLToPath(import.meta.url)`；命令必须生成非空、schema 合法、candidate-bound 的 metrics/report。

### 反例测试

- invalid/missing base、dirty source、source digest drift、changed-path drift、actor 相同、actor 空白、report 任意字段篡改、log 篡改、错误 phase、漏 gate、额外 skip、no-op command、空产物、运行后 worktree 变脏均为 NO-GO。
- 在 CRLF Windows worktree 和 LF detached worktree 中对同一 commit 生成一致的 Git-bound source identity。
- comms 字面命令必须调用 `main()`，删除输出后复跑必须重新生成；只退出 0 但无产物的 fixture 必须失败。

### 退出条件

- RC-00 fixture 在两个 detached worktree 真实 green；Executor/Verifier actor 不同。
- `tests/unit/agent-engineering-acceptance.test.ts` 覆盖全部 tamper cases。
- RC-00 scoped Harness 不带 `--no-diff` 通过；独立 Verifier 重新接受 RC-00R。

## 7. RC-01R：自包含基线与全局绿线

### 实现

- 先处理被排除 Chat/UI workstream 对全局 gate 的依赖：将其形成独立、已审查且全绿的前置 commit，或将收敛修复 rebase 到包含该修复的 clean base。不得从 dirty 主树借用 `ChatInput.tsx`。
- 在新的 clean base 上先证明未应用 Runtime 收敛 delta 时 `typecheck`、`lint:check`、`pnpm test`、build 和必需 E2E 均为 0 exit；不接受“非本 diff 引入”作为 final gate 豁免。
- 重新生成 `artifacts/runtime-authority-convergence/rc-01/baseline.json`，确保它被 Git 跟踪，并记录新的 `acceptedBaseSha`、source/npm versions、完整 writer inventory 和 receipt-owner proof。
- generator 输出必须 deterministic；测试验证 `git ls-files` 包含 baseline、clean clone 可读取、重跑无 diff、所有 owner path 在候选存在。
- 将原 116 个 changed paths 重新分类到唯一 RC owner；未提交 Task Forest/UI/checkpoint/tombstone 不得进入候选。

### 退出条件

- clean clone 中 RC-01 baseline 6/6 及 control-pack tests 通过。
- baseline 对每个 writer 有唯一分类和 owner path；acceptedBaseSha 是候选祖先。
- 新基线的全局 gate 证据进入 manifest，独立 Verifier 接受 RC-01R。

## 8. RC-02R：真实全入口 Shadow Receipt

### 实现

- `ReceiptStore.put` 只接收 typed canonical input；store 内部规范化并重算 `contentDigest`，caller 提供 digest 时必须逐字节一致，否则拒绝。
- selected/omitted/budget/identity/kind/version/runtimeMode 使用 schema/enum 校验；任意字符串、缺失 call identity、raw content 字段均拒绝。
- 同 idempotency key + 同 canonical content 返回 duplicate success；任何语义字段不同都 conflict-fail。数据库 UNIQUE/CHECK 和应用层测试同时覆盖。
- 在 provider projection 前冻结真正的 logical context；在每个 provider-specific finalizer 之后、send 之前的共享 guarded request boundary 对最终序列化 body 生成 WireReceipt。
- 覆盖 runtime registry 中全部 source providers；不允许只在 Anthropic 特判。provider 新增时测试分母自动增长。
- Desktop、Cron、channel fixture、CLI/compact、embedded attempt、context engine、payload hook、provider transport 的矩阵必须调用真实入口，最终由 transport spy 截获 bytes 和两类 receipts，不能循环标签直接调用 emitter。
- npm fallback capability probe 返回 `runtimeMode=npm`、`receiptCoverage=0`、`readiness=false` 和明确 degraded reason。
- shadow write 失败不改变发送 bytes/order/retry，但写入 acceptance failure counter，使 RC-02 无法通过。

### 反例测试

- 复现审计中的伪造相同 `contentDigest` + 不同 logicalDigest，第二次必须 conflict。
- raw prompt/tool output/credential/message body 注入每个可序列化字段均失败。
- 对每个 provider 比较 observer off/on 的最终 bytes、tool order、retry identity 和 approval/delivery side effects，必须完全一致。
- 每个入口必须留下唯一 attempt/model-call/wire-attempt identity；npm fallback 不计 coverage。

### 退出条件

- owner-classification coverage 100%，unknown=0，所有 source-runtime model call 同时有 Context/Wire shadow receipts。
- 八入口是生产调用链证据；focused tests、full typecheck/lint、Harness 和独立 Verifier 全绿。

## 9. RC-03R：生产 DCS Seal 与双收据

### 实现

- 从真实 source-runtime config 向 embedded runner、context orchestrator 和 provider transport 传递同一 RC-03 capability/kill switch；所有 model-call caller 均可达 seal。
- producer registry 只记录真实 producer 执行结果。hook 不得自行把所有 producer 标为 applied；缺失、重复、顺序错误或 seal 后 semantic mutation 立即形成 acceptance failure。
- `ContextReceipt/v1` 绑定 immutable ContextBundle；`WireReceipt/v1` 绑定最终 guarded request bytes，并包含注册的 non-semantic transforms。
- tool loop、same-provider retry、provider fallback、compact、fork、handoff 使用规范 identity 递增规则并保持 correlation。
- receipt 写失败结果必须进入可查询 diagnostics 和 acceptance census；不能吞掉后仍宣称 complete。
- kill switch 走原 legacy path，并以 golden bytes/ordering 证明 parity。

### 反例测试

- 正常 agent turn 不显式传测试参数也必须根据生产 config 进入 seal。
- 删除一个 producer、在 seal 后修改一条 message、在 finalizer 后改变 body、receipt store 写失败，均使 acceptance test 失败但不改变发送语义。
- 每个 provider 的实际 send body digest 与 WireReceipt 重算值一致。

### 退出条件

- 全仓 provider-bound semantic mutation 都映射到真实 producer execution；unknown=0。
- 真实入口到 transport 的集成测试产生相关 ContextReceipt/WireReceipt；独立 Verifier 接受 RC-03R。

## 10. RC-04R：Durable Approval 唯一权威与严格 Effect 状态机

### 实现

- Gateway 生产初始化显式构造并注入 durable ledger。进程 Map 删除或降为可丢弃 cache；所有 reserve/read/resolve/expire/restart 路径以 durable owner 为准。
- approval/effect 表只存 canonical digests、refs、identity、decision/outcome 和 bounded error code；移除 raw `request_json`/`proposal_json` 或迁移为不可逆摘要。
- 每个 transition 使用同一 SQLite transaction 和前置 state/revision CAS：`intent_reserved -> approval_pending -> approved|denied -> execution_started -> applied|not_applied|unknown -> reconciled`。
- `needs_reconciliation` 只能从 unknown/不可判定 journal 状态进入；不能自动 replay。denied 永远不能进入 execution_started。
- EffectReceipt idempotency 比较覆盖 proposal digest、approval ID/decision、executor、outcome、journal refs、recoverability 和版本；任一不同均 conflict。
- timeout、process restart、duplicate resolve、DB busy/failure 和 domain journal recovery 使用同一状态机；所有 DB helper 显式收到正确 database/transaction 参数。

### 反例测试

- approval_pending 直接 record applied 必须失败；denied 后 execution 必须失败；applied 前无 execution_started 必须失败。
- 不同 proposal/approval/decision/recoverability 但同 executor/outcome 必须 conflict。
- raw secret 经过 reserve/effect 后扫描 DB 不得出现；Gateway restart 后 pending/resolved 可完整恢复。
- 每个 transition 前后注入 crash，并从 domain journal 得到唯一、可解释的最终状态。

### 退出条件

- process Map 不再是 approval truth；unknown effect 不自动 replay；duplicate effect count=0。
- schema migration、upgrade/reopen/downgrade/rollback proof和独立 Verifier 全绿。

## 11. RC-05R：真实 Operator 治理与交付一致性

### 实现

- Cron ingress 只能创建 approval intent；禁止硬编码 `approved`。批准必须来自真实治理 policy/Inbox decision，并记录 actor/policy digest。
- bounded file/message effect 必须调用真实 domain executor。对于 channel send：先进入 execution_started，再根据真实 adapter/journal ack 写 applied；明确失败写 not_applied；无法判定写 unknown/needs_reconciliation。
- 不得在 channel send 前写 applied/reconciled。retry 只允许 domain journal 证明未执行或 provider idempotency contract 明确支持时进行。
- UI lineage 从真实 ContextReceipt、approval ledger、EffectReceipt 和 recovery state 构建，不伪造 `context:<sessionKey>` 引用。
- 将 `channel:conformance` 从源码 regex 改为可执行 adapter fixture；覆盖 connection drop、rate limit、duplicate delivery、restart、denial 和 unknown outcome。
- 新增/更新 Electron E2E，覆盖可见 approval、pending/recovery/result；文案走 en/zh/ja/ru i18n。

### 反例测试

- slice 成功但真实 send 失败后，记录不得为 applied；安全 retry 不会被错误 duplicate 拦截。
- crash 分别发生在 approval、send 前、send 后未 ack、journal 后 receipt 前；恢复结果与 domain journal 一致。
- denial 的实际 adapter call count=0；重复 intent 的实际 effect count=1。

### 退出条件

- executable channel fixture 和 Electron E2E 通过；regex/常量测试不能作为行为证据。
- 真实 effect outcome、receipt、ledger 和 UI projection 一致；独立 Verifier 接受 RC-05R。

## 12. RC-06AR：TaskFlow CAS 能力证明

### 实现

- 新 flow 使用明确 create sentinel（例如 expectedRevision=-1）和规范初态；任意 revision 或 terminal 初态创建必须拒绝。
- 更新使用 `UPDATE ... WHERE id=? AND revision=?` 并检查 affected rows；revision 单调递增，合法 transition graph 在 transaction 内验证。
- `deliveryState` 落入明确 schema owner，并与 flow lifecycle 在同一 transaction 或有可证明的原子关联；类型声明而不持久化不可接受。
- 使用两个独立 DB connections/process actors 做并发竞争；只允许一个 writer 成功。
- reopen/restart 后 revision、wait、terminal、delivery state 完整恢复。

### 反例测试

- 审计反例 `expectedRevision=999 + initial succeeded + delivered` 必须失败。
- stale revision、illegal transition、terminal resurrection、并发双写、delivery/lifecycle 分裂均失败且不产生部分行。

### 退出条件

- RC-06A capability proof 覆盖 create/update/concurrency/restart/delivery；未通过前 B/C/D 全部 blocked。

## 13. RC-06BR/CR/DR：三个域的实际单写迁移

### RC-06B ClawGraph

- 先保留 legacy authority，运行 read-only projection 和 drift census；任何 conflict 必须产生可查询 drift evidence，不能 catch/skip。
- 在受控 cutover flag 下由 TaskFlow 写 lifecycle；ClawGraph Map 只作 cache/projection。完成 restart、cancel、child task、terminal 和 rollback tests 后冻结 legacy writer。
- “restart”必须重建真实 controller/runtime，而不是同进程再次调用 helper。

### RC-06C Mission

- Mission definition 转为 TaskFlow template/controller；`mission_runs/events` 在兼容窗口内只读投影，不继续写 lifecycle truth。
- 真实 controller restart、wait/resume/cancel/terminal、old-row compatibility 和 rollback tests 通过后冻结 legacy writer。

### RC-06D Task Loop

- TaskFlow 状态模型和 Task Loop adapter 显式支持 cancelled；真实 cancel API/event 必须执行并断言，不接受用 blocked/waiting 冒充。
- wait/resume/terminal/cancel lifecycle 由 TaskFlow/TaskRegistry 单写；Task Loop Map 只作 projection，`long_task_checkpoints` 只保留 checkpoint material。
- replay/recovery 只重建状态，永不执行 effect。

### 总退出条件

- 静态 writer inventory 与动态 instrumentation 都证明 TaskFlow/TaskRegistry 是唯一 workflow lifecycle writer。
- 三个 legacy owner 的 write path 被删除、冻结或在 emergency rollback 中显式互斥；不存在 indefinite dual-write。
- 每个子包分别通过 scoped Harness、真实 lifecycle tests 和独立 Verifier，严格按 B -> C -> D 串行。

## 14. RC-07R：Memory/Context Slot 强制收敛

### 实现

- 配置 normalization 发现非 owner memory slot、重复 owner 或非法 contextEngine 时必须 fail closed；不能只返回无人消费的 `slotConvergenceErrors`。
- runtime startup 和 plugin reload 必须消费同一 validation result；错误配置不得进入 normalized active config。
- owner/writer census 从实际 plugin registry、memory store bindings 和 contextEngine registry 生成，不使用硬编码机制数组作为证明。
- DCS 是唯一 contextEngine slot；VToken/AgentMap 仅 stateless packer/benchmark，Working Context 仅 query projection，SEKB 仅 human-confirmed proposal，Runtime Memory 不得旁路 active memory slot 或 DCS。
- diagnostics flag 关闭时 query/write 都为 0；关闭 diagnostics 不得恢复多 writer。
- delete/correction 从 active memory owner 向 projection/candidate cache 传播，且不会触发 SEKB auto-writeback。

### 反例测试

- 非 owner 显式 slot、两个 memory writer、第二 context engine、plugin hot reload 注入旁路均在 startup/reload 阶段拒绝。
- 对真实 stores 计数，flag-off query/write=0；delete/correction 后旧值无法从任何 projection 返回。

### 退出条件

- runtime enforcement 有生产 caller；parallel persistent memory writes=0；独立 Verifier 接受 RC-07R。

## 15. RC-08AR：MCP 与 Host-native Tool 真实接线

### 实现

- `tool-convergence` 分类接入实际 tool catalog、host API projection 和 health 状态；删除测试内自造的分类真源。
- MCP connected 只能由 SDK `initialize` 握手成功后的 runtime state 设置；配置存在、HTTP GET、socket open 均不能置 connected。
- 使用本地 fixture server 执行 initialize/capabilities/list-tools/ping/failure/reconnect；测试协议与 Inspector-compatible contract。
- 不支持的 WebSocket 配置在 schema/normalization 阶段拒绝；Streamable HTTP 命名与 SDK transport 一致。
- Git/storage/terminal/browser 只有存在真实 MCP server/runtime path 时才标 MCP，否则稳定标为 host-native。
- approvals、SecretRef、network policy 和 hot reload 行为保持并加入回归测试。

### 退出条件

- catalog 与 runtime support 一致；fake-connected=0；生产 health consumer 真实读取 handshake 状态。
- 根测试必须 import 并运行生产实现；独立 Verifier 接受 RC-08AR。

## 16. RC-08BR：OTel/Observability 真实导出

### 实现

- correlation IDs 从实际 ingress 进入 run、model/tool、approval/effect、delivery，不由测试独立构造；每段 span/receipt/journal 可关联但不互相取代。
- exporter helper 接入现有 diagnostics-otel/OTLP pipeline；`exported=true` 只有 fixture collector 收到并验证 span 后才成立。
- redaction 同时检查 attribute key、value、events、links、resource、exception 和 baggage；普通 key 中放 raw prompt/tool content 也必须被阻止或不可逆摘要化。
- exporter off 不改变 payload、ordering、retry、approval、effect 或 delivery；trajectory 有界，Observability JSONL 可删除重建。
- 使用 neutral local OTLP receiver 验证一条 ingress -> model/tool -> effect -> delivery golden trace；不新增第二 trace store/schema。

### 反例测试

- exporter 不可达、partial failure、bad cert/config、raw content in benign key、missing correlation segment 均产生诚实 health/error，不改变业务路径。
- 删除 exporter/Observability cache 后业务结果一致；删除 rebuildable cache 后可从 OTel/receipts/domain journals 重建必要 projection。

### 退出条件

- golden trace 被真实 collector 接收；exporter-off parity 和 raw leakage=0；独立 Verifier 接受 RC-08BR。

## 17. RC-09A：全局工程债务与测试真实性

- clean base 与每个 RC commit 都运行 `pnpm run typecheck` 和 `pnpm run lint:check`；不得依赖 dirty ChatInput 修改。
- 删除所有 convergence tests 中的恒真断言、本地常量证明和 mock-all 行为；测试名中的 restart/cancel/drop/rate-limit 必须真的执行对应动作。
- 固定“收敛聚焦集合”的显式文件列表和预期 test count；manifest 从 runner 解析实际 passed/failed/skipped/total，不能手写“167”。
- `pnpm exec vitest run` 与正式 `pnpm test` 的语义必须区分；RC-09 使用 `ACCEPTANCE.md` 声明的正式全量 gate，不用聚焦集合替代。
- lint 退出码必须为 0；全仓 warnings 如仍存在则记录固定 baseline 且不得增加。任何文档“0 问题”声明必须与真实输出一致。
- build、Electron E2E、schema/Kysely generation、lockfile、generated bridge 和 evidence generation 后都验证 `git status --short` 无意外 mutation。

## 18. RC-09 最终 clean-candidate 流程

### 18.1 候选冻结

1. 每个 RC 已有独立 green report，Task Forest 串行状态一致。
2. 所有源码、spec、rule、测试、baseline、lockfile 和必要 fixture 已 commit；`git status --short` 为空。
3. 从新的 `acceptedBaseSha` 计算累计 changed paths；每条路径恰好映射到一个 RC，排除 workstream 数量为 0。
4. 创建 detached candidate worktree；设置固定 Node/pnpm 环境、EOL 策略和无真实 provider credentials 的环境。
5. 根和 nested runtime 依赖均 frozen/offline 安装，安装后 tree/lockfile 不变。

### 18.2 最终强制门禁

以下命令全部真实执行；任何一条非 0 都停止，不生成绿色 Verifier 结论：

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm --dir openclaw_runtime install --offline --frozen-lockfile --ignore-scripts
pnpm run lint:check
pnpm run typecheck
pnpm test
pnpm run contract:check
pnpm run i18n:lint
pnpm run comms:replay
pnpm run comms:compare
pnpm run harness:ci
pnpm -w run ext:bridge
pnpm run build:vite
pnpm run test:e2e
pnpm agent-dev:deep-test
pnpm agent-dev:audit
pnpm run channel:conformance
```

此外，逐个运行 RC-00..RC-08B scoped Harness 和 focused tests，并运行：

```powershell
pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md
```

禁止加 `--no-diff`。comms、channel、OTLP、MCP 和 E2E gate 必须验证其预期产物/行为，不以 exit 0 单独判 PASS。

### 18.3 Acceptance evidence

- 清空或使用从未存在过的唯一 final output directory；不得覆盖旧 rejected evidence。
- 在 candidate worktree 执行 `plan -> executor -> status`；Executor 只能记录 engineering result，不能自行设置最终 accepted。
- Verifier 使用不同 actor 和第二个新 detached worktree，从 manifest 重建环境并重跑全部 gate，不共享实现者的 node_modules 变更、临时 DB 或未提交文件。
- Verifier 生成 `final-report.json` 后，validator 重算 manifest/report/log/source digests 和 gate counts。
- 生成 final evidence 后 source worktree 与两个 detached worktree均保持 clean。
- generated evidence 在不改变 candidate SHA 的独立 evidence bundle 中归档；bundle manifest 记录 candidate SHA、自身 digest 和生成时间，避免递归修改候选。

### 18.4 最终唯一 PASS 条件

同时满足以下条件才允许把 `STATUS.md` 改为 `human_acceptance_pending`：

- RC-00..RC-09 全部在 `accepted_work_packages`，每项都有独立 Verifier report。
- final manifest `sourceComplete=true`、`candidate.cleanAtPlan=true`、changed paths 精确一致、所有 source digests 在第二 checkout 匹配。
- required gates 100% exit 0；固定 skip budget 无偏差；无 timeout、no-op、stale/cached 代替 final、空产物或意外 worktree mutation。
- final report `role=verifier`、`result=pass`、`engineeringAcceptedByAgent=true`、failures 为空；Executor/Verifier 身份不同。
- semantic `reportDigest`、manifest digest 和每个 log digest均由 validator 重算成功。
- privacy scan、duplicate-effect scan、single-writer scan、npm-degraded scan 和 product-lock scan 全部为 0 violation。
- `humanEvidenceRequired=true`、recommendation=`review_needed`、promotion=false；RC-10 仍由用户执行。

## 19. Finding 关闭矩阵

| Audit finding | 修复包 | 必须出现的证明 |
|---|---|---|
| baseline/final evidence 缺失 | RC-00R/01R/09 | tracked baseline、unique manifest、独立 final report、clean clone reproduction |
| 3/7 source digest 匹配 | RC-00R | Git-bound source identity、跨 EOL checkout test |
| typecheck/lint/full Vitest 失败 | RC-01R/09A | clean pre-change baseline + final full gates |
| final Harness 失败/`--no-diff` 绕过 | RC-00R | changed-path ownership matrix + no-diff regression |
| ReceiptStore digest/类型绕过 | RC-02R | forged digest/raw field/property tests |
| 假八入口/Anthropic-only | RC-02R | registry-driven provider x real-entry matrix |
| seal/WireReceipt 无生产 caller | RC-03R | entry-to-final-body integration tests |
| durable ledger 只是 mirror/raw JSON/越级 | RC-04R | single-owner restart + strict CAS + DB privacy scan |
| send 前 applied/失败 retry 丢失 | RC-05R | fault-injected real adapter journal tests |
| RC-06A create/deliveryState 缺陷 | RC-06AR | invalid-create and atomic delivery regression |
| B/C 只投影、D 无 cancel/仍多 writer | RC-06BR/CR/DR | real cutover/restart/cancel/child + writer census |
| slot errors 无消费者 | RC-07R | startup/reload fail-closed tests |
| MCP helpers 无接线 | RC-08AR | SDK initialize fixture + actual catalog/health |
| OTel helper 不导出/恒真断言 | RC-08BR | neutral collector golden trace + redaction attacks |
| validator phase/digest 假校验 | RC-00R/09 | semantic tamper suite |
| Windows comms no-op | RC-00R | literal command creates schema-valid outputs |
| channel conformance regex | RC-05R | executable adapter failure matrix |

该矩阵的每一行都必须在最终 report 中链接到具体 test file、command、log digest 和 result。任一行缺证据，RC-09 保持 NO-GO。

## 20. 提交与回滚策略

- 每个 RC 使用独立、可审查 commit；不要把所有修复压成一个不可定位的大 commit。
- 每个 commit 只包含该 RC spec ownership matrix 允许的路径；发现其他 workstream 变化时停止并重新隔离。
- schema change 必须包含 forward migration、旧 DB reopen、失败中断和 downgrade/compatibility proof；不删除旧数据。
- shadow/observe 阶段 rollback 是关闭 observer；authority cutover 的 rollback 是显式、互斥地切回旧 writer，不能双写。
- 旧 rejected evidence 只读保留；新 evidence 使用 runId 隔离。
- 若任一修复要求新增被边界禁止的 authority，停止该 RC，回到 owner review，不自行引入新框架。

## 21. 会话交接要求

每个开发会话结束前必须记录：

- 当前唯一 active RC、候选 SHA、base SHA 和 clean/dirty 状态；
- 已关闭 finding ID 与对应测试证据；
- 实际执行的命令、exit、test counts、skip counts 和未执行项；
- 下一步唯一动作及其前置条件；
- Task Forest proposal/apply/validate/export 状态；
- `STATUS.md` 与 `docs/dev/handoffs/LATEST.md` 的事实同步。

禁止使用“基本完成”“预计会过”“只差证据”代替上述可复现状态。
