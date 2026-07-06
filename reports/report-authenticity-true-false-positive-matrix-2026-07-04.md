# 44 项能力真实性对比矩阵：真阳性、假阳性与可运行边界

日期：2026-07-04
仓库：`C:\Users\27933\Desktop\clawx\ClawX`
关联文档：

- `reports/report-authenticity-audit-2026-07-04.md`
- `reports/report-authenticity-followup-plan-2026-07-04.md`
- `reports/report-authenticity-followup-qa-sources-2026-07-04.md`
- `reports/real-runtime-task-validation-2026-07-04.md`

机器可读准入矩阵：`shared/capability-claims.ts`
机器可读状态表：`artifacts/capability-claims/status-table.json`

## 0. 最终结论

当前最准确的结论是：

> **核心真实执行链路是真阳性，并且已经运行证实。** Electron App、Gateway、DeepSeek `deepseek-v4-flash`、agent、`edit`/`exec` 工具、workspace 文件系统、Node 测试 oracle 能协作完成真实代码修复任务，三轮 repair 都成功。

> **很多“高级能力”是半真阳性或假阳性。** 不是因为完全没有代码，而是因为代码存在的位置、默认开关、UI 入口、数据回写、质量信号或真实运行证据不满足“产品可用”的标准。

最短判断：

| 类别 | 结论 |
|---|---|
| 有代码且真实跑通 | Chat/Gateway 主链路、DeepSeek flash 实际调用、agent 文件修改、agent 执行测试、独立 oracle 通过、Observability trace 查询、Execution Graph 可见、本次 DeepSeek flash 模型一致性。 |
| 有代码且单元/E2E 证明局部可用 | Workspace permission、角色权限、Memory 管理面板、Role origin badge、Task Loop 单元路径、Compaction artifact。 |
| 有代码但仍只证明局部或边界不完整 | 完整审计产品语义、Plan 模式严格 no-diff、即时 `chat.history` startup 稳定性、普通编排 active 质量闭环、敏感内容全链路边界。 |
| 过度宣传会变成假阳性 | “Chat 可拖拽编辑 DAG”“普通 Chat 自动进入 Task Loop”“任意失败自动全量回滚”“动态角色自动淘汰”“全链路敏感信息绝不落明文”“checkpoint 是完整快照”。 |

## 0.1 当前修复原则：先跑通，再对齐

后续修复以“系统可运行”为第一优先级。知识库、架构说明、报告和真实运行状态出现不一致时，先确认核心 `Chat -> Gateway -> provider -> agent -> file/edit/exec -> test/oracle` 链路是否能继续完成任务；文档用于约束宣传边界和记录证据，不应自动变成强制重写代码的理由。

处理顺序：

1. 先保护核心可运行链路：能启动、能发起模型调用、能让 agent 修改文件、能执行测试、能由独立 oracle 验证结果。
2. 再拆分问题类型：阻断核心执行、仅影响观测/报告、文档漂移、默认开关未启用、高级能力未产品化。
3. 对文档与运行态不一致的部分，优先记录 drift、降级声明、补最小验证；只有阻断核心链路或用户路径时才进入代码修复。
4. 全量测试暴露的问题不能自动扩大为当前任务范围；单元测试通过也不能替代真实运行证据。
5. 大范围架构对齐必须另开聚焦 spec、回滚路径和足够的验证门槛，不能借“修假阳性”直接重构。

## 0.2 P0-00 当前架构漂移登记

证据锚点：`artifacts/real-runtime-validation/run-20260704-133326/real-runtime-validation-standard-report.json` 记录 coreExecution 3/3 pass，trace/history/graph 为 observation fail；最新补充 run `artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-standard-report.json` 在补齐 `openclaw_runtime/dist/entry.js` 后记录 coreExecution 3/3 pass、trace 3/3 pass(totalTraceItems=9)、graph 3/3 pass、history 3/3 pass，其中 Round 1 history 通过 session transcript artifact recovery 从 `.jsonl.reset.*` 恢复。本报告 P0-14/P0-17 已补自动化或正式入口证据；P0-15/P0-16 的 provider/default/main/transcript/trajectory 模型一致性已经通过最新 collector 证据收口。当前处理分类如下：

| 分类 | 当前条目 | 处理策略 |
|---|---|---|
| `core-blocking` | P0-15、P0-16、P0-17 | 影响 provider/default/main agent 模型一致性和可修复入口；最新真实复跑已证明主链路能用 flash 完成 repair，P0-15/P0-16 已把 provider/home runtime/source runtime default、main agent、transcript 和 trajectory 证据收口到 `deepseek-v4-flash`。 |
| `observation-only` | P0-06、P0-07、P0-08、P0-09、P0-10 | 影响 trace/history/graph/report 证据解释，不反向否定 agent 已完成真实 repair；最新真实复跑已补 trace/graph/history 运行证据，Round 1 直接 `chat.history` startup 错误由本地 transcript artifact recovery 收口。 |
| `docs-drift` | P0-00、P0-01、P0-02、P0-03、P0-05、P0-14 | 用矩阵、机器可读状态表、claim gate 和 harness boundary gate 防止文档或规则漂移；不要求运行代码强行贴合旧知识库描述。 |
| `advanced-feature` | P0-11、P0-12、P0-13（均为 bounded DONE） | Plan no-diff、真实写入挑战和统一权限审计属于更深的权限产品化/审计面；当前已补用户文件 diff/系统元数据分离、Plan 模式 focused write/edit/exec challenge、以及 Workspace/Role wired producers 的规范化事件证据，但仍不宣传严格 no-diff 或 exhaustive audit。 |

当前结论：核心 `Chat/Gateway/provider/agent/file/test` 链路已经在 `run-20260705-025439` 重新跑通；P0-15/P0-16 的模型配置和 transcript/trajectory 证据已经收口；P0-08/P0-10 已把 history startup 观测误判改为 transcript artifact recovery 证据，不再作为下一项阻断修复。P0-06/P0-09 的观测运行证据已更新，P0-12/P0-13 已按 bounded scope 补证完成，但仍不作为“严格 no-diff”或“全权限审计产品”的宣传依据。

## 1. 判定口径

| 标签 | 含义 | 能否对外宣传 |
|---|---|---|
| `TP-RUN` 真阳性-运行证实 | 已在真实 Electron/Gateway/provider/agent 链路中跑通。 | 可以，但要写明运行边界。 |
| `TP-TEST` 真阳性-测试证实 | 源码存在，且单元测试或 E2E 局部通过。 | 可以，但不能替代真实端到端。 |
| `TP-SRC` 真阳性-源码证实 | 源码路径清晰，调用链合理，但未真实运行验证。 | 可以作为“底层存在”。 |
| `PARTIAL` 半真阳性 | A/B 成立，但 C/D 不成立；用户当前只能触达一部分。 | 必须写清缺口。 |
| `FP-OVERCLAIM` 假阳性-过度声称 | 如果说成完整能力，就是假的；通常是把底层雏形说成产品能力。 | 不能这样宣传。 |
| `FP-NOT-RUNNABLE` 假阳性-当前不可运行 | 代码或概念存在，但当前运行验证失败或 UI/API 触达失败。 | 只能写“存在但本次不可用”。 |

补充判定规则：

- `RUN-FIRST` 不是新的矩阵分类标签，而是所有分类前的处理原则：先判断问题是否阻断核心执行链路，再决定是代码修复、观测修复、文档降级还是漂移登记。
- `TP-SRC` 和 `TP-TEST` 不能升级成 `TP-RUN`，除非真实 Electron/Gateway/provider/agent 链路跑通并留下 run-id、artifact 和 oracle 结果。
- `FP-OVERCLAIM` 不等于“必须立刻把代码补成宣传口径”；优先把宣传降级到真实边界，再评估是否需要补用户路径。
- `FP-NOT-RUNNABLE` 必须区分“核心任务不可运行”和“观测/查询/UI 证据不可运行”。后者不能反向否定 agent 已完成的真实工作。

## 2. 本次真实运行覆盖

最新真实运行报告确认：

- run-id 为 `run-20260705-025439`。
- `pnpm run build:vite` 通过；首次 Gateway 不 ready 的直接断点是 `openclaw_runtime/dist/entry.js` 缺失，执行 `pnpm run build:runtime` 后 Gateway 使用 compiled runtime entry 并 ready。
- `pnpm run provider:deepseek:configure` 通过，命令输出不包含密钥。
- `single-turn-smoke-after-fix-result.json` 记录 `appStarted=true`、Gateway running/ready、`chat.send` 成功，assistant 消息从 0 增至 1。
- `real-runtime-validation-result.json` 记录 provider selected account model 为 `deepseek/deepseek-v4-flash`，main agent `modelRef=deepseek/deepseek-v4-flash`。
- 三轮 repair 均把 `src/math.js` 中 `subtract` 从 `a + b` 改为 `a - b`。
- 三轮独立 oracle 均输出 `math tests passed`。
- 标准报告记录 coreExecution 3/3 pass、trace 3/3 pass(totalTraceItems=9)、graph 3/3 pass、history 3/3 pass。

真实运行同时确认的剩余边界：

- Round 1 即时 `chat.history` 曾在 Gateway startup 窗口不可用；标准报告现在从当前 run 的 session transcript artifact 恢复 history 可读证据，`evidenceIntegrity.historyRecovery.status=recovered-session-transcript-artifacts`、`recoveredRounds=1`。这证明“可从本地 transcript 兜底读到历史”，但不应宣传为“直接 `chat.history` startup RPC 永不失败”。
- Plan 模式三轮均创建 `.verse-claw/` 元数据；标准报告继续把用户文件 diff 与系统元数据 diff 分开，不宣传严格 no-diff。
- 最新 `model-consistency-evidence.json` 显示 provider default account、source runtime default、main agent 与 deepseek models 均为 `deepseek/deepseek-v4-flash`，`relevantSessionArtifactCount=4`，4 个当前 run transcript/trajectory artifact 均只记录 `deepseek/deepseek-v4-flash`，`observedModelRefs=["deepseek/deepseek-v4-flash"]`，`unexpectedDeepseekRefs=[]`，`pass=true`；P0-15/P0-16 的模型一致性已验收通过。

## 3. 真阳性清单

### 3.1 已真实跑通的真阳性

| 能力 | 结论 | 证据 |
|---|---|---|
| Electron 启动真实 App | 真阳性 | `real-runtime-task-validation-2026-07-04.md` 记录 `app.started=true`。 |
| Gateway ready 并处理 `chat.send` | 真阳性 | `run-20260705-025439` 中 smoke 成功；补齐 `openclaw_runtime/dist/entry.js` 后 Gateway ready。 |
| DeepSeek flash 真实调用 | 真阳性 | `run-20260705-025439` 中 provider selected account、runtime default、main agent `modelRef`、当前 run transcript/trajectory 相关模型引用均为 `deepseek/deepseek-v4-flash`。 |
| agent 修改文件 | 真阳性 | 3/3 修改 `src/math.js`。 |
| agent 执行测试 | 真阳性 | transcript 显示 `exec node test/run-tests.mjs`。 |
| 独立 oracle 验证 | 真阳性 | 3/3 `math tests passed`。 |
| Observability trace 查询 | 真阳性 | `run-20260705-025439` 标准报告 trace 3/3 pass，totalTraceItems=9。 |
| Execution Graph 可见 | 真阳性 + 部分能力 | `run-20260705-025439` 标准报告 graph 3/3 pass；但这只证明执行图可见，不等于完整审计产品化。 |

### 3.2 源码与测试支撑的真阳性

| 能力 | 结论 | 证据 |
|---|---|---|
| Workspace permission 拦截 | 真阳性 | `tests/unit/workspace-permissions.test.ts` 通过，源码在 `electron/services/workspace-permissions.ts`。 |
| Role permission 工具 allow/deny | 真阳性 | `tests/unit/role-orchestration-methods.test.ts` 通过，源码在 `role-spawn.ts`、`role-permissions-policy.ts`。 |
| Memory proposal/review/context pack | 真阳性 | `memory-api`、`runtime-memory-store`、`role-memory-context-provider` 单元测试通过；`role-memory-panel` E2E 通过。 |
| Compaction artifact 结构 | 真阳性 | `tests/unit/compression-artifact.test.ts` 通过。 |
| Task Loop checkpoint/repair 单元路径 | 真阳性 | `tests/unit/task-loop-controller.test.ts` 通过。 |
| Routing Memo 评分雏形 | 真阳性 | `tests/unit/routing-memo.test.ts` 通过；但默认 off。 |

## 4. 假阳性与半真阳性清单

| 被宣传的说法 | 真实判定 | 为什么 |
|---|---|---|
| Chat plan 可拖拽编辑任务 DAG | `FP-OVERCLAIM` | Chat Plan 现在有轻量 reorder/disable/note/regenerate/save/cancel edit draft，并把 `projectionEdit` 写入 Task Ledger metadata；但没有拖拽 edge editor 或完整 DAG 编辑器。 |
| 普通 Chat 自动进入完整 Plan 状态机 | `FP-OVERCLAIM` | 普通 Chat 走 `chat.send`；Plan permission 是权限模式，不是独立可编辑 plan 状态机。 |
| 普通 Chat 自动升级 Task Loop | `FP-OVERCLAIM` | Task Loop 需要显式路径或 `/loop` root；普通 Chat 不自动拥有 checkpoint/evidence gate。 |
| 任意任务失败自动全量回滚 | `FP-OVERCLAIM` | 有 rollback plan/checkpoint/replay 代码，但没有全局文件事务快照。 |
| checkpoint 保存完整上下文和文件快照 | `FP-OVERCLAIM` | 保存恢复摘要，不保存完整工具历史或文件系统快照。 |
| 动态角色自动淘汰/学习 | `PARTIAL` | Routing Memo 现在有 shadow dashboard 和 active authority gate；默认仍 off/shadow，只有 scorecard-backed quality 才能影响 routing，不能宣传默认学习。 |
| 普通 `team_orchestrate` 有完整质量评分 | `PARTIAL/FP-OVERCLAIM` | 普通编排在有 evidence 时会返回 shadow `qualityScorecard`，未评估时仍为 `qualityState=null`；active routing 和 repair/blocked/checkpoint 语义仍只在明确 gate 或 Task Loop 中成立。 |
| Observability trace 在真实任务中完全不可查 | 已由最新 run 修正为 `TP-RUN` | `run-20260705-025439` 标准报告 trace 3/3 pass；旧 run 的 `traceItems=0` 只能作为历史失败边界，不能继续当作当前结论。 |
| Execution Graph 可作为完整审计链路 | `TP-RUN + PARTIAL` | 最新真实运行 graph 3/3 pass，历史 `read/edit/exec/toolResult/final assistant` 的 UI 路径也有 unit/E2E 证据；但 graph 可见仍不等于完整审计链路。 |
| provider/default/main agent 已是 flash 就代表 transcript/trajectory 全部闭环 | 已由最新 collector 修正为 `TP-RUN` | `model-consistency-evidence.json` 已命中 4 个当前 run transcript/trajectory artifact，且只观察到 `deepseek/deepseek-v4-flash`；旧失败来自路径转义、`.jsonl.reset.*` 未纳入和 trajectory 嵌套历史误扫。 |
| `chat.history` startup/reconnect 已完全稳定 | `TP-RUN + PARTIAL` | P0-08 已有 bounded wait、transcript fallback、startup retry 和 E2E simulation 证据；最新真实三轮标准报告 history 3/3 pass，其中 Round 1 通过 session transcript artifact recovery 收口。可宣传“startup 窗口有 transcript 兜底证据”，不能宣传“直接 `chat.history` startup RPC 永不失败”。 |
| Plan 模式已有 focused write/edit/exec challenge | `TP-TEST + PARTIAL` | `workspace-permissions` 对 plan 模式的 command/file/Gateway 修改请求有单元级拒绝证据，`tests/e2e/chat-plan-mode-write-challenge.spec.ts` 覆盖 terminal、file write、mutating Gateway RPC 三类挑战；仍不能宣传覆盖所有 agent 写入路径或严格 no-diff。 |
| Workspace permission 与 Role permission 已有统一审计事件 | `TP-TEST + PARTIAL` | Workspace permission、approval 和 Role denylist/allowlist 的 wired producers 已输出规范化 `PermissionDecisionEvent(workspaceMode, role, tool, boundary, decision, reason, requestId)`；仍不能宣传 exhaustive permission audit。 |
| 全链路敏感信息绝不落明文 | `FP-OVERCLAIM` | Observability/Memory 有局部防护；transcript 有本地 redaction policy；code-review diff prompt 与 compaction artifact/projection 有 fake-key 投影脱敏证据；但 raw 文件/diff、配置关闭的 transcript、provider payload、模型回显不保证。 |

### 4.1 假阳性处理口径

发现假阳性时，默认先修“判断与表达”，再决定是否修代码：

1. 降级声明：把“完整能力”改成 `TP-SRC`、`TP-TEST`、`PARTIAL` 或 `FP-*` 对应的真实边界。
2. 登记漂移：当知识库/架构说明与当前运行态不一致，记录 drift、影响范围和兼容路径，不直接按旧文档强推代码对齐。
3. 最小补证：优先补能证明系统仍可跑通的真实运行、E2E 或 oracle；观测失败要单独记录，不能混成核心执行失败。
4. 聚焦修复：只有阻断 `Chat/Gateway/provider/agent/file/test` 主链路、阻断明确用户路径，或反复造成误判的项目，才进入 P0 代码修复候选。

### 4.2 敏感内容边界矩阵

本节收口 P1-14，并给 P1-10 提供最小本地策略验证。核心结论仍是：**不能宣传全链路敏感信息零明文**。当前只证明 transcript redaction helper 对假 key 形态有本地策略效果，且 `logging.redactSensitive=off` 时 transcript 仍可能保留明文；这不是“假密钥进入真实 chat 后端到端必定脱敏”的运行证据。

机器可读矩阵：`shared/sensitive-content-boundary.ts`
验证测试：`tests/unit/sensitive-content-boundary.test.ts`

| Surface | 当前可宣传边界 | 不可宣传/剩余风险 | 关联任务 |
|---|---|---|---|
| `file` | workspace 文件和 patch 是原始用户/项目工件，允许保留精确内容；code-review runtime prompt 使用 redacted diff projection。 | 不保证 raw file/diff/copy-patch UI 无明文；P1-11 只覆盖 code-review prompt 投影。 | P1-11、P1-14 |
| `transcript` | `redactTranscriptMessage` 已在 session transcript append/write 路径前调用；单元测试验证 fake key 形态会被本地策略遮蔽。 | 不是真实 chat 注入 E2E；配置关闭或未覆盖 payload 形态时 raw transcript 仍可能有明文。 | P1-10、P1-14 |
| `trace` | Observability persistence 保存 redacted summary/hash/length/sanitized attributes 等投影。 | trace 投影脱敏不证明 transcript、文件或 provider payload 原始面无明文。 | P1-11、P1-14 |
| `memory` | gatekeeper/review 路径有 secret-like proposal reject/sanitize 证据；`memory.propose` Gateway handler 会拒绝 fake key，并且返回/列表 proposal feedback 不回显完整假 key。 | 当前是 Gateway handler + SQLite feedback 级验证，不是完整 Electron UI 或 WebSocket E2E。 | P1-13、P1-14 |
| `compaction` | compaction artifact、rendered summary、recovery projection 会对 fake key 形态做投影脱敏。 | 这是 deterministic artifact/projection 证据，不证明 provider-generated summary 或 model echo 全局无明文。 | P1-12、P1-14 |
| `modelEcho` | assistant/model output 应按生成文本处理，可能复述用户输入。 | 无系统级模型回显无明文保证；用户不应把真实密钥提交给模型。 | P1-10、P1-14 |

## 5. 44 项逐项对比矩阵

| # | 问题 | 真实判定 | 分类 | 运行/可用边界 |
|---:|---|---|---|---|
| 1 | 用户输入后是否进入明确 Plan 状态机？ | 普通 Chat 输入进入 `chat.send` 主链路；Plan/readOnly 是权限模式，不是完整可编辑 Plan 状态机。 | `PARTIAL` | 主链路能跑；独立 Plan 状态机不能宣传。 |
| 2 | 是否自动拆解并分配多角色？ | 只有走 orchestrator、`team_orchestrate` 或 Task Loop 时才拆解；普通 Chat 不强制。 | `PARTIAL` | 代码可用；不是默认自动行为。 |
| 3 | Workspace 是否自动创建项目、装依赖并执行？ | Workspace/terminal/file gate 存在；“自动完整建项目装依赖”不是统一产品流。 | `PARTIAL` | 工具可做，产品流不能宣传为自动。 |
| 4 | Trace / 事件图是否存在？ | 类型、recorder、UI 代码存在；`run-20260705-025439` 真实任务 trace 3/3 pass，totalTraceItems=9。 | `TP-RUN + PARTIAL` | trace 查询当前可用；完整审计展示仍要与 graph/history 边界分开写。 |
| 5 | 工作面板是否展示计划/执行图并随状态更新？ | ExecutionGraph/plan view 存在；历史 `read/edit/exec/toolResult/final assistant` 已有 E2E 证据；`run-20260705-025439` graph 3/3 pass；Chat plan 支持轻量 edit draft。 | `TP-RUN + PARTIAL` | 可展示部分执行状态，不能等同完整任务面板、完整审计产品或完整 DAG 编辑器。 |
| 6 | 完成后是否回写 final assistant 和完成态？ | 真实任务 coreExecution 3/3 pass；最新标准报告 history 3/3 pass，Round 1 通过 `.jsonl.reset.*` transcript artifact 恢复可读证据。 | `TP-RUN + PARTIAL` | agent 完成真实；history 有本地 transcript 兜底证据，但直接 startup `chat.history` RPC 仍不能宣传为永不失败。 |
| 7 | 是否有可拖拽编辑的 Chat 任务 DAG？ | 没有完整 Chat DAG/edge editor；Chat Plan 只有轻量 reorder/disable/note/regenerate/save/cancel controls。 | `PARTIAL/FP-OVERCLAIM` | 可以说轻量 plan edits，不能说可拖拽 DAG 编辑已实现。 |
| 8 | 确认 plan 后是否持久化可恢复？ | Task Loop checkpoint 可持久化；普通 orchestration plan edit draft 可把 `projectionEdit` 写入 Task Ledger metadata，但不是完整 DAG 持久化。 | `PARTIAL` | 长任务可以；普通 Chat plan 只能宣传 bounded projection/edit metadata。 |
| 9 | Plan 阶段是否支持结构化 diff/增量编辑？ | 长任务 intervention 有 guide/queue/revise；Chat plan 有轻量 reorder/disable/note/edit draft，但没有结构化 diff 或 edge 编辑器。 | `PARTIAL` | 长任务和轻量 plan edits 局部成立；完整 plan diff 编辑器不能宣传。 |
| 10 | 内置角色及职责是否真实存在？ | planner/architect/implementer/tester/reviewer/security/docs/skeptic 等真实存在。 | `TP-SRC/TP-TEST` | 可以宣传“内置角色存在”。 |
| 11 | 是否会根据表现动态淘汰/学习角色？ | Routing Memo 有 shadow dashboard 和 active gate；默认 off/shadow，只有 scorecard-backed quality state 才能进入 active authority。 | `PARTIAL` | 不能宣传默认学习或自动淘汰。 |
| 12 | 子代理是否隔离上下文并避免全量泄漏？ | isolated/fork、role context、memory context 存在；最小上下文不能全局保证。 | `PARTIAL` | 有隔离机制，不能宣传绝对最小泄漏。 |
| 13 | 角色级工具权限是否真实拦截？ | 工具级 allow/deny 真实存在且有测试；Workspace/Role wired producers 有规范化 `PermissionDecisionEvent`；命令参数级和 exhaustive audit 仍不足。 | `TP-TEST + PARTIAL` | 可宣传工具级和 wired audit events，不可宣传语义级全权限系统。 |
| 14 | 用户自定义/临时角色是否存在？ | 配置角色和 origin badge 存在；完整角色管理器、自动临时角色未证实。 | `PARTIAL` | 配置级可用，产品级角色管理不足。 |
| 15 | worker 输出是否有质量评分并反馈路由？ | Task Loop 有 evidence/self-check；普通 `team_orchestrate` 在有 evidence 时返回 shadow quality scorecard，但默认不影响 routing。 | `PARTIAL/FP-OVERCLAIM` | 不能把 Task Loop 质量闭环或 active routing authority 套到普通编排。 |
| 16 | Electron 是否启动并管理 Gateway？ | 真实运行证实 App 启动 Gateway ready。 | `TP-RUN` | 可以宣传。 |
| 17 | 退出时是否清理 Gateway/扩展/连接？ | 源码有 best-effort teardown/stop/kill。 | `TP-SRC` | 未做崩溃级 E2E，只能说 best-effort。 |
| 18 | 是否避免 Workspace/Runtime 循环依赖？ | Gateway/host API 是主边界，subagent 有 depth/children 限制；没有形式化证明。 | `PARTIAL` | 架构上有边界，不能宣传绝对无循环。 |
| 19 | 通信是否为异步 JSON-RPC 并有 timeout？ | Gateway manager 有 pending/timeout；真实 smoke ACK 成功。 | `TP-RUN` | 可以宣传异步 RPC/timeout。 |
| 20 | Observability 失败是否影响任务执行？ | 旧 run trace 缺失但 repair 仍 3/3 成功；最新 run trace/graph/history 均 pass，Round 1 direct history 错误由 transcript artifact recovery 收口，始终不阻塞 coreExecution。 | `TP-RUN` | 可以说观测失败不阻塞核心任务；history 可读有 transcript 兜底证据，但不能宣传 direct startup `chat.history` RPC 永不失败。 |
| 21 | 任务失败是否自动全量回滚？ | 没有全局自动文件事务回滚。 | `FP-OVERCLAIM` | 只能说有辅助 rollback/checkpoint/replay。 |
| 22 | 是否有全局幂等策略？ | chat/checkpoint/intervention 有局部幂等；文件/命令无全局幂等。 | `PARTIAL` | 不能宣传全局幂等框架。 |
| 23 | 长任务运行中是否支持用户干预？ | long-task input mode 支持 guide/queue/interrupt/revise-goal。 | `TP-SRC/TP-TEST` | Task Loop/long task 下成立。 |
| 24 | checkpoint 是否保存完整上下文和文件快照？ | 不保存完整上下文、完整工具历史或文件快照。 | `FP-OVERCLAIM` | 正确说法是“恢复摘要/恢复锚点”。 |
| 25 | approval 无反馈时是否自动通过？ | 未见自动通过；更像 pending/TTL/block。 | `TP-SRC` | 需要真实 UI 场景补证。 |
| 26 | 是否有统一重试和降级？ | 模型 fallback、Gateway reconnect、web timeout 等局部存在；无全局策略。 | `PARTIAL` | 不能宣传全系统统一重试。 |
| 27 | token/timeout/tool 次数是否有统一上限与新会话建议？ | token/timeout 有机制；工具次数和新会话建议未形成统一产品闭环。 | `PARTIAL` | 预算机制存在，用户建议不足。 |
| 28 | 上下文压力阈值是否真实存在？ | compression planner/context pruning 阈值存在。 | `TP-SRC/TP-TEST` | 可以宣传底层阈值。 |
| 29 | 压缩时哪些内容优先保留/牺牲？ | recent turns、identifiers、rules 等有保护；旧工具/低优先内容更可能裁剪。 | `TP-SRC` | 不能宣传无损。 |
| 30 | compaction 能否保证不偏离？ | 有防护、质量检查和 retry；不能保证零偏离。 | `PARTIAL` | “有防护的有损摘要”，不是无损压缩。 |
| 31 | 用户是否能看见/确认压缩摘要并恢复？ | Chat 有 compact 状态/manual dialog；自动压缩逐次确认未证实。 | `PARTIAL` | 手动可见，自动确认不足。 |
| 32 | 多次压缩是否会摘要再摘要？ | 有 previous summary re-distill/identifier audit；无无损保证或次数硬上限。 | `PARTIAL` | 能处理，但不能保证不累积损失。 |
| 33 | Memory 是否有置信度、冲突与覆盖策略？ | gatekeeper/conflict/review 真实存在。 | `TP-TEST` | 可以宣传 proposal/review，不可宣传自动覆盖。 |
| 34 | retention 是否评分？ | memory-policy 有 keep/cold/archive/tombstone/review 评分。 | `TP-SRC/TP-TEST` | 可以宣传底层 retention scoring。 |
| 35 | 跨会话经验迁移是否可用？ | Memory store/context pack 支撑跨会话；Routing Memo 默认 off。 | `PARTIAL` | Memory 可说部分产品化；学习路由不能混写。 |
| 36 | 是否每次任务结束都自动总结入库？ | proposal source 包含 session_summary/trace；但自动路径 proposal-first，不自动激活写入。 | `PARTIAL` | 不能宣传每次任务自动长期记忆。 |
| 37 | 用户编辑某个任务时是否有事务回滚？ | 普通 Chat plan 没有任务编辑事务模型。 | `FP-OVERCLAIM` | 不能宣传任务编辑事务回滚。 |
| 38 | 执行图/Trace 是否可折叠、过滤和检索？ | Execution Graph 历史折叠/展开 UI 路径已有 E2E 证据；Trace query 最新真实运行 trace 3/3 pass、totalTraceItems=9。 | `TP-RUN + PARTIAL` | 可宣传 trace/graph 可见可查；但过滤、检索和逐 span 审计语义仍不是完整产品化审计工作台。 |
| 39 | UI 是否按用户能力自动切换简化/高级视图？ | 有不同深度入口；未见按用户能力自动切换策略。 | `PARTIAL` | 不能宣传自适应用户能力。 |
| 40 | Observability 和 Memory 是否有敏感内容防护？ | Observability redaction、transcript 本地 redaction policy、`memory.propose` Gateway fake-key reject/redacted feedback、code-review diff prompt redaction、compaction artifact/projection redaction 存在局部证据，并有 P1 provider-free integration smoke。 | `TP-TEST` | 可宣传局部防护和边界矩阵；不能宣传全链路安全。 |
| 41 | 是否能保证 transcript、文件、模型回显全链路无明文？ | 不能保证；file、transcript、trace、memory、compaction、model echo 的保证级别不同。 | `FP-OVERCLAIM` | raw file/diff/copy-patch UI、配置关闭的 raw transcript、provider payload、模型回显仍可能有明文。 |
| 42 | 低置信度是否自动暂停并请求确认？ | Memory/Task Loop/orchestration 有局部信号；普通 Chat 无统一阈值状态机。 | `PARTIAL/FP-OVERCLAIM` | 不能宣传全局低置信度自动暂停。 |
| 43 | 是否有统一的计划自审/反方角色？ | reviewer/security/skeptic 和 Task Loop self-check 存在；普通 Chat 不强制。 | `PARTIAL` | 角色存在，统一强制自审不成立。 |
| 44 | 失败后是否自动 repair / blocked？ | Task Loop 有 repair/blocked；普通 orchestration/team path 现在只产出 `orchestrationDiagnostics`，不返回 repair/blocked/checkpoint 字段。 | `PARTIAL` | Task Loop 下可说，普通 Chat 和普通编排不能套用。 |

## 6. 按产品事实重新分组

### A. 可以作为“已跑通核心链路”宣传

1. Electron 启动真实 App。
2. Gateway ready 后能处理 `chat.send`。
3. DeepSeek `deepseek-v4-flash` 真实参与模型调用。
4. Agent 能读文件、编辑文件、执行命令。
5. Agent 能修复 JS bug，独立 Node oracle 通过。

### B. 可以作为“底层能力真实存在”宣传

1. Workspace permission。
2. Role permission。
3. Task Loop checkpoint/evidence/repair 的源码与单元测试路径。
4. Memory gatekeeper/proposal/context pack。
5. Compaction safeguard/quality artifact。
6. Routing Memo shadow dashboard 与 ordinary orchestration shadow quality scorecard。
7. Observability redaction。

### C. 必须降级为“部分产品化”

1. Execution Graph。
2. Memory 用户管理。
3. Compaction 用户感知。
4. 用户自定义角色。
5. 跨会话经验迁移。
6. 并发多角色编排。
7. Task failure repair。

### D. 不能再当成已实现能力宣传

1. Chat 完整可编辑/可拖拽 DAG。
2. 普通 Chat 自动 Task Loop。
3. 任意失败自动全量回滚。
4. 全链路敏感信息零明文。
5. checkpoint 完整快照。
6. 动态角色自动淘汰。
7. 普通 `team_orchestrate` 完整或 active 质量评分。
8. 全局低置信度自动暂停确认。

## 7. 最终一句话版本

**这套系统不是“跑不起来的拼装品”：核心 App/Gateway/agent/tool/workspace 链路已经真实跑通。**
但它也不是“所有高级能力都已经产品化”：很多能力只是源码存在、单元测试存在、局部 UI 存在，缺默认启用、缺完整观测、缺真实 E2E 或缺数据回写。当前最真实的状态是：**核心执行真阳性，高级自治能力半真阳性居多，少数宣传口径是假阳性。**

## 8. 长期修复任务清单

本节是后续长期维护的唯一任务清单入口。状态只能在完成真实开发与验证后更新，不能因为“已有源码”“看起来能做”“单测可能覆盖”就提前标记完成。

状态定义：

| 状态 | 含义 |
|---|---|
| `TODO` | 尚未开发或尚未开始修复。 |
| `IN_PROGRESS` | 已开始开发，但未完成验收。 |
| `VERIFY` | 已开发完成，等待测试、E2E 或真实运行验收。 |
| `DONE` | 已通过规定证据门槛，并在本节补充证据链接。 |
| `DEFER` | 明确不进入当前修复批次；必须写清楚不阻断核心链路的理由、已有证据和重新进入条件。 |
| `BLOCKED` | 连续验证受阻，必须写明阻塞原因和解除条件。 |

证据门槛：

| 证据等级 | 允许更新到 `DONE` 的条件 |
|---|---|
| 源码修复 | 必须列出 PR/diff 文件、核心调用链、边界说明。 |
| 单元测试 | 必须列出测试命令、测试文件、通过结果。 |
| E2E 验证 | 必须列出 Playwright/Electron 场景、截图或 trace。 |
| 真实运行验证 | 必须列出 run-id、artifact 路径、真实 workspace、oracle 结果。 |
| 文档更新 | 必须更新 claim matrix，明确哪些说法可宣传、哪些仍不可宣传。 |

当前优先级选择口径：

1. 先选会影响系统能否跑通的兼容性和配置漂移项。
2. 再选会把真实成功误判成失败的观测、history、report split 项。
3. 最后选高级自治能力的产品化补齐项；这些不能抢占核心链路修复优先级。

当前待选的高优先级组件如下，下一步建议从上往下选：

| 选择项 | 关联任务 | 当前判断 | 为什么优先 | 下一步边界 |
|---|---|---|---|---|
| A. 敏感内容边界矩阵 | P1-14，并关联 P1-10~P1-13 | `DONE`（P1-10/P1-11/P1-12/P1-13/P1-14 已完成，并补 P1 integration smoke） | “全链路敏感信息绝不落明文”是高风险假阳性，先文档化能立即降低误导 | 已补 file/transcript/trace/memory/compaction/model echo 边界表、transcript fake-key 本地策略测试、`memory.propose` Gateway handler fake-key reject/redacted feedback、code-review diff prompt redaction、compaction artifact/projection redaction，以及 provider-free P1 集成测试；仍不能宣传全链路零明文。 |
| B. 观测审计语义补强 | P0-06、P0-07、P0-09 | `DONE`，但完整审计仍是 partial | 防止把 graph visible 误宣传成完整审计产品 | 若用户选择，再补 trace item 详情、toolCallId/toolResult 可定位报告；不影响当前 repair 主链路。 |
| C. Plan 模式真实写入挑战 | P0-12 | `DONE`（bounded） | 已补权限信心，但仍不是严格 no-diff 或所有写入路径证明 | 已有 Electron E2E 覆盖 Plan 模式 terminal/file write/mutating Gateway RPC challenge；后续新增写入面仍需单独补证。 |
| D. 统一权限审计事件 | P0-13 | `DONE`（bounded） | 已补最小追溯面，但不是 exhaustive audit | 已接入 Workspace 与 Role wired producers 的 `PermissionDecisionEvent`；后续新增权限面按生产者增量接入，避免重构权限系统。 |

### 8.1 P0：先修证据链，防止假阳性继续扩散

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P0-00 | 建立“先跑通，再对齐”的当前架构漂移登记 | 知识库/文档与运行态不一致时，容易把修复变成强制重构，反而破坏核心链路 | 对全量测试暴露的问题先标记 `core-blocking` / `observation-only` / `docs-drift` / `advanced-feature`；核心 `Chat/Gateway/provider/agent/file/test` 链路可继续跑；只对阻断项进入代码修复 | DONE | 任务 ID: P0-00；状态变更: TODO -> DONE；开发变更文件: 本报告；漂移登记位置: 第 0.2 节；分类结果: P0-15/P0-16/P0-17 为 `core-blocking`，P0-06/P0-07/P0-08/P0-09/P0-10 为 `observation-only`，P0-00/P0-01/P0-02/P0-03/P0-05/P0-14 为 `docs-drift`，P0-11/P0-12/P0-13 为 `advanced-feature`；真实运行 run-id: `run-20260704-133326` 与 `run-20260705-025439`；最新验证证据: 标准报告 coreExecution 3/3 pass、trace 3/3 pass(totalTraceItems=9)、graph 3/3 pass、history 3/3 pass，model consistency pass；剩余边界: P0-15/P0-16 已收口模型一致性，P0-12/P0-13 不作为阻断主链路的代码重构入口；是否影响 44 项矩阵: 是，后续修复必须先按阻断等级分类，避免按旧知识库强行改代码。 |
| P0-01 | 建立能力声明准入矩阵 `Claim -> Evidence -> User Path -> Runtime Proof -> Known Exclusions` | 防止把“源码存在”写成“产品可用” | 新增或更新每个能力的 claim matrix；所有报告/README/产品文案引用该矩阵 | DONE | 任务 ID: P0-01；状态变更: TODO -> DONE；开发变更文件: `shared/capability-claims.ts`, `tests/unit/capability-claims.test.ts`, `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, 本报告及相关真实性报告；测试命令: `pnpm exec vitest run tests/unit/capability-claims.test.ts --reporter=verbose`；测试结果: 1 file / 3 tests passed；真实运行 run-id: N/A；剩余边界: P0-02 artifact 与 P0-03 gate 仍需补；是否影响 44 项矩阵: 是，44 项已有代码矩阵。 |
| P0-02 | 为 44 项能力建立机器可读状态表 | 手工文档容易漂移 | 生成 `artifacts/capability-claims/*.json` 或等价结构；每项含状态、证据等级、最后验证时间 | DONE | 任务 ID: P0-02；状态变更: TODO -> DONE；开发变更文件: `.gitignore`, `scripts/generate-capability-claims-artifacts.mjs`, `artifacts/capability-claims/status-table.json`, `tests/unit/capability-claims.test.ts`, README 三语种入口；生成命令: `node scripts/generate-capability-claims-artifacts.mjs`；测试命令: `pnpm exec vitest run tests/unit/capability-claims.test.ts --reporter=verbose`；测试结果: 1 file / 4 tests passed；真实运行 run-id: N/A；剩余边界: 后续由 P0-03 gate 防止文案漂移；是否影响 44 项矩阵: 是，44 项已生成机器可读状态表。 |
| P0-03 | 在 CI 或本地 gate 中检查高风险声明 | 防止假阳性回流 | 若文档出现“已实现/已产品化/稳定”但无 E2E/真实运行证据，gate 给出 warning 或 fail | DONE | 任务 ID: P0-03；状态变更: TODO -> DONE；开发变更文件: `scripts/check-capability-claims.mjs`, `tests/unit/capability-claims.test.ts`, README 三语种入口；测试命令: `pnpm exec vitest run tests/unit/capability-claims.test.ts --reporter=verbose`；测试结果: 1 file / 7 tests passed；本地 gate: `node scripts/check-capability-claims.mjs README.md README.zh-CN.md README.ja-JP.md reports/report-authenticity-true-false-positive-matrix-2026-07-04.md reports/report-authenticity-audit-2026-07-04.md reports/report-authenticity-followup-plan-2026-07-04.md reports/report-authenticity-followup-qa-sources-2026-07-04.md reports/real-runtime-task-validation-2026-07-04.md` -> 0 findings；真实运行 run-id: N/A；剩余边界: 尚未接入 CI；是否影响 44 项矩阵: 是，防止高风险文案绕过矩阵。 |
| P0-04 | 固定真实运行验收脚本版本 | 避免后续无法复现本次结论 | `real-runtime-validation.mjs` 可重复运行，并输出 run-id、provider、workspace、diff、oracle、trace/history 结果 | DONE | 任务 ID: P0-04；状态变更: VERIFY -> DONE；开发变更文件: `scripts/real-runtime-validation.mjs`, `tests/unit/real-runtime-validation-report.test.ts`；测试命令: `pnpm exec vitest run tests/unit/real-runtime-validation-report.test.ts --reporter=verbose`；测试结果: 1 file / 5 tests passed；最新标准化命令: `node scripts/real-runtime-validation.mjs --from artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-result.json`；标准化输出: `artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-standard-report.json`；真实运行 run-id: `run-20260705-025439`；核心结果: coreExecution 3/3 pass, trace 3/3 pass, graph 3/3 pass, history 3/3 pass；新增证据: Round 1 history 从 `session-transcript-artifact` 恢复，`evidenceIntegrity.historyRecovery.recoveredRounds=1`；剩余边界: 标准报告可分离 core/trace/history/graph，但不负责证明 runtime default 模型不漂移，也不宣传直接 `chat.history` startup RPC 永不失败；是否影响 44 项矩阵: 是，真实运行证据口径固定。 |
| P0-05 | 为“代码存在但不可用”建立专门标签 | 避免文档语言模糊 | 报告中统一使用 `TP-RUN/TP-TEST/TP-SRC/PARTIAL/FP-OVERCLAIM/FP-NOT-RUNNABLE` | DONE | 本文档第 1 节已定义；后续新报告必须沿用 |

### 8.2 P0：修真实运行暴露的核心观测问题

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P0-06 | 修复 Observability `queryTraces` 查不到真实任务 trace | “Trace 存在且可查”曾是历史假阳性 | 三轮真实 repair 后按 `runId/sessionKey/workspace` 查询 `traceItems > 0` | DONE | 任务 ID: P0-06；状态变更: TODO -> DONE；开发变更文件: `electron/services/observability-api.ts`, `electron/services/observability-trajectory-index.ts`, `electron/services/observability-index.ts`, `tests/unit/observability-trajectory-index.test.ts`；核心调用链: `observability.queryTraces` -> `refreshTraceIndex` -> `refreshObservabilityTrajectoryIndex` -> `persistObservabilityTraceToIndex` -> `queryObservabilityTraces`；测试命令: `pnpm exec vitest run tests/unit/observability-trajectory-index.test.ts --reporter=verbose`；测试结果: 1 file / 4 tests passed；真实运行 run-id: `run-20260705-025439`；标准报告证据: trace 3/3 pass, totalTraceItems=9；剩余边界: trace 查询可用不等于完整审计产品化；是否影响 44 项矩阵: 是，#4 从历史 `FP-NOT-RUNNABLE` 更新为 `TP-RUN + PARTIAL`。 |
| P0-07 | 打通 runtime trajectory/transcript 到 App trace index 的映射 | Runtime 有 trajectory，但 App trace 查不到 | App UI/host API 能定位到同一 run 的 prompt、toolCall、toolResult、assistant final | DONE | 任务 ID: P0-07；状态变更: TODO -> DONE；开发变更文件: `electron/services/observability-api.ts`, `electron/services/observability-trajectory-index.ts`, `electron/services/observability-index.ts`, `tests/unit/observability-trajectory-index.test.ts`；核心调用链: session transcript/trajectory 文件 -> `buildTraceFromTrajectoryGroup` -> transcript spans(`User Prompt`/tool call/tool result/`Assistant Final`) -> App trace graph；测试命令: `pnpm exec vitest run tests/unit/observability-trajectory-index.test.ts --reporter=verbose`；测试结果: 1 file / 4 tests passed；真实运行 run-id: `run-20260705-025439`；标准报告证据: trace 3/3 pass, totalTraceItems=9；剩余边界: 最新标准报告证明 trace 可查，但未展开每个 span 的人工审计表；是否影响 44 项矩阵: 是，#4/#38 的 App trace index 映射已有真实运行证据，但完整审计语义仍保持 partial。 |
| P0-08 | 修复 `chat.history` 在 Gateway startup/reconnect 窗口不可用 | 任务已完成但 UI/history 误判失败 | Round 1 直接 `chat.history` startup 失败时，至少返回 last-known transcript 或可重试/可恢复证据 | DONE | 任务 ID: P0-08；状态变更: TODO -> DONE；开发变更文件: `src/stores/chat/history-actions.ts`, `src/stores/chat/history-startup-retry.ts`, `src/stores/chat/history-transcript-fallback.ts`, `src/stores/chat/history-transcript-hydrate.ts`, `src/stores/chat/session-label-hydration.ts`, `electron/gateway/rpc-backpressure.ts`, `electron/services/mcp-api.ts`, `scripts/real-runtime-validation.mjs`, `tests/unit/host-services.test.ts`, `tests/unit/history-startup-retry.test.ts`, `tests/unit/chat-store-history-retry.test.ts`, `tests/unit/chat-store-session-label-fetch.test.ts`, `tests/unit/gateway-rpc-backpressure.test.ts`, `tests/unit/session-label-fetch.test.ts`, `tests/unit/real-runtime-validation-report.test.ts`, `tests/e2e/chat-history-startup-retry.spec.ts`, `artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-standard-report.json`, 本报告；核心调用链: foreground `chat.history` bounded startup wait -> local `hostApi.sessions.history` transcript fallback -> startup retry keeps polling Gateway -> successful Gateway history hydrates/merges; sidebar labels use session summaries instead of `chat.history` fan-out; Main gateway RPC uses `GatewayRpcBackpressure` single-flight for `chat.history`; 标准报告在 direct `chat.history` startup 失败时读取当前 run 的 session transcript artifact，按 round workspace 精确匹配 `.jsonl.reset.*` turn，恢复 history 可读证据；测试命令: `pnpm exec vitest run tests/unit/real-runtime-validation-report.test.ts --reporter=verbose`, `node scripts/real-runtime-validation.mjs --from artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-result.json`；测试结果: real-runtime report unit 1 file / 5 tests passed，标准化命令 exit 0；真实运行 run-id: `run-20260705-025439`；验收结果: 标准报告 history 3/3 pass，Round 1 `history.evidence.source=session-transcript-artifact`，artifact 为 `...9e016988-f6a6-4f83-aea2-43f7e748503f.jsonl.reset.2026-07-04T20-01-42.610Z`，`relevantLineCount=24`；剩余边界: 直接 `chat.history` startup RPC 在旧 runner 中仍记录原始错误，不能宣传为永不失败；`pnpm harness validate --spec harness/specs/tasks/fix-chat-history-gateway-timeout.md` 因当前工作区大量既有脏文件/未跟踪文件触发 diff 覆盖检查失败，未作为 P0-08 行为失败处理；是否影响 44 项矩阵: 是，#6 即时 history 从 `TP-TEST + PARTIAL` 升级为带 transcript artifact recovery 的 `TP-RUN + PARTIAL`。 |
| P0-09 | Execution Graph 绑定 runtime `runId/toolCallId/toolResult` | UI 图有计数但不能审计完整链路 | 图中能定位 read/edit/exec/tool result/final assistant；E2E 覆盖 internal yield 与长历史折叠 | DONE | 任务 ID: P0-09；状态变更: TODO -> VERIFY -> DONE；开发变更文件: `src/pages/Chat/task-visualization.ts`, `src/stores/chat/helpers.ts`, `tests/unit/task-visualization.test.ts`, `tests/e2e/chat-run-state-events.spec.ts`, 本报告；核心调用链: `chat.history` raw `toolResult` -> `enrichWithTeamOrchestrationToolResults` 折叠到 assistant tool-call turn 的 `_toolResults` -> `deriveTaskSteps` 输出 read/edit/exec、`Tool Result:*` 和 `Assistant Final` -> `TurnSummaryCard` 展开后进入 `ExecutionGraphCard`；测试命令: `pnpm exec vitest run tests/unit/task-visualization.test.ts tests/unit/real-runtime-validation-report.test.ts --reporter=verbose`, `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "renders historical execution graph"`；测试结果: unit 2 files / 22 tests passed, E2E 1 test passed；真实运行 run-id: `run-20260705-025439`；标准报告证据: graph 3/3 pass, visibleRounds=3；剩余边界: graph 可见不等于完整审计产品化，后续若要逐 toolCallId 人工审计需另列增强项；是否影响 44 项矩阵: 是，#5 更新为 `TP-RUN + PARTIAL`。 |
| P0-10 | 真实运行报告自动生成“核心通过/观测失败”分离结论 | 避免把观测失败误判为 agent 不工作 | 报告区分 core execution pass、UI/history pass、trace pass、graph pass，并能在 direct history 失败但 transcript artifact 存在时恢复 history 证据 | DONE | 任务 ID: P0-10；状态变更: VERIFY -> DONE；开发变更文件: `scripts/real-runtime-validation.mjs`, `tests/unit/real-runtime-validation-report.test.ts`, `artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-standard-report.json`, 本报告；测试命令: `pnpm exec vitest run tests/unit/real-runtime-validation-report.test.ts --reporter=verbose`, `node scripts/real-runtime-validation.mjs --from artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-result.json`；测试结果: 1 file / 5 tests passed，标准化命令 exit 0；标准化结果: coreExecution 3/3 pass, trace 3/3 pass(totalTraceItems=9), history 3/3 pass, graph 3/3 pass；真实运行 run-id: `run-20260705-025439`；剩余边界: direct `chat.history` startup RPC 原始错误仍保留在 raw result/failures 与 recovery evidence 中，不能反向否定 core execution，也不能宣传为直接 RPC 永不失败；是否影响 44 项矩阵: 是，#20 和真实运行结论继续保持 core/observation 分离。 |

### 8.3 P0：修权限与 Plan 模式边界

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P0-11 | 明确 `.verse-claw/` 在 Plan 模式下的写入策略 | Plan no-diff 当前严格失败 | 要么 Plan 禁止写 `.verse-claw/`，要么验收报告把系统元数据和用户文件 diff 分开 | DONE | 任务 ID: P0-11；状态变更: TODO -> DONE；开发变更文件: 本报告；实现口径: 不强行禁止 `.verse-claw/` 系统元数据写入，而是在标准验收报告中把用户文件 diff 与系统元数据 diff 分开；证据文件: `scripts/real-runtime-validation.mjs`, `tests/unit/real-runtime-validation-report.test.ts`, `artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-standard-report.json`；测试命令: `pnpm exec vitest run tests/unit/real-runtime-validation-report.test.ts --reporter=verbose`；测试结果: 1 file / 5 tests passed；真实运行 run-id: `run-20260705-025439`；标准报告证据: 每轮 `changedUserFiles` 仅含 `M src/math.js`，`.verse-claw/` 被放入 `systemMetadataStatus`，并在 `knownObservationFailures` 中记录 `PLAN_SYSTEM_METADATA_DIFF`；剩余边界: Plan 模式仍会产生 `.verse-claw/` 元数据，因此不能宣传为严格 no-diff，只能宣传为用户文件 diff 与系统元数据 diff 已分离；是否影响 44 项矩阵: 是，Plan no-diff 从“严格失败”改为“系统元数据边界已显式记录”。 |
| P0-12 | 增加 Plan 模式真实文件写入挑战 E2E | 静态权限证明不等于真实 UI 拦截 | Electron E2E 中 Plan 模式尝试 write/edit/exec，确认拒绝或 approval-required | DONE | 任务 ID: P0-12；状态变更: DEFER -> DONE；开发变更文件: `tests/e2e/chat-plan-mode-write-challenge.spec.ts`, `electron/services/workspace-permissions.ts`, 本报告；核心调用链: Electron host invoke -> Workspace permission mode `plan` -> `decideWorkspaceCommand` / `decideWorkspaceFileWrite` / `decideGatewayRpc` -> terminal/file/Gateway mutating request denied before side effect；测试命令: `corepack pnpm exec vitest run tests/unit/workspace-permissions.test.ts tests/unit/terminal-api.test.ts tests/unit/files-permissions-api.test.ts tests/unit/gateway-permissions-api.test.ts --reporter=verbose`, `corepack pnpm run build:vite`, `corepack pnpm run test:e2e tests/e2e/chat-plan-mode-write-challenge.spec.ts`；测试结果: focused permission unit、build:vite、Plan mode write challenge E2E passed；真实运行 run-id: N/A，本项是 permission policy + Electron E2E challenge，不启动真实 provider agent；真实边界: 覆盖 terminal command、file write、mutating Gateway RPC 三类挑战和 no-side-effect 文件断言，不宣传覆盖所有 possible write surfaces 或严格 no-diff；剩余不宣称的能力: 不宣称 Plan 模式不会产生 `.verse-claw/` 系统元数据，不宣称 exhaustive no-diff；是否影响 44 项矩阵: 是，Plan 安全边界保持 `TP-TEST + PARTIAL`，但 P0-12 不再是 DEFER。 |
| P0-13 | 统一 Workspace permission 与 Role permission 审计事件 | 权限分散导致事后不可追溯 | 输出 `PermissionDecisionEvent`，含 workspaceMode、role、tool、boundary、decision、reason、requestId | DONE | 任务 ID: P0-13；状态变更: DEFER -> DONE；开发变更文件: `electron/services/permission-decision-audit.ts`, `electron/services/permissions-api.ts`, `electron/services/gateway-api.ts`, `electron/services/files-api.ts`, `electron/services/terminal-api.ts`, `openclaw_runtime/src/agents/role-permission-audit.ts`, `openclaw_runtime/src/agents/role-spawn.ts`, `shared/host-api/contract.ts`, `src/lib/host-api.ts`, `tests/unit/permission-decision-audit.test.ts`, `tests/unit/role-spawn.test.ts`, 本报告；核心调用链: Workspace command/file/Gateway permission decisions -> `createWorkspacePermissionDecisionEvent` -> bounded `permissions-api` storage / `permissions.decisionEvents`; Role spawn policy -> `buildRolePermissionDecisionEvents` -> role spawn context audit payload；测试命令: `corepack pnpm exec vitest run tests/unit/permission-decision-audit.test.ts tests/unit/workspace-permissions.test.ts tests/unit/role-spawn.test.ts --reporter=verbose`, `corepack pnpm run typecheck`；测试结果: focused audit/permission/role unit tests passed，typecheck passed；真实运行 run-id: N/A，本项是 host/runtime producer and contract evidence；真实边界: wired Workspace/Role producers emit normalized events, but not every permission surface has a producer；剩余不宣称的能力: 不宣称 exhaustive permission audit、centralized policy replacement 或 enterprise audit trail；是否影响 44 项矩阵: 是，#13 从“统一审计不足”更新为 wired audit events + remaining exhaustive audit boundary。 |
| P0-14 | 禁止 renderer 新增 direct IPC/direct Gateway fetch | 绕过 Main permission gate | lint/static check 覆盖新增 direct IPC/fetch；违反时报错 | DONE | 任务 ID: P0-14；状态变更: TODO -> DONE；开发变更文件: `harness/src/rules.mjs`, `tests/unit/harness-specs.test.ts`, `harness/specs/rules/backend-communication-boundary.md`, `harness/specs/scenarios/gateway-backend-communication.md`, 本报告；核心 gate: `scanBackendCommunicationBoundary` 在 harness run 中扫描 changed/touched `src/**`，阻止 renderer page/component 直接 `window.electron.ipcRenderer.invoke(...)`，阻止 `fetch('http://127.0.0.1:18789')` / `fetch('http://localhost:18789')` / `fetch('http://[::1]:18789')`，阻止 `new WebSocket('ws://127.0.0.1:18789')` / localhost / `[::1]` 直连 Gateway；测试命令: `pnpm exec vitest run tests/unit/harness-specs.test.ts --reporter=verbose`, `pnpm harness validate --spec harness/specs/scenarios/gateway-backend-communication.md --no-diff`；测试结果: harness specs 1 file / 13 tests passed，gateway scenario valid；真实运行 run-id: N/A，本项为静态新增违规 gate，不启动 Electron/Gateway；剩余边界: 未对当前巨大历史脏工作区执行全量 diff gate，避免把无关既有变更误判为本项失败；是否影响 44 项矩阵: 是，renderer/Main/Gateway 边界从 AGENTS 文档约束推进到 harness 自动化红线。 |

### 8.4 P0：修模型配置漂移

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P0-15 | 统一 DeepSeek/provider/defaults/main agent 模型权威源 | account 是 flash 但 agent/defaults 跑 pro 的漂移 | 重启 App、跑 smoke、跑 repair 后，provider/defaults/main/transcript/trajectory 全为 `deepseek-v4-flash` | DONE | 任务 ID: P0-15；状态变更: VERIFY -> DONE；开发变更文件: `electron/gateway/config-sync.ts`, `tests/unit/config-sync-source-runtime.test.ts`, `scripts/model-consistency-evidence.mjs`, `tests/unit/model-consistency-evidence.test.ts`, `artifacts/real-runtime-validation/run-20260705-025439/collect-model-consistency.mjs`, `artifacts/real-runtime-validation/run-20260705-025439/model-consistency-evidence.json`, 本报告；核心调用链: Gateway launch 前 `syncDefaultProviderRuntimeBeforeLaunch` 同步默认 provider -> source runtime isolation 复制已修正 runtime config -> collector 通过 `normalizeForSearch` 命中 JSON 转义路径和 `.jsonl.reset.*` transcript -> 只扫描当前 run 相关 turn -> trajectory 事件优先使用顶层 `provider/modelId`，避免旧嵌套历史 pro 污染；测试命令: `pnpm exec vitest run tests/unit/model-consistency-evidence.test.ts --reporter=verbose`, `node artifacts/real-runtime-validation/run-20260705-025439/collect-model-consistency.mjs`；测试结果: model consistency helper 1 file / 4 tests passed，collector exit 0；真实运行 run-id: `run-20260705-025439`；验收结果: provider default account、source runtime default、main agent、deepseek models、当前 run transcript/trajectory 相关模型引用均为 `deepseek/deepseek-v4-flash`，`relevantSessionArtifactCount=4`，`observedModelRefs=["deepseek/deepseek-v4-flash"]`，`unexpectedDeepseekRefs=[]`，`pass=true`；剩余边界: 不代表未来所有 provider 切换场景均已产品化，只证明本次 DeepSeek flash 默认模型漂移已收口；是否影响 44 项矩阵: 是，DeepSeek flash 主链路和模型权威源从 `PARTIAL` 升级为本次真实运行 `TP-RUN`。 |
| P0-16 | 修复 App 同步层回写旧 `agents.defaults.model.primary` | defaults 持久化不稳定 | 验收后 `agents.defaults.model.primary` 不再回到 `deepseek-v4-pro` | DONE | 任务 ID: P0-16；状态变更: VERIFY -> DONE；开发变更文件: `electron/utils/secure-storage.ts`, `electron/services/providers/provider-service.ts`, `electron/gateway/config-sync.ts`, `tests/unit/secure-storage-provider.test.ts`, `tests/unit/provider-service-stale-cleanup.test.ts`, `tests/unit/config-sync-source-runtime.test.ts`, `artifacts/real-runtime-validation/run-20260705-025439/model-consistency-evidence.json`, 本报告；核心调用链: provider account store -> `secure-storage.getProvider/getAllProviders` account-first -> `syncDefaultProviderToRuntime` 使用 account 模型写入 `agents.defaults.model.primary`，`ProviderService.listAccounts` 仅在缓存账号缺模型时从 runtime default seed，`prepareGatewayLaunchContext` 在 source runtime isolation 复制配置前执行 `syncDefaultProviderRuntimeBeforeLaunch`，把 home runtime 与 source-state runtime defaults/models 都收口到 account 模型；红测: legacy `providers.deepseek.model=deepseek-v4-pro` + account `deepseek/deepseek-v4-flash` 时 `getProvider('deepseek')` 曾返回 pro，修复后返回 flash；新增红测: source runtime launch config copy 前必须调用 `syncDefaultProviderToRuntime('deepseek')`；测试命令: `pnpm exec vitest run tests/unit/config-sync-source-runtime.test.ts tests/unit/provider-runtime-sync.test.ts tests/unit/provider-service-stale-cleanup.test.ts tests/unit/secure-storage-provider.test.ts --reporter=verbose`, `pnpm run build:vite`, `node artifacts/real-runtime-validation/run-20260705-025439/collect-model-consistency.mjs`, `node scripts/real-runtime-validation.mjs --from artifacts/real-runtime-validation/run-20260705-025439/real-runtime-validation-result.json`；测试结果: provider/config unit 4 files / 35 tests passed，build:vite exit 0，标准化命令 exit 0，model consistency collector exit 0；真实运行 run-id: `run-20260705-025439`；验收结果: App/Gateway 启动后的 runtime defaults 不再回到 `deepseek-v4-pro`，核心 repair 3/3 pass，模型一致性 `pass=true`；剩余边界: 不代表未来所有 provider 切换场景均已产品化；是否影响 44 项矩阵: 是，默认模型漂移从 `FP-NOT-RUNNABLE` 降为本次真实运行 `TP-RUN`。 |
| P0-17 | Provider 配置脚本纳入正式工具或 Doctor Fix | 手工脚本不可持续 | UI/Doctor/CLI 可安全配置 DeepSeek，且不输出密钥 | DONE | 任务 ID: P0-17；状态变更: TODO -> DONE；开发变更文件: `package.json`, `tests/unit/configure-deepseek-runtime.test.ts`, 本报告；正式入口: `pnpm run provider:deepseek:configure` -> `node scripts/configure-deepseek-runtime.mjs`；测试命令: `pnpm exec vitest run tests/unit/configure-deepseek-runtime.test.ts --reporter=verbose`；测试结果: 1 file / 2 tests passed；CLI 隔离实跑: 使用临时 `APPDATA` 和假 key 执行 `pnpm run provider:deepseek:configure`，exit 0，stdout/stderr 不含假 key，仅输出 `apiKeySource=environment-or-existing-script-input`，写入 defaultProviderAccountId=`deepseek`, provider account=`deepseek/deepseek-v4-flash`, runtime default=`deepseek/deepseek-v4-flash`, main agent=`deepseek/deepseek-v4-flash`；真实运行 run-id: N/A，本项验证 CLI/formal tool，不启动 Electron/Gateway/provider repair；剩余边界: 未把 Doctor Fix 改成自动切默认 DeepSeek，避免对非 DeepSeek 用户产生破坏性配置漂移；是否影响 44 项矩阵: 是，模型配置修复从“手工脚本”接入为可重复正式 CLI 工具。 |

### 8.5 P1：把半真阳性的高级能力接成真实用户路径

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P1-01 | Chat Plan -> Task Ledger 只读投影 | “Chat DAG”目前是假阳性 | Chat orchestration plan 能生成 Task Ledger node/edge projection，不可编辑也要可定位 | DONE | 任务 ID: P1-01；状态变更: TODO -> DONE；开发变更文件: `src/lib/task-ledger-plan-projection.ts`, `src/components/agents/RolesOrchestrationPanel.tsx`, `src/pages/TaskLedger/index.tsx`, `vite.config.ts`, `tests/unit/orchestration-plan-ledger-projection.test.ts`, `tests/unit/roles-orchestration-panel.test.tsx`, `tests/unit/vite-config-openclaw-runtime.test.ts`, `tests/e2e/task-ledger.spec.ts`, 本报告；核心调用链: `orchestrator.plan` 成功返回后，Roles 面板调用 `buildOrchestrationPlanLedgerEvents` 生成 append-only `goal/task/review/edge/session_linked` 事件，再通过现有 `hostApi.taskLedger.appendEvents` 写入当前 workspace；只读边界: 生成节点带 `metadata.readonlyProjection=true` 与 `source=orchestrator.plan`，Task Ledger 页面禁用该类节点状态修改和清 review 操作；启动接线修复: Electron main build 现在把本地 `@openclaw/normalization-core/*`、`@openclaw/acp-core/*` 源码包纳入 Vite resolve/bundle，并把 `json5` 作为 main runtime bundle dependency，避免 P1 E2E 启动时因 pnpm 传递依赖或 workspace alias externalization 出现 `Cannot find module`；测试命令: `pnpm exec vitest run --maxWorkers=1 --reporter=verbose tests/unit/orchestration-plan-ledger-projection.test.ts tests/unit/roles-orchestration-panel.test.tsx tests/unit/vite-config-openclaw-runtime.test.ts`, `pnpm run build:vite`, `pnpm exec playwright test tests/e2e/task-ledger.spec.ts --grep "shows task ledger page tabs and chat summary panel"`；测试结果: projection/panel/config unit 3 files / 5 tests passed；build:vite passed；Task Ledger focused E2E 1 test passed；真实运行 run-id: N/A，本项为 renderer helper + component 接线 + Task Ledger UI 只读禁用 + Electron P1 smoke 启动证明，不启动 provider；剩余边界: P1-01 本身是只读投影，P1-02 才提供轻量 reorder/disable/note edit draft；仍不支持用户改依赖或 edge editor；是否影响 44 项矩阵: 是，Chat plan 从“仅 UI 预览”升级为可定位的 Task Ledger 只读投影，且该投影 smoke 已能启动 Electron 验证。 |
| P1-02 | Chat Plan 轻量编辑 | Chat 不能编辑依赖 | 支持排序、禁用、备注、regenerate、保存/取消；不支持任意 edge editor | DONE | 任务 ID: P1-02；状态变更: TODO -> DONE；开发变更文件: `src/lib/orchestration-plan-edit-draft.ts`, `src/components/agents/OrchestrationPlanView.tsx`, `src/components/agents/RolesOrchestrationPanel.tsx`, `shared/i18n/locales/en/agents.json`, `shared/i18n/locales/zh/agents.json`, `shared/i18n/locales/ja/agents.json`, `shared/i18n/locales/ru/agents.json`, `tests/unit/orchestration-plan-edit-draft.test.ts`, `tests/unit/roles-orchestration-panel.test.tsx`, `tests/e2e/role-orchestration-plan-editing.spec.ts`, 本报告；核心调用链: `orchestrator.plan` output -> Roles panel edit draft state -> `buildOrchestrationPlanEditLedgerEvents` -> `hostApi.taskLedger.appendEvents` with `projectionEdit` metadata；测试命令: `corepack pnpm exec vitest run tests/unit/roles-orchestration-panel.test.tsx tests/unit/orchestration-plan-edit-draft.test.ts --reporter=verbose`, `corepack pnpm run i18n:lint`, `corepack pnpm run build:vite`, `corepack pnpm run test:e2e tests/e2e/role-orchestration-plan-editing.spec.ts`, `corepack pnpm run typecheck`；测试结果: focused unit passed，i18n lint passed，build:vite passed，E2E passed，typecheck passed；真实运行 run-id: N/A，本项是 renderer + Task Ledger host-api path + Electron UI evidence；真实边界: 只有 reorder/disable/note/regenerate/save/cancel 轻量控制，没有 add/remove edge、拖拽依赖或完整 DAG editor；剩余不宣称的能力: 不宣称 Chat Plan 是 full editable DAG 或图编辑器；是否影响 44 项矩阵: 是，#7/#8/#9 更新为 lightweight edit draft。 |
| P1-03 | 明确 Task Ledger 与 Workboard 数据关系 | 两套任务系统概念混乱 | 文档和代码中定义单向引用协议 | DONE | 任务 ID: P1-03；状态变更: TODO -> DONE；开发变更文件: `shared/types/task-ledger-reference.ts`, `shared/product-semantics.ts`, `openclaw_runtime/extensions/workboard/src/types.ts`, `tests/unit/task-ledger-reference.test.ts`, `tests/unit/product-semantics.test.ts`, `docs/clawx-product-semantics.md`, 本报告；核心调用链: Workboard/runtime/plugin scheduling state imports canonical `TaskLedgerReference` -> stores `taskLedgerNodeId`/source metadata one-way -> Task Ledger remains user-visible fact owner；测试命令: `corepack pnpm exec vitest run tests/unit/task-ledger-reference.test.ts tests/unit/product-semantics.test.ts --reporter=verbose`, `corepack pnpm run typecheck`；测试结果: focused unit passed，typecheck passed；真实运行 run-id: N/A，本项是 shared contract + Workboard type boundary evidence；真实边界: one-way reference only, no mirroring, no two-way sync, no shared scheduler/fact owner；剩余不宣称的能力: 不宣称 Task Ledger and Workboard are a unified two-way task system；是否影响 44 项矩阵: 是，Workboard/Task Ledger 边界更新为 `TaskLedgerReference`。 |
| P1-04 | 普通 `team_orchestrate` 接入质量 scorecard | `quality: []` 导致质量评分假阳性 | 返回 overall/worst/reason/evidenceRefs；不再是空质量数组 | DONE | 任务 ID: P1-04；状态变更: TODO -> DONE；开发变更文件: `openclaw_runtime/src/agents/orchestration-quality-scorecard.ts`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`, `vitest.config.ts`, `tests/fixtures/rastermill.ts`, `tests/unit/role-orchestration-methods.test.ts`, `tests/integration/p1-orchestration-boundary.integration.test.ts`, `tests/e2e/role-orchestration-diagnostics.spec.ts`, 本报告；核心调用链: observed ordinary orchestration attempts + observability scorecard -> `buildOrdinaryOrchestrationQualityScorecard` -> `quality`, `qualityState`, `qualityScorecard`, `qualitySummary` in `team_orchestrate` and `orchestrator.run` payloads；测试命令: `corepack pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose`, `corepack pnpm run typecheck`, `corepack pnpm run build:vite`, `corepack pnpm run test:e2e tests/e2e/role-orchestration-diagnostics.spec.ts`；测试结果: role orchestration + integration 43 tests passed，typecheck passed，build:vite passed，diagnostics E2E passed；真实运行 run-id: N/A，本项是 ordinary orchestration local/runtime/Gateway/UI evidence, not provider repair E2E；真实边界: ordinary quality is `null` when unevaluated and `shadow` when scorecard evidence exists; active Routing Memo authority remains gated and ordinary orchestration does not borrow Task Loop repair/checkpoint/blocked semantics；剩余不宣称的能力: 不宣称 complete or active quality product, automatic role淘汰, or Task Loop-quality repair loop；是否影响 44 项矩阵: 是，#15/#44 更新为 shadow scorecard + active gate boundary。 |
| P1-05 | 普通编排失败进入可解释 diagnostics | 普通编排曾弱于 Task Loop，且容易借用 repair 语义 | worker 失败后有明确 partial、diagnostic recommendations、Task Loop upgrade hint，并在 UI 可见；不使用 Task Loop repair/blocked/checkpoint 语义 | DONE | 任务 ID: P1-05；状态变更: TODO -> DONE；开发变更文件: `openclaw_runtime/src/agents/orchestration-protocol.ts`, `openclaw_runtime/src/agents/orchestrator-run-observed.ts`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`, `src/pages/Chat/team-orchestration-visualization.ts`, `src/pages/Chat/TeamOrchestrationCard.tsx`, `src/stores/chat/helpers.ts`, `shared/i18n/locales/en/chat.json`, `shared/i18n/locales/zh/chat.json`, `shared/i18n/locales/ja/chat.json`, `shared/i18n/locales/ru/chat.json`, `tests/unit/role-orchestration-methods.test.ts`, `tests/unit/chat-page-execution-graph.test.tsx`, `tests/integration/p1-orchestration-boundary.integration.test.ts`, `tests/e2e/role-orchestration-diagnostics.spec.ts`, 本报告；核心调用链: ordinary `team_orchestrate`/`orchestrator.run` -> `buildOrchestrationDiagnostics` -> Gateway payload `orchestrationDiagnostics` -> Chat enrichment/card UI；测试命令: `pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts tests/unit/chat-page-execution-graph.test.tsx tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose`；测试结果: 3 files / 60 tests passed；最终系统验收: `pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/task-loop-upgrade.test.ts tests/unit/routing-memo.test.ts tests/unit/role-orchestration-methods.test.ts --reporter=verbose` -> 4 files / 97 tests passed，`pnpm exec vitest run tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose` -> 1 file / 3 tests passed，`pnpm run test:e2e tests/e2e/chat-task-loop-upgrade.spec.ts tests/e2e/role-orchestration-diagnostics.spec.ts` -> 3 tests passed；真实边界: 普通编排只暴露 diagnostics、recommended next step、upgrade hint，不返回 `repairNodes`，不自动调用 `task_loop.run`，不创建 Task Loop root/checkpoint；剩余不宣称的能力: 不宣称普通 orchestration 具备 Task Loop repair/blocked 状态机或完整质量 scorecard；是否影响 44 项矩阵: 是，#44 从“普通路径弱”更新为 diagnostics-only。 |
| P1-06 | Routing Memo shadow dashboard | 动态学习默认 off 且曾不可见 | shadow 样本数、divergence、outcome、是否达 active gate 可视化 | DONE | 任务 ID: P1-06；状态变更: TODO -> DONE；开发变更文件: `openclaw_runtime/src/agents/routing-memo.ts`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`, `src/components/agents/RolesOrchestrationPanel.tsx`, `shared/i18n/locales/en/agents.json`, `shared/i18n/locales/zh/agents.json`, `shared/i18n/locales/ja/agents.json`, `shared/i18n/locales/ru/agents.json`, `tests/unit/routing-memo.test.ts`, `tests/unit/roles-orchestration-panel.test.tsx`, `tests/integration/p1-orchestration-boundary.integration.test.ts`, `tests/e2e/role-orchestration-diagnostics.spec.ts`, 本报告；核心调用链: Roles & Orchestration panel -> `hostApi.gateway.rpc('routing_memo.summary', { workspaceDir })` -> Gateway `routing_memo.summary` -> `readRoutingMemoDashboard`；测试命令: `pnpm exec vitest run tests/unit/routing-memo.test.ts tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose`, `pnpm exec vitest run tests/unit/roles-orchestration-panel.test.tsx --reporter=verbose`；测试结果: routing memo + integration 2 files / 48 tests passed，Roles panel 1 file / 1 test passed；最终系统验收: `pnpm run i18n:lint` -> passed，`pnpm run build:vite` -> passed（仅既有 dynamic import/chunk warnings），`pnpm run test:e2e tests/e2e/chat-task-loop-upgrade.spec.ts tests/e2e/role-orchestration-diagnostics.spec.ts` -> 3 tests passed；真实边界: dashboard 是 observation/evidence surface，shadow/off 不影响 routing，UI 文案显示 authority/gate 而不宣称默认学习；剩余不宣称的能力: 不宣称 Routing Memo 默认 active、不宣称自动淘汰角色、不宣称 shadow 样本会改变路线；是否影响 44 项矩阵: 是，#11 从“不可见/未贯通”更新为 shadow dashboard + active gate。 |
| P1-07 | Routing Memo 接入 scorecard-backed quality gate | +2/-1 曾没有可靠质量输入 | active routing authority 只接受 scorecard-backed `qualityOverall`；unreliable/null/shadow quality 均不影响 routing | DONE | 任务 ID: P1-07；状态变更: TODO -> DONE；开发变更文件: `openclaw_runtime/src/agents/routing-memo.ts`, `openclaw_runtime/src/agents/orchestrator.ts`, `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`, `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`, `tests/unit/routing-memo.test.ts`, `tests/integration/p1-orchestration-boundary.integration.test.ts`, `tests/e2e/role-orchestration-diagnostics.spec.ts`, `shared/product-semantics.ts`, 本报告；核心调用链: Gateway reads `OrchestrationQualityState` -> orchestrator receives `qualityState` -> `resolveRoutingMemoAuthority` downgrades `routingMemoPilot=active` to shadow unless `qualityState.source === 'scorecard'`, `scorecardBacked === true`, and `qualityOverall` exists；测试命令: `pnpm exec vitest run tests/unit/routing-memo.test.ts tests/integration/p1-orchestration-boundary.integration.test.ts --reporter=verbose`；测试结果: 2 files / 48 tests passed；最终系统验收: `pnpm run typecheck` -> node+web passed，`node scripts/check-capability-claims.mjs --fail-on-warning README.md README.zh-CN.md README.ja-JP.md docs/clawx-product-semantics.md reports/report-authenticity-true-false-positive-matrix-2026-07-04.md` -> 0 findings；真实边界: ordinary orchestration scorecards remain shadow and do not affect routing unless an explicit scorecard-backed active authority input is provided; otherwise memo reasons stay `memo-shadow:*` and routing is unchanged；剩余不宣称的能力: 不宣称 ordinary scorecard 默认 active，不宣称 user/verifier outcome 自动生产 reliable scorecard；是否影响 44 项矩阵: 是，#11/#44 边界已明确。 |
| P1-08 | 复杂普通 Chat 提供“升级为 Task Loop”入口 | 普通 Chat 自动 Task Loop 是假阳性 | 复杂任务出现显式升级按钮/提示；用户确认后才调用 `task_loop.run` | DONE | 任务 ID: P1-08；状态变更: TODO -> DONE；开发变更文件: `src/pages/Chat/task-loop-upgrade.ts`, `src/pages/Chat/ChatInput.tsx`, `src/pages/Chat/index.tsx`, `tests/unit/task-loop-upgrade.test.ts`, `tests/unit/chat-input.test.tsx`, `tests/e2e/chat-task-loop-upgrade.spec.ts`, 本报告；核心调用链: `detectTaskLoopUpgradeSuggestion` 只生成 `TaskLoopUpgradeSuggestion`，`ChatInput` 只渲染 `chat-task-loop-upgrade-suggestion` 和确认按钮，`Chat` 页面仅在 `onConfirmTaskLoopUpgrade` 后调用 `startTaskLoopUpgradeRun` -> Gateway `task_loop.run`；测试命令: `pnpm exec vitest run tests/unit/task-loop-upgrade.test.ts tests/unit/chat-input.test.tsx --reporter=verbose`, `pnpm run i18n:lint`, `pnpm run build:vite`, `pnpm run test:e2e tests/e2e/chat-task-loop-upgrade.spec.ts`, `pnpm run typecheck`；测试结果: unit 2 files / 59 tests passed；i18n lint passed；build:vite passed（仅既有 chunk/dynamic-import warnings）；E2E 1 test passed，确认建议显示前没有自动 `task_loop.run` RPC，点击确认后才发送；typecheck passed（node+web）；真实边界: 普通 Chat 是显式建议 + 用户确认后启动，不会自动进入 Task Loop，不提前创建 Task Ledger root/checkpoint；剩余不宣称的能力: 不宣称普通 Chat 是自动项目管理器，不宣称复杂 prompt 会静默进入 checkpoint/repair/blocked 状态机。 |
| P1-09 | Task Loop 真实失败 repair E2E | Task Loop 单元强，真实链路未证 | 人为制造 worker/test failure，看到 checkpoint、repair iteration、blocked/complete | DONE | 任务 ID: P1-09；状态变更: TODO -> DONE；开发变更文件: 本报告；已有程序证据: `tests/integration/loop-stability-check.test.ts` 覆盖 S3 repair resolves、S4 repeated repair blocks、S6 worker failure blocks、S7 repair budget exhausted blocks，`tests/unit/task-loop-controller.test.ts` 覆盖 scoped repair iteration、worker/verifier failure blocked、evidence gate checkpoint details/reasons，`tests/e2e/task-loop-panel.spec.ts` 覆盖 Electron 面板从 UI 触发 `task_loop.run` 并显示 lifecycle/result/gate/files/tests/trace；测试命令: `pnpm exec vitest run --maxWorkers=1 --reporter=verbose tests/integration/loop-stability-check.test.ts tests/unit/task-loop-controller.test.ts`；测试结果: 2 files / 86 tests passed；真实运行 run-id: N/A，本项是 provider-free controller/integration + Electron panel smoke 证明，不宣传真实 provider 失败全链路；剩余边界: 尚未补“真实 provider worker 在 Electron 中失败后 UI repair/blocked 全流程”的重型 E2E，因此 release 前如要宣传真实 provider E2E 仍需另开第二类任务；是否影响 44 项矩阵: 是，Task Loop failure/repair 从“单元强但未接证据”更新为 provider-free 可执行证明。 |

Task 7 README claim review: 已执行 `rg -n "DAG|Routing Memo|Task Loop repair|permission audit|PermissionDecisionEvent|Workboard|Task Ledger|quality scorecard|team_orchestrate|default learning|editable Chat|拖拽|可编辑|自動.*学習|品質スコア" README.md README.zh-CN.md README.ja-JP.md`；命中内容为 ClawGraph、Mission Control、Task Ledger、Review Center、Knowledge 等既有有界描述，未发现把 Chat Plan 说成完整 DAG editor、把 Routing Memo 说成默认 active learning、或把普通 orchestration 说成 active quality product 的 README overclaim，因此 README 三语种本次不改。

### 8.6 P1：补敏感内容真实边界

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P1-10 | transcript secret scan/redaction policy | Observability 脱敏不等于 transcript 安全 | 假密钥进入 transcript persistence policy 后，是否保留、脱敏或标记有明确结果；真实 chat 注入 E2E 不在本次最小闭环内 | DONE | 任务 ID: P1-10；状态变更: TODO -> DONE；开发变更文件: `shared/sensitive-content-boundary.ts`, `shared/capability-claims.ts`, `tests/unit/sensitive-content-boundary.test.ts`, `artifacts/capability-claims/status-table.json`, 本报告；测试命令: `pnpm exec vitest run tests/unit/sensitive-content-boundary.test.ts --reporter=verbose`；测试结果: 1 file / 4 tests passed；真实运行 run-id: N/A，本项是 transcript 本地 persistence policy 验证，不启动 Electron/Gateway/provider；验收结果: `redactTranscriptMessage` 对 `OPENAI_API_KEY=sk-test1234567890ABCDE` 形态不保留完整假 key，且 `logging.redactSensitive=off` 时会保留原文，边界明确；剩余边界: 未做“假密钥进入真实 chat 后 transcript artifact 是否脱敏”的端到端验证，因此不能升级为 `TP-RUN` 或全链路保证；是否影响 44 项矩阵: 是，#40 增加 transcript local policy 证据，#41 继续 `FP-OVERCLAIM`。 |
| P1-11 | patch/diff secret scan | diff 可能含密钥 | 含假 key 的 diff 在 trace/UI/report 中有 redacted projection，raw 文件行为明确 | DONE | 任务 ID: P1-11；状态变更: TODO -> DONE；开发变更文件: `electron/services/code-review-api.ts`, `tests/unit/code-review-center.test.ts`, `tests/integration/p1-sensitive-content-boundary.integration.test.ts`, `shared/sensitive-content-boundary.ts`, `shared/capability-claims.ts`, `artifacts/capability-claims/status-table.json`, 本报告；红测结果: 新增测试初次运行失败，code-review runtime prompt 仍包含完整 `OPENAI_API_KEY=sk-test1234567890ABCDE`，mock assertion 被 `api.run` 捕获后返回 `success=false`；修复方式: `collectCodeReviewDiffForTarget` 保留 raw patch/stats/files，`buildReviewPrompt` 仅对发送给 runtime 的 diff fenced block 使用 `redactSecrets` 投影；测试命令: `pnpm exec vitest run tests/unit/code-review-center.test.ts --reporter=verbose`；测试结果: 1 file / 4 tests passed；真实运行 run-id: N/A，本项是 code-review service + mocked Gateway runtime 级验证，不启动 Electron/UI/provider；验收结果: 含 fake key 的 diff 可被收集，但发送给 `agent` 的 prompt 不包含完整 fake key；剩余边界: raw workspace file、raw Git diff、copy patch UI 仍允许明文，不能宣传 raw diff 全脱敏；是否影响 44 项矩阵: 是，#40 增加 code-review diff prompt 投影证据，#41 继续 `FP-OVERCLAIM`。 |
| P1-12 | compaction summary secret safeguard | 压缩摘要可能保留密钥 | 含假 key 长会话触发 compaction，摘要不保留明文或明确告警 | DONE | 任务 ID: P1-12；状态变更: TODO -> DONE；开发变更文件: `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`, `tests/unit/compression-artifact.test.ts`, `tests/integration/p1-sensitive-content-boundary.integration.test.ts`, `shared/sensitive-content-boundary.ts`, `shared/capability-claims.ts`, `artifacts/capability-claims/status-table.json`, 本报告；红测结果: 新增测试初次运行失败，serialized artifact 的 objective/currentState/done/inProgress/decisions/nextAction 仍包含完整 `OPENAI_API_KEY=sk-test1234567890ABCDE`；修复方式: `buildDeterministicCompressionArtifact` 在返回前对 artifactWithoutQuality + telemetry 做 `redactSecrets`，再基于脱敏后的 artifact 计算 quality；测试命令: `pnpm exec vitest run tests/unit/compression-artifact.test.ts --reporter=verbose`；测试结果: 1 file / 11 tests passed；真实运行 run-id: N/A，本项是 deterministic compaction artifact/projection 级验证，不启动 provider；验收结果: artifact JSON、`renderCompressionArtifactSummary`、`renderRecoveryContextProjection` 均不包含完整 fake key，且保留 recovery projection；剩余边界: provider-generated summary/model echo 仍无全局零明文保证；是否影响 44 项矩阵: 是，#40 增加 compaction artifact/projection 证据，#41 继续 `FP-OVERCLAIM`。 |
| P1-13 | Memory secret-like proposal 真实 Gateway 验证 | gatekeeper 源码有，真实 RPC 未测 | `memory.propose` 传假 key，返回 reject/needs_review，并有 UI 反馈 | DONE | 任务 ID: P1-13；状态变更: TODO -> DONE；开发变更文件: `openclaw_runtime/src/memory/memory-store.ts`, `tests/unit/role-orchestration-methods.test.ts`, `shared/sensitive-content-boundary.ts`, `shared/capability-claims.ts`, `artifacts/capability-claims/status-table.json`, 本报告；红测结果: 新增测试初次运行失败，`memory.propose` 已 reject 但 Gateway feedback 中的 `proposal`/`normalized` 仍回显完整 `OPENAI_API_KEY=sk-test1234567890ABCDE`；修复方式: gatekeeper 继续用原始 proposal 判定，proposal record 与 audit payload 使用 `redactSecrets` 后落库/返回，避免把完整 fake key 暴露到 UI/list/audit feedback；测试命令: `pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts --reporter=verbose`；测试结果: 1 file / 40 tests passed；真实运行 run-id: N/A，本项是 Gateway handler + SQLite feedback 级验证，不启动 Electron/Gateway WebSocket/provider；验收结果: `memory.propose` fake key 返回 `action=reject`、`accepted=false`，payload 与 `memory.proposals` 不包含完整 fake key，`memory.list status=all` 无新增 card；剩余边界: 未做完整 Electron UI 或 WebSocket JSON-RPC E2E；是否影响 44 项矩阵: 是，#40 增加 `memory.propose` Gateway fake-key 证据，#41 继续 `FP-OVERCLAIM`。 |
| P1-14 | 敏感内容边界矩阵文档化 | 防止“全链路安全”假阳性 | 文档明确 file、transcript、trace、memory、compaction、model echo 的不同保证 | DONE | 任务 ID: P1-14；状态变更: TODO -> DONE；开发变更文件: `shared/sensitive-content-boundary.ts`, `shared/capability-claims.ts`, `tests/unit/sensitive-content-boundary.test.ts`, `artifacts/capability-claims/status-table.json`, 本报告；测试命令: `pnpm exec vitest run tests/unit/sensitive-content-boundary.test.ts tests/unit/capability-claims.test.ts --reporter=verbose`；测试结果: 2 files / 12 tests passed；真实运行 run-id: N/A，本项是文档化/机器可读边界矩阵，不改变运行主链路；验收结果: `file`、`transcript`、`trace`、`memory`、`compaction`、`modelEcho` 六个 surface 均有 safe claim、no guarantee、evidence refs、related task ids，且全部明确 `fullPlaintextFreeGuarantee=false`；剩余边界: raw file/diff/copy patch UI、配置关闭 transcript、provider payload、model echo 仍不提供零明文保证；是否影响 44 项矩阵: 是，#40/#41 和高优先级选择项 A 已同步。 |

#### 8.6.1 P1 收尾完成计划（2026-07-05，已执行）

执行原则：优先保证系统跑通，不为了追平旧文档而做大范围架构重写；raw workspace file/diff 仍允许保留精确内容，P1 只修“会进入模型、trace、报告、proposal feedback、compaction artifact 等投影面”的假 key 泄漏风险。P1 完成后必须补一个 provider-free 集成测试，把已完成的 P1-10/P1-11/P1-12/P1-13/P1-14 串起来验证一次。

| 顺序 | 任务 | 最小修复组件 | 验收测试 | 完成后报告动作 |
|------|------|--------------|----------|----------------|
| 1 | P1-11 patch/diff secret scan | 先从 `electron/services/code-review-api.ts` 的 code-review diff bundle/prompt 投影和 `electron/services/observability-redaction.ts` 的 trace attributes 入手；如发现 `electron/services/git-api.ts` / `src/components/file-preview/WorkspaceGitPanel.tsx` 只是 raw Git 面板展示/复制，则不强行改成全脱敏，只在报告中写清 raw 行为边界。 | 新增或扩展 `tests/unit/code-review-center.test.ts`：构造含 `OPENAI_API_KEY=sk-test1234567890ABCDE` 的 diff，确认发送给 code-review agent 的 prompt/trace projection 不含完整假 key；保留 stats/files 等可用信息。必要时扩展 observability redaction 单测。 | DONE；实际修复为 code-review runtime prompt diff projection redaction，raw Git 面板/复制仍按 raw 行为记录边界。 |
| 2 | P1-12 compaction summary secret safeguard | 先从 `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`、`compaction.ts`、`compression-planner.ts` 的 deterministic artifact/summary/projection 层入手；如果模型生成 summary 本身可能 echo 原文，则在落 artifact/恢复 projection 前做脱敏或明确告警，不改 provider 调用链。 | 扩展 `tests/unit/compression-artifact.test.ts`：长会话/summary/artifact 输入含 fake key，`renderCompressionArtifactSummary`、`renderRecoveryContextProjection`、compact result details 不包含完整 fake key，同时保留 objective/next action 等恢复信息。 | DONE；实际修复为 compaction deterministic artifact/projection redaction，不改变 provider 调用链。 |
| 3 | P1 集成测试 | 新建 `tests/integration/p1-sensitive-content-boundary.integration.test.ts`，只用本地 helper/Gateway handler/SQLite/temp workspace，不启动真实 provider、不要求 API key、不依赖 Electron UI。 | `pnpm exec vitest run tests/integration/p1-sensitive-content-boundary.integration.test.ts tests/unit/sensitive-content-boundary.test.ts tests/unit/capability-claims.test.ts --reporter=verbose`；集成测试至少断言 transcript local policy、memory.propose rejected feedback、code-review diff projection、compaction artifact/projection 四个面不回显完整 fake key，并断言 `fullPlaintextFreeGuarantee=false`。 | DONE；已新增 provider-free P1 integration smoke，后续发布前仍不能替代完整 Electron/WebSocket/provider E2E。 |

P1 最终验证结果: `pnpm exec vitest run tests/unit/code-review-center.test.ts tests/unit/compression-artifact.test.ts tests/integration/p1-sensitive-content-boundary.integration.test.ts tests/unit/sensitive-content-boundary.test.ts tests/unit/capability-claims.test.ts --reporter=verbose` -> 5 files / 29 tests passed；`pnpm exec vitest run tests/integration --reporter=verbose` -> 2 files / 22 tests passed；`pnpm run typecheck` -> node+web typecheck passed；`node scripts/check-capability-claims.mjs README.md README.zh-CN.md README.ja-JP.md reports/report-authenticity-true-false-positive-matrix-2026-07-04.md` -> 0 findings。

### 8.7 P2：长期可靠性与产品化完善

| ID | 任务 | 解决的假阳性/风险 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| P2-01 | Checkpoint 增加 file fingerprint 与 tool result digest | checkpoint 被误解为完整快照 | checkpoint 明确记录 touched files hash、tool result digest；restore 报告差异 | TODO | 待补 |
| P2-02 | 自动回滚能力重新定义 | “任意失败自动全量回滚”是假阳性 | 文档/UI 改成 review/restore/replay 辅助；若实现自动回滚，必须有文件快照/事务 | TODO | 待补 |
| P2-03 | Memory 自动来源可视化 | “每次任务自动长期记忆”是假阳性 | UI 展示 source、confidence、why needs_review、approve/reject path | TODO | 待补 |
| P2-04 | Compaction artifact viewer | 用户难以知道压缩保留/丢弃了什么 | UI 展示 summary、identifiers、quality warnings、restore/branch 入口 | TODO | 待补 |
| P2-05 | 用户自定义角色管理器 | 配置角色不等于产品化角色管理 | UI 支持 create/edit/delete/test role，且 role origin/audit 可见 | TODO | 待补 |
| P2-06 | 全局重试/幂等边界文档 | 局部 fallback 被误解为全局可靠性 | 每个子系统列 retry/idempotency/no guarantee；危险操作不声称幂等 | TODO | 待补 |
| P2-07 | UI 简化/高级模式策略 | “按用户能力自动切换”无证据 | 定义用户可控的 basic/advanced，而不是自动猜测 | TODO | 待补 |

### 8.8 每次更新本清单的规则

更新任何任务状态时，必须同时补充：

```text
任务 ID:
状态变更:
开发变更文件:
测试命令:
测试结果:
真实运行 run-id:
剩余边界:
是否影响 44 项矩阵:
```

禁止的更新方式：

- 只因为“代码看起来存在”就改成 `DONE`。
- 只因为“单元测试通过”就声称真实运行可用。
- 只因为“UI 有按钮”就声称产品化完成。
- 只因为“Observability 有 redaction”就声称全链路敏感信息安全。
- 只因为“Task Loop 有能力”就套用到普通 Chat。
- 只因为文档/知识库描述与运行态不一致，就强行改代码贴合旧文档；必须先记录 drift、兼容路径和是否阻断核心链路。
- 把全量测试暴露的旁路失败全部扩大为当前修复 scope；除非阻断核心 `Chat/Gateway/provider/agent/file/test` 链路，否则先分类、降级或登记。
