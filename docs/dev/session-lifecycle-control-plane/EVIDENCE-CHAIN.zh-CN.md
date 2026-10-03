# 会话生命周期控制平面 — 完整证据链

> 状态：证据基线，随评审更新；Phase 2 实现证据见 `artifacts/runtime-lifecycle-governance/audit-2.json`；Phase 3 见 audit-3.json；Phase 4 见 audit-4.json；Phase 5 见 audit-5.json。
> 日期：2026-08-16
> 使用规则：本文件只记录“已被本地源码或外部检索证实的句子”。引用格式：
> - 本地：`路径:行号`
> - 外部：`标题 — URL`
> 未被证实的句子不得进入本文件。

---

## 0. 总览

本主题由两条独立证据线汇合而成：

1. **本地证据线**：ClawX 桌面壳 + OpenClaw runtime 源码审计，发现会话生命周期治理缺口。
2. **外部证据线**：Anysearch 检索主流软件/agent 运行时架构，证明正确方向是“把会话系统建模为面向 agent workload 的控制平面”。

最终产物：
- `DESIGN.zh-CN.md`：架构设计
- `RESEARCH.zh-CN.md`：外部设计调研与映射
- `EVIDENCE-CHAIN.zh-CN.md`：本文件，证据链
- `AGENT-PROMPTS.zh-CN.md`：给后续 agent 的地址与使用手册
- `docs/dev/adr/2026-08-16-session-lifecycle-authority.md`：权威边界 ADR

---

## 1. 本地证据：桌面 Workspace Terminal 生命周期（结论已由第 7 节 E3 修正：默认 keep_on_leave；真实缺口是 delete 接线与全局可见/上限）

| # | 结论 | 证据（本地源码） |
|---|---|---|
| D1 | 终端按 `workspaceId:sessionKey:kind` 作为唯一 active key | `electron/services/terminal-session-manager.ts:67-68` |
| D2 | 管理器维护全局 sessions Map 和 activeByWorkspaceSession Map | `electron/services/terminal-session-manager.ts:105-107` |
| D3 | 新对话只生成新 sessionKey 并更新 workspace.activeSessionKey，没有关闭旧会话终端 | `src/lib/workspace-session.ts:70-91` |
| D4 | 会话删除只清理 ResourceTracker，不调用 TerminalSessionManager | `electron/services/sessions-api.ts:1329-1337`、`electron/services/sessions-api.ts:2158-2176` |
| D5 | 只有 workspace 切换/删除/权限收紧才会关闭终端 | `electron/services/workspaces-api.ts:628-635`、`663-669`、`723-730` |
| D6 | 应用退出时会关闭全部终端 | `electron/main/index.ts:1354-1360` |
| D7 | 关闭/进程退出会 kill PTY 并回收记录 | `electron/services/terminal-session-manager.ts:253-272`、`295-306` |
| D8 | scrollback 有 120k 上限 | `electron/services/terminal-session-manager.ts:63,96-99` |

结论：同一 workspace 内反复新建/切换会话会遗留 PTY 进程和内存，直到 workspace 切换或应用退出。

---

## 2. 本地证据：Runtime 后台进程与 session 生命周期脱钩

| # | 结论 | 证据（本地源码） |
|---|---|---|
| R1 | running/finished 进程会话是模块级全局 Map，没有 scope 清理 API | `openclaw_runtime/src/agents/bash-process-registry.ts:111-112` |
| R2 | finished 记录 TTL 默认 30 分钟、上限 3 小时；sweeper 只清理 finished，running 无 TTL | `openclaw_runtime/src/agents/bash-process-registry.ts:13-15,353-368` |
| R3 | 进程退出时清理 stdio/listeners，但没有 session 级回收 | `openclaw_runtime/src/agents/bash-process-registry.ts:211-263` |
| R4 | supervisor 已有 `cancelScope()`，但会话生命周期从不调用 | `openclaw_runtime/src/process/supervisor/supervisor.ts:111-121`；全仓调用点只有 CLI runner 的 `replaceExistingScope` |
| R5 | `reconcileOrphans()` 是明确 no-op，重启不恢复不回收 | `openclaw_runtime/src/process/supervisor/supervisor.ts:359-368` |
| R6 | 普通 run abort 有意不杀后台进程 | `openclaw_runtime/src/agents/bash-tools.exec.ts:1920-1934` |
| R7 | session reset/delete 清理 subagent/browser/MCP/ACP/queue，但完全不触碰进程注册表/supervisor | `openclaw_runtime/src/gateway/session-reset-service.ts:375-425` |
| R8 | exec/process 用 sessionKey 作为 scopeKey，说明隔离设计存在，只是没有生命周期清理 | `openclaw_runtime/src/agents/agent-tools.ts:262-282,701-708,1042-1100` |
| R9 | 每个 ProcessSession 持久保存 sessionKey/scopeKey/mainKey/eventRouting，具备按 scope 清理所需数据 | `openclaw_runtime/src/agents/bash-tools.exec-runtime.ts:735-768,1213-1253` |

结论：session delete/reset/stop 后，后台 exec 的 `ProcessSession` 和 supervisor run 会无限保留；进程不退出则内存持续增长，Gateway 重启后 OS 子进程成为孤儿。

---

## 3. 本地证据：会话/Goal 信息识别割裂

| # | 结论 | 证据（本地源码） |
|---|---|---|
| I1 | runtime `sessions.list` 会返回 goal | `openclaw_runtime/src/gateway/session-utils.ts:2027-2039,2170-2181` |
| I2 | 桌面 `loadSessions` 映射时丢弃 goal | `src/stores/chat/session-actions.ts:128-143` |
| I3 | `ChatSession` 类型没有 goal/tokens/contextTokens | `shared/chat/types.ts:88-102` |
| I4 | `session.activitySnapshot` 只聚合 mission/taskLoop/clawGraph/subagents/long-task，不含 goal 和进程 | `openclaw_runtime/src/gateway/server-methods/session-activity.ts:1-9,26-100` |
| I5 | 桌面 SessionActivity 的 terminal 只来自 TerminalSessionManager.list() | `electron/services/session-activity-api.ts:91-138` |
| I6 | renderer session-activity store 的 snapshots 和 module Map 只增不删 | `src/stores/session-activity.ts:304-372` |
| I7 | `continuationTurns` 只在创建时初始化为 0，从未递增 | `openclaw_runtime/src/config/sessions/goals.ts:238`；全仓 grep 无其他写点 |
| I8 | 模型 goal 工具只允许 complete/blocked | `openclaw_runtime/src/agents/tools/goal-tools.ts:30,75-149` |
| I9 | `/goal` 命令支持 start/status/pause/resume/complete/block/clear | `openclaw_runtime/src/auto-reply/reply/commands-goal.ts:157-250` |

结论：goal 底层已存在，但桌面投影、SessionActivity、host API 均未承载；模型与 operator 的控制权限也不一致。

---

## 4. 本地证据：已有可复用的成熟子系统

| # | 结论 | 证据（本地源码） |
|---|---|---|
| P1 | subagent 生命周期已是 SQLite 持久化，带 cleanup/archive 字段 | `openclaw_runtime/src/state/openclaw-state-schema.sql:1279-1340` |
| P2 | task_runs / flow_runs 已有 SQLite 状态机与 retention | `openclaw_runtime/src/state/openclaw-state-schema.sql:986-1049,1394-1423` |
| P3 | TaskFlow CAS 已有合法转移图和 SQL 级 revision guard | `openclaw_runtime/src/tasks/task-flow-cas.ts:51-76,124-168`（LEGAL_FLOW_TRANSITIONS / casUpsert） |
| P4 | LongTaskControl 已有 checkpoint/intervention/queue SQLite | `openclaw_runtime/src/state/openclaw-state-schema.sql:1024-1105` |
| P5 | ProcessSupervisor 已有 child+PTY 适配、graceful kill、输出上限、exited 上限 | `openclaw_runtime/src/process/supervisor/supervisor.ts:25,232-241`；`openclaw_runtime/src/process/supervisor/registry.ts:9-16` |
| P6 | VerseShell governed process 已有 owner=workspace+agent+session、24h retention、restart lost | `docs/dev/verseshell-foundation/STATUS.md:233-260` |
| P7 | 桌面 ResourceTracker 已有端口发现、heartbeat、idle cleanup、session 删除时 unregister | `electron/services/resource-tracker.ts:21-29,185-208` |
| P8 | WebPreview dev server 关闭时会关闭其 PTY | `electron/services/web-preview-manager.ts:429-445` |

结论：不是没有治理组件，而是治理组件没有挂在统一的 session lifecycle 树上。

---

## 5. 外部证据：主流设计

| # | 外部结论 | 证据（检索来源） |
|---|---|---|
| W1 | 长 running agent 的 worker 不能是状态源；需要 durable session log/harness/sandbox/checkpoint/trace | Long-Running AI Agent Runtime — https://slavadubrov.github.io/blog/2026/05/26/ai-agent-runtime/ |
| W2 | Durable execution 要求 workflow 状态外置、activity 幂等、恢复时从 last checkpoint 继续 | Temporal for Durable AI Agents — https://activewizards.com/blog/indestructible-ai-agents-a-guide-to-using-temporal |
| W3 | session memory ≠ durable execution；node boundary 必须工程化为 replay boundary | Durable Execution for AI Agent Runtimes — https://zylos.ai/research/2026-04-24-durable-execution-agent-runtimes/ |
| W4 | 控制循环：spec=desired，status=actual，controller 收敛；level-triggered，不是 edge-triggered | Kubernetes Controllers — https://kubernetes.io/docs/concepts/architecture/controller/ |
| W5 | OwnerReferences 声明依赖；Finalizer 在删除外部资源前阻塞删除；cleanup 必须幂等且不能无限阻塞 | Garbage Collection in Kubernetes — https://svalle.ru/posts/kubernetes/garbage-collection-finalizers |
| W6 | supervision tree：父停则子递归停；failure 向父传播 | Erlang OTP supervisor — https://www.erlang.org/doc/apps/stdlib/supervisor.html |
| W7 | 进程归组管理：scope 结束时整组回收；最后进程退出后清理 cgroup | systemd.scope — https://man7.org/linux/man-pages/man5/systemd.scope.5.html |
| W8 | Windows Job Object 可一次终止整棵进程树，子进程默认继承 job | Job Objects — https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects |
| W9 | 资源 ownership 必须 lease + heartbeat + TTL，不能只靠锁/pid | Kubernetes Leases — https://kubernetes.io/docs/concepts/architecture/leases/ |
| W10 | 跨服务长流程用 saga + compensation；orchestration 优于散落 choreography | Saga pattern — https://microservices.io/patterns/data/saga.html |
| W11 | 控制面/数据面/管理面分离，便于权限与独立演进 | HashiCorp Well-Architected — https://developer.hashicorp.com/well-architected-framework/design-resilient-systems/design-control-data-management-plane |
| W12 | session 应是一等资源：可寻址、可 checkpoint、可 pause/replay、可 ACL | AWS Bedrock Session Management APIs — https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-launches-session-management-apis-for-generative-ai-applications-preview/ |
| W13 | thread_id 是隔离边界；checkpoint 是恢复点；store 是跨线程长期记忆 | LangGraph Persistence — https://docs.langchain.com/oss/python/langgraph/persistence |
| W14 | 会话池生命周期 Prepare→Acquire→Connect→Act→Release | Microsoft Windows 365 Agents — https://learn.microsoft.com/en-us/windows-365/agents/agent-session-lifecycle |
| W15 | 同一 key 的状态对象串行处理；durable log 是 ground truth | Restate Virtual Objects — https://docs.restate.dev/references/architecture |

---

## 6. 证据→设计决策映射

| 设计决策 | 直接支撑 |
|---|---|
| 保留命令式生命周期，不建 desired-state controller | D1-D8、R4-R9、W4（只用“观察 actual 差距”思想，不复制 controller） |
| `cleanupSessionBeforeMutation` 唯一 finalizer，补 drainScope | P1-P8、R7、W5 |
| 资源留在各 owner，SessionActivity 只做读模型 | D1-D8、R1-R9、I1-I7、P1-P8 |
| 终端 keep_on_leave；End/delete 才关闭；idleTtlMs=0、cap=null | D1-D8、W14 |
| delete 用 single-writer commit receipt；失败 fail-closed | D4、R7、W5 |
| 子 agent 进程在 quiescence 后递归 drain | W6/W7/W8、P1/P2 |

---

## 6.1 Phase 3 证据链（2026-08-18）

| 证据 | 结论 | 位置 |
|---|---|---|
| `armTxCount=1` | arm 只开一个 SQLite immediate transaction；提交后才 spawn | `openclaw_runtime/src/agents/mission-control/goal-wake.test.ts`（named test 输出 audit 行） |
| `processPollToolCalls=0` | goal wake 路径没有任何 `process.poll` 工具调用；supervisor exit -> task finalize -> level-check -> mission tick | `tests/e2e/runtime-lifecycle-governance.spec.ts` + `openclaw_runtime/scripts/goal-wake-e2e-trace.ts` |
| 重复 wake deliveries=2、tick=1 | mission `last_wake_id + revision` 是 effect owner 的持久去重；重复投递不重复副作用 | `goal-wake-e2e-trace.ts` duplicate-wake 段、`goal-wake.test.ts` fencing 用例 |
| `turnBarrier` pending/acked 持久化 | waiting flow 在 ack 前不 dispatch；ack 在 run 完全 idle 后发生 | `openclaw_runtime/src/agents/goal-wake-runtime.ts`、`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` |
| drain 扩展 goal rows 检查 | goal-owned task/flow 非终态时 drain 拒绝 mutation | `openclaw_runtime/src/gateway/session-drain-service.ts` |
| `exec wait=goal` default-off 且默认 background 行为不变 | flag-off arm 返回 `flag-disabled`；`background=true` 无 wait 字段仍返回 running | `openclaw_runtime/src/agents/bash-tools.exec.goal-wait.test.ts` |


---

## 6.2 Phase 4 证据链（2026-08-18）

| 证据 | 结论 | 位置 |
|---|---|---|
| `secretPersistenceFindings=0` | intent/started/exit/control/heartbeat 均无 raw argv/cwd/env/command/secret；tail 经过 redactSensitiveText | `openclaw_runtime/src/agents/goal-wake-helper-protocol.test.ts`（named 输出） |
| `intent` 无 `started` 且 helper 不存在 => `lost` | 恢复器只读文件协议 + OS liveness，绝不自动重启命令 | `process-run-reconciler.test.ts` crash matrix |
| `exit.json` 终态第一真相 | 即使 started pid 已死，有 exit 仍按 exit 终态恢复 | `process-run-reconciler.test.ts` |
| arm 提交后/spawn 前、spawn 后/started 前、started 后、exit 前/后、flow resume 前/后、tick claim 前/后 | crash matrix 状态均符合 `lost/running/terminal` 且无 spawn replay | `process-run-reconciler.test.ts` |
| session delete/reset 取消 helper、终态 task/flow、删除 runDir；重试不重复取消/删除 | `cancelAndReapDurableHelpersForSession` 由 `drainScope` 调用 | `goal-wake-durable-cleanup.test.ts`、`session-drain-service.ts` |
| Windows detached helper | 真实 detached 子进程写出 started/exit；cancel 写 control 并终止 child tree | `goal-wake-helper-host.test.ts` |
| Electron packaging | 复用当前 entry/loader 与 `ELECTRON_RUN_AS_NODE`；本机未执行 packaged build，launch 无法解析时 fail-closed | `goal-wake-helper-host.ts` `resolveDurableHelperLaunch` |
| 启动/低频 sweep | `startDurableHelperRecoveryService` 默认关；开启后启动即 sweep 一次并用 fs.watch+递归 setTimeout，无 setInterval/process.poll | `goal-wake-recovery.ts`、`goal-wake-recovery.test.ts` |
---

## 6.3 Phase 5 证据链（2026-08-18）

| 证据 | 结论 | 位置 |
|---|---|---|
| `activitySnapshotWriteFindings=0` | named test 在 snapshot 前后对 session store / process registry / supervisor / SQLite 写 API 做 spy，连续两次 collect 结果一致且写调用数为 0 | `openclaw_runtime/src/gateway/server-methods/session-activity-projection.test.ts` |
| goal/process/lineage 只读投影 | mission_runs、goal-wake flow/task 只读查询、bash registry snapshot、supervisor `snapshotRunsForSession`、subagent lineage；无 CAS writer / arm / finalize / drain 调用 | `openclaw_runtime/src/gateway/server-methods/session-activity-projection.ts` |
| snapshot 秘密卫生 | 投影 JSON 不含 objective、raw command、argv、cwd、env、error 原文，只含 id/label/status/pid/digest | 同上 named test 的 not.toContain 断言 |
| 空态/终态稳定 | 空 sessionKey、缺失 session、terminal flow/task 均返回空数组或终态状态，不抛异常 | 同上空态测试 |
| UI 只读渲染 | Panel 渲染 goal/process/lineage 三个 section，测试断言三个 section 内无 button；文案经 react-i18next en/zh/ja/ru | `src/pages/Chat/SessionActivityPanel.tsx`、`tests/e2e/session-activity-panel.spec.ts` |
| Electron 只转发聚合 | session-activity-api 仅把 Gateway snapshot 中的 goals/processes/lineage 并入 SessionActivitySnapshot，不新增 action | `electron/services/session-activity-api.ts` |

---

## 7. 第一次碰撞修正记录（2026-08-16）

评审 agent 的下列反驳被采纳，并已回写设计：

| 修正 | 旧结论 | 新结论 | 关键证据 |
|---|---|---|---|
| E1 | 建 SessionDesiredState + SessionReconciler | 撤回；保留命令式幂等生命周期命令 | `openclaw_runtime/src/gateway/session-lifecycle-state.ts:123` |
| E2 | 建 session_runs/session_resources 通用账本 | 撤回；资源留在各 owner，SessionActivity 只做读模型 | `electron/services/session-activity-api.ts:91` |
| E3 | 终端 close_on_leave | 改为 keep_on_leave；设计关闭仅在 End/delete/reset/权限/workspace/quit；当前代码的关闭触发点是权限/workspace/quit | `electron/services/terminal-session-manager.ts:118-125,253-273`、`electron/services/workspaces-api.ts:628-635,663-669,723-730`、`electron/main/index.ts:1354-1360` |
| E4 | pause/resume 承诺 checkpoint 续跑 | 撤回；当前停止路径只 abort 当前 run，恢复不重放 runtime 状态；gate+abort / gate-only 为后续设计 | `openclaw_runtime/src/gateway/server-methods/chat.ts:3401-3423`、`openclaw_runtime/src/gateway/session-reset-service.ts:407-426` |
| E5 | Handoff 自动转移 goal / drain 源资源 | 撤回；保持只读接力稿，源会话和源 goal 不变 | `docs/clawx-design-overview.md:861` |
| E6 | continuationTurns 统计 fork/handoff/resume | 撤回；字段从未递增 | `openclaw_runtime/src/config/sessions/types.ts:211` |
| E7 | 桌面 delete 本地删文件再补清理 | 设计改为先拿 runtime `runtime_committed` receipt，再关 Electron terminal，最后仅重跑 Electron-owned cleanup；当前代码仍是本地删除，属待实现 | `electron/services/sessions-api.ts:945-1004` vs `openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts:816-846` |

未采纳的反驳：无硬性未采纳项；评审指出的“最该做/最不该做”均被纳入 v2 设计。

### 7.1 第二次碰撞修正记录

| 修正 | 旧结论 | 新结论 | 关键证据 |
|---|---|---|---|
| E8 | `cancelScope` 可当 process drain | 只可作最后 kill 原语；drainScope 必须可等待、返回 timeout，并在 `waitForEmbeddedAgentRunEnd` 后调用 | `openclaw_runtime/src/process/supervisor/supervisor.ts:111,123` |
| E9 | Electron runtime delete 失败可本地 sweep 兜底 | fail-closed；只有 committed receipt 才做 Electron-owned cleanup；unknown/失败不 sweep（设计约束，当前 Electron 尚无 mirror gate） | `electron/gateway/manager.ts:123-129`、`openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts:816-846` |
| E10 | runtime 成功后复用 `deleteSession()` | 不可行：runtime 先移除 sessions.json 映射，Electron 再读会 not-found；且 Electron sweep 不匹配 runtime `.deleted.<ts>` 命名 | `electron/services/sessions-api.ts:958-1004`、`electron/utils/session-files.ts:225-233`、`openclaw_runtime/src/gateway/session-transcript-files.fs.ts:132-135` |
| E11 | 终端 idle TTL / workspace cap 可拍数字 | idleTtlMs=0；cap=null；`list({})` 已能列全局，无需 listAll | `electron/services/terminal-session-manager.ts:63,96-99,231-237`（文件中无 idleTtl/cap 常量）`、`electron/services/terminal-api.ts:509-515` |

### 7.2 第三次碰撞修正记录

| 修正 | 旧结论 | 新结论 | 关键证据 |
|---|---|---|---|
| E12 | fence 可用布尔检查 | fence 必须是原子 admission gate + 独占 token；身份 = agentId+canonicalSessionKey+expectedSessionId | `openclaw_runtime/src/auto-reply/reply/reply-run-registry.ts:74-107`、`openclaw_runtime/src/process/supervisor/supervisor.ts:123` |
| E13 | runtime 成功后返回 operationId | Electron 首次 RPC 前生成并持久化 operationId；manifest digest 幂等，同 ID 不同 digest conflict | `openclaw_runtime/src/gateway/server-methods/sessions.compaction.ts:820-827`、`openclaw_runtime/src/agents/approval-ledger.ts:277-296`（模式证据；Electron 先持久化 operationId 为设计新增） |
| E14 | canonical store 是 sessions.json | canonical store 是 per-agent SQLite `cache_entries`；行删除与 store_committed 同 immediate transaction | `openclaw_runtime/src/config/sessions/store-load.ts:398`、`openclaw_runtime/src/config/sessions/store-sqlite.ts:65,142`、`openclaw_runtime/src/state/openclaw-agent-db.ts:303` |
| E15 | cancelScope+wait 即 drain 成功 | drain 必须 owner wait + OS containment 为空 + registry 无新记录 | `openclaw_runtime/src/process/supervisor/adapters/child.ts:11,251`、`openclaw_runtime/packages/agent-core/src/harness/env/kill-tree.ts:111`、`openclaw_runtime/src/shared/pid-alive.ts:54` |
| E16 | Electron terminal 无 fence | Electron 本地 mirror gate 由同一 operationId 驱动，至少拦 terminal.open；unknown 不解 fence（设计新增；当前 `terminal.open` 无 fence） | `electron/services/terminal-session-manager.ts:127-135` |
