# TF-0078 会话生态生命周期链 —— 独立健康审计提示词

> 交付对象：一个全新的、无本链上下文的审计 agent。
> 本文件是它的全部起点，直接整篇作为首轮输入。

## 0. 你的身份与立场

你是**独立健康审计员**，不是这条链的开发者。你的产出是判断与证据，不是修复。

你要审计的六个节点（`TF-0079` … `TF-0084`）已被各自的开发会话标记为 `done`，
并各自附有一份自评报告。**这些报告是「主张」，不是「证据」。**
写它们的 agent 与你利益不一致：它有动机把「代码写了」说成「功能成立」。
其中 `TF-0084` 由我（上一个会话）完成，请对它**格外**对抗性地审。

已知这条链自己就出过一次典型假阳性：`sessions.yieldState` 在 `TF-0082` 里
有 handler、有 core descriptor，单测 7/7 全绿，但从未加入
`server-methods.ts` 的 lazy handler 白名单，`createCoreGatewayMethodDescriptors`
因此跳过该 spec，**生产 Gateway 实测返回 `unknown method`**。
这个失败模式（单测直接 import handler 模块 → 绿；生产 dispatch → 不可达）
就是你要在整条链上系统性复查的东西。

## 1. 硬事实（先自行核对，不要信这一节）

```bash
cd D:/ClawX
git rev-parse HEAD                 # 预期 e07b874b3（TF-0077 收口）
git rev-parse --abbrev-ref HEAD    # 预期 feat/runtime-lifecycle-governance
git status --porcelain | wc -l     # 预期 460+
```

- **整条 TF-0079..TF-0084 链都还没提交**，全部活在工作树里；HEAD 停在 `TF-0077`。
  所以「读 HEAD 的代码」会读到错的东西——**一律读工作树**。
- 工作树同时含**多个其他 workstream** 的未提交改动（DCS/SEKB、git-api、chat store、
  UI 等）。它们不属于本次审计范围，**不得清理、不得回滚、不得代改**。
- 平台 Windows；shell 为 git-bash；包管理 pnpm 11；Node 在 `C:\Program Files\nodejs`。

## 2. 权威事实来源（按可信度降序）

1. **源码本体**（工作树）——唯一一等证据。
2. **你自己重跑出来的命令输出**——二等证据，必须记 exit code。
3. **Harness spec**：`harness/specs/tasks/` 下这七份
   （`session-ecosystem-production-reachability`、`-safety-gate-consistency`、
   `-resource-reclamation`、`-cross-session-control`、
   `session-ecosystem-lifecycle-ledger-acceptance`、
   `runtime-lifecycle-governance`、`runtime-lifecycle-governance-ga-hardening`）
   —— 声明了 `touchedAreas`/`acceptance`/`requiredTests`，是「预期」的一半。
4. **边界规则**：`harness/specs/rules/runtime-lifecycle-governance-boundary.md`
   —— 这是第三条审计线（越界）的判据，逐条当红线读。
5. **Task Forest 节点**：`.agent-workbench/task-forest/graph/nodes.json` 的
   `TF-0078`..`TF-0084`，字段 `acceptance_criteria` / `requirements` /
   `desired_outcomes` / `success_metrics` / `non_goals` —— 「预期」的另一半。
   只读检查；要用 CLI 就用
   `python C:/Users/27933/.claude/skills/task-forest/scripts/task_forest.py show TF-0084`。
6. **自评报告**：`artifacts/session-ecosystem-*/report.json` —— **主张**，逐条去证伪。
7. **交接**：`docs/dev/handoffs/LATEST.md` 顶部若干节 —— 主张 + 已声明的边界。

## 3. 审计范围：六个节点各自声称交付了什么

| 节点 | 声称 | 主要落点 |
| --- | --- | --- |
| TF-0079 | 生命周期 RPC 生产可达 | `sessions.stop` 接入 lazy 白名单 + core descriptor + Electron required-method gate |
| TF-0080 | 会话安全闸门与删除一致性 | `session-delete-gate`（Electron）、delete operation journal、稳定 `operationId`、admission fence |
| TF-0081 | 终端/进程/子智能体资源回收 | `os-containment`、supervisor `run-manifest` + `reconcile`、idle 四分类、50 周期 drain 夹具 |
| TF-0082 | 跨会话控制与 lineage 统一 | announce 代际钉扎、typed Host API stop、queueDrain `expectedSessionId`、send/steer permit 覆盖 run-start、lineage runId join、`sessions.yieldState` |
| TF-0083 | Goal/Loop 条件唤醒、取消级联、定时续跑 | flow budget 只算非终态、`mission.cancel` 级联、typed `MissionContinuation`、Cron `missionContinuation` payload、`wait_json.timeoutMs` 生效 |
| TF-0084 | 统一只读生命周期账本 + 真实闭环验收 | `session-lifecycle-owner-views.ts`、`session-lifecycle-ledger.ts`、`sessions.lifecycleLedger`、生命周期方法可达性 census、投影/账本/owner 集合交叉核对 |

---

## 4. 审计线 A —— 假阳性：写了但没接上，或根本没写

**判定原则：一段代码只有在「存在从真实生产入口可达的调用路径」时才算交付。**
「有测试」不算，「有导出」不算，「有 descriptor」不算。

### A1. Gateway 方法三处注册点必须同时存在

一个方法要真正可达，需要同时出现在：

1. `openclaw_runtime/src/gateway/server-methods.ts` 的 `createLazyCoreHandlers({methods:[...]})` 名单
2. `openclaw_runtime/src/gateway/methods/core-descriptors.ts` 的 `CORE_GATEWAY_METHOD_SPECS`
3. 对应 family 模块里的 handler 实现

缺任何一处，`createCoreGatewayMethodDescriptors` 会**静默跳过**（`if (!handler) continue`），
方法既不 advertise 也不可 dispatch。请对**本链声明过的每一个 RPC** 做这个三点核对，
并且必须**经生产 registry dispatch** 验证，而不是 import handler：

```bash
cd D:/ClawX/openclaw_runtime
pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts \
  src/gateway/session-ecosystem-lifecycle-reachability.test.ts \
  src/gateway/session-ecosystem-production-reachability.test.ts
```

TF-0084 已写了一个 census（8 个方法）。**你的任务是判断这个名单是否完整**：
自己从 `core-descriptors.ts` + 各 spec + 交接文档反查本链引入/修改过的全部方法，
凡不在 census 名单里的，逐个手工验证。名单漏项本身就是一个 finding。

### A2. 没有生产调用方的导出（dead export）

已知的**故意**缺口（TF-0083 自己声明过，不是新发现）：
`fireGoalWaitChild` / `fireGoalWaitTimer` / `armGoalWaitTimer` 全部实现且有单测，
但**没有任何工具或 RPC 面去 arm 它们**，子智能体完成路径上也没有插入调用。
你的判断题是：这属于「已声明的 opt-in 边界」还是「假阳性交付」？
给出结论并说明依据（看 TF-0083 的 `requirements` 与 `non_goals` 是否真的覆盖了它）。

在此基础上，系统性搜同类问题：

```bash
cd D:/ClawX
# 对本链每个新增/修改模块，检查其导出是否只有测试在用
grep -rn "export function\|export const\|export class" \
  openclaw_runtime/src/agents/goal-wake-*.ts \
  openclaw_runtime/src/process/supervisor/*.ts \
  openclaw_runtime/src/gateway/server-methods/session-lifecycle-*.ts \
  openclaw_runtime/src/gateway/session-*.ts | grep -v "\.test\."
```

对每个导出符号，反查非测试调用方。**只被测试引用的导出 = 候选 finding**，
除非该模块本身就是被生产入口整体挂载的（此时要指出那个挂载点在哪一行）。

### A3. 死字段与死配置

`wait_json.timeoutMs` 曾经是**全仓库无人读取**的死字段（TF-0083 才让它生效）。
同类模式请查：

- `flow_runs` / `task_runs` / `subagent_runs` 新增列是否真有 reader
- `SessionActivity*` 类型里新增的可选字段（`idleClassification`、`lineage`、
  `generationSource`、`declaredGaps` 等）是否有消费者，还是只写不读
- 环境变量开关（`CLAWX_TERMINAL_*_IDLE_MS`、`OPENCLAW_BASH_RUNNING_IDLE_MS`）
  是否真的被读取并影响行为

### A4. 只到一半的链路（写了后端没有前端）

已知待判定项，逐个给结论：

- `sessions.lifecycleLedger`（TF-0084 新增）**没有 Host API 面、没有 renderer 消费者**。
  是「只读诊断 RPC，故意不做 UI」还是「功能欠缺」？
- `session.activitySnapshot`（runtime 侧）**不产出 `terminals`，也不产出 `git`**，
  `availability` 里也没有这两项。请查 Electron 侧
  （`electron/services/session-activity-api.ts`）是否补齐，以及
  `src/pages/Chat/SessionActivityPanel.tsx` 是否真的渲染了
  lineage / `yielded` / blockedReason。TF-0082 明确把「是否渲染」留成了未决决策——
  核实它现在到底是渲染了、还是数据备好但无人显示。
- TF-0082 声称的 typed Host API `stop/continue/fork` 三面：逐个确认
  `shared/host-api/contract.ts` → `src/lib/host-api.ts` → `electron/services/sessions-api.ts`
  → Gateway RPC 全程贯通，而不是只加了契约类型。

### A5. 缺失的负向覆盖

对每个节点的失败矩阵（spec 里的表格），核对是否真有对应测试。
特别注意「恒真断言」：断言写成了永远成立的形式（例如断言一个总是空的数组为空）。
抽查方式：把被断言的生产逻辑**临时改坏**，确认测试会红；改回。
这类回归探针请至少对以下三处各做一次并如实记录：

1. TF-0081 的 50 周期 drain 归零断言
2. TF-0082 的 announce 代际钉扎拒绝逻辑
3. TF-0084 的 `census.unexplainedTransitions` 判定

（TF-0084 的 census 设计上应当能失败：把某个 owner 的 `generationSource`
改成 `owner-pinned` 但不给 generation，census 必须报 unexplained。验证它。）

---

## 5. 审计线 B —— 是否达到规划中的完整标准

对 `TF-0079`..`TF-0084` **每个节点**，把 Task Forest 里的
`acceptance_criteria` / `requirements` / `desired_outcomes` / `success_metrics`
逐条抄出来，然后给四态判定之一：
`met` / `partially-met` / `not-met` / `unverifiable`，每条都要附证据或缺证理由。

### B1. 成功指标的口径必须还原

这条链的报告里有多个「= 0 / = 100%」指标，其真实口径比字面窄。已知需要复核的：

- TF-0082 `stale generation overwrite=0` —— 自评承认只覆盖三条路径
  （announce wake / queue drain / send-steer run-start）。其余路径本期未审。
  请判断「未审的路径」里有没有实际可被迟到代际覆盖的写入点。
- TF-0082 `lineage completeness=100%` —— 实际含义是
  「owner 记录了身份的条目全部带非空 ref」（断言 `lineageUnjoinedEntries=0`），
  不等于「所有效应都有完整身份」。核实措辞与断言是否一致。
- TF-0083 `duplicateWakeDeliveries=2` 而 `duplicateWakeTickCount=1` ——
  这是「至少一次投递 + 效果去重」的正确形态，不是缺陷。确认去重发生在
  durable 层而不是内存层。
- TF-0084 `unexplainedTransitions=0` —— 口径是「声明与数据不符的条目数」，
  **不是**「所有 owner 都被覆盖」。请确认 `declaredGaps` 是否诚实覆盖了
  真正读不到的 owner（Electron 终端、durable helper runDir），
  以及有没有第三个应当声明却没声明的 owner。

### B2. 自己重跑门禁，不引用报告里的数字

以下命令请**全部亲自跑一遍**，记 exit code 与真实测试数；与报告里的数字不符即为 finding。

```bash
cd D:/ClawX

# Harness：结构校验（脏树下 diff-aware 会被无关路径阻断，属已知环境限制）
pnpm harness validate --no-diff --spec harness/specs/tasks/session-ecosystem-lifecycle-ledger-acceptance.md

# 运行时分片
cd openclaw_runtime
pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts \
  src/gateway/server-methods/session-lifecycle-ledger.test.ts \
  src/gateway/server-methods/session-lifecycle-consistency.test.ts \
  src/gateway/server-methods/session-activity-projection.test.ts \
  src/gateway/server-methods/sessions.yield-state.test.ts \
  src/gateway/server-methods/sessions.queue-drain-generation.test.ts \
  src/gateway/server-methods/sessions.send-permit-lifetime.test.ts \
  src/gateway/server-methods/sessions.stop.test.ts            # 报告称 7 文件 50 测试

pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts \
  src/gateway/session-ecosystem-lifecycle-reachability.test.ts \
  src/gateway/session-ecosystem-production-reachability.test.ts \
  src/gateway/session-ecosystem-reclamation-cycle.test.ts \
  src/gateway/session-delete-operation-journal.test.ts         # 报告称 4 文件 33 测试
# 上面这条会跑 ~60s 的真实进程树夹具；加 --silent=false 才能看到
# [reclamation-audit] cycles=50 activeRecordResidual=0 ... 那行

pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.process.config.ts \
  src/process/supervisor/restart-reconciliation.test.ts        # 报告称 7
pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts \
  src/agents/goal-wake-*.test.ts                               # 报告称 8 文件 68
pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.cron.config.ts   # 报告称 3 文件 13
pnpm exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts \
  src/sessions/session-admission-registry.test.ts              # 报告称 12

# 根侧（Electron / renderer）
cd D:/ClawX
pnpm exec vitest run tests/unit/terminal-session-manager.test.ts \
  tests/unit/r0-3-terminal-session-reclaim.test.ts tests/unit/terminal-api.test.ts \
  tests/unit/r0-2-sessions-delete-fail.test.ts \
  tests/unit/runtime-lifecycle-governance.test.ts --maxWorkers=1   # 报告称 5 文件 23

# 全局门禁
pnpm run typecheck            # node + web，报告称 0
pnpm run contract:check
pnpm run comms:replay && pnpm run comms:compare
pnpm run build:runtime
pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts   # 报告称 3/3
pnpm --dir openclaw_runtime run check:loc                              # 全局红，非本链引入
git diff --check
```

### B3. 真实进程与真实 Electron 证据

```bash
cd D:/ClawX
node scripts/runtime-lifecycle-goal-wake-canary.mjs
# 期望：10 周期 pass=true，每周期 processPollToolCalls=0、duplicateWakeTickCount=1、
#       flagOffGoalWaitBlocked=true

node scripts/verify-runtime-lifecycle-packaged-electron.mjs
# 期望：packagedElectronNormalExit=PASS、packagedElectronCancel=PASS、
#       packagedElectronRawSecretPersistenceFindings=0，且用的是真实 electron.exe
```

请确认这两个脚本**真的起了真实子进程 / 真实 electron**，而不是 fixture：
读脚本源码确认 spawn 的是什么，并在运行时用 `tasklist` 之类手段旁证至少一次。

### B4. 明确未覆盖项（报告已声明，你要确认它没被悄悄升格）

- **FD / handle 泄漏未测**：50 周期夹具只断言记录、定时器、owned PID，不含文件描述符计数。
- **RSS 级内存增长未测**：只断言 finished 记录有界。
- 若报告任何位置把这两项说成已覆盖，即为 finding。

---

## 6. 审计线 C —— 是否越界：多出的功能与超出的权限

判据是 `harness/specs/rules/runtime-lifecycle-governance-boundary.md`
加上每个节点自己的 `non_goals`。逐条当红线核对。

### C1. 权威与写者边界

- `mission_runs` 是**唯一**的持久 goal truth；`flow_runs(controller_id="goal-wake")`
  的**唯一 writer 是 SQL CAS writer**；`task_runs(runtime="process")` 是 goal-owned
  持久进程的 truth。核对本链有没有引入第二个 writer 或旁路写入。
- **禁止**出现 `session_resources` 表、`SessionDesiredState`、`SessionReconciler`。
  grep 确认；也要确认 TF-0084 的「账本」**确实是只读投影**而不是新表/新 writer：
  `session-lifecycle-ledger.ts` 与 `session-lifecycle-owner-views.ts` 里
  **不应出现任何 INSERT/UPDATE/DELETE 或 `runOpenClawStateWriteTransaction`**。
- Session store 是 per-agent SQLite `cache_entries`，**Electron 永不写它**。
  核对 Electron 侧新代码没有直接改 session store。
- `SessionActivity` 只能是 read model。核对它没有获得写路径。

### C2. 权限与 scope

- 逐个核对本链每个 RPC 的 declared scope 与它**实际做的事**是否匹配：
  `operator.read` 的方法不得有任何 mutation；`sessions.lifecycleLedger` 与
  `sessions.yieldState` 声明为 `operator.read`，请确认它们不 arm、不写、不清队列。
- `sessions.queueDrain` 是 `operator.write`，`sessions.stop/reset/delete/cleanup`
  是 `operator.admin`。确认没有把 admin 级操作降级到 write/read。
- **不得新增无授权的跨 agent 控制面**。核对跨会话控制路径仍然校验
  requester 归属或 operator scope。
- TF-0082 明确 non-goal：**不放宽 agent 控制权限**、不新增 arm/cancel mutation RPC。
  确认 `sessions_yield` / `goal_wait` 的 arm 仍然是 tool-only。

### C3. 产品锁与默认值

以下必须全部保持不变，任何一处被翻动即为**最高严重度** finding：

- goal-wake、durable helper 仍 **default-off**
- VerseShell / 整体：`liveReady=false`、`productApproved=false`、`defaultOn=false`
- SEKB 仍 **confirm-only，无自动写回**
- 终端默认 `keep_on_leave`；`idleTtlMs = 0`（在有真实活动信号前）；
  workspace cap 为 null；未来任何 cap 必须是 admission rejection 而**不是 LRU 驱逐**
- idle 分类是**纯观测**，不得触发自动回收

### C4. 敏感数据外泄

- 投影 / receipt / journal / 账本里**不得出现** raw command、argv、env、cwd、
  objective、task 文本、error 原文、secret。TF-0084 的账本测试有一条
  「never projects raw command, objective, task, or error text」，
  请**扩大**这个检查到 TF-0079..TF-0083 的所有新增只读面与持久化面。
- `exit.json` 是终态 truth，cancel 只写 `control.json`；确认没有把命令原文落盘。
- 关键字扫描示例：

```bash
cd D:/ClawX
grep -rnE "command|argv|cwd|env\b" \
  openclaw_runtime/src/gateway/server-methods/session-lifecycle-ledger.ts \
  openclaw_runtime/src/gateway/server-methods/session-activity-projection.ts \
  openclaw_runtime/src/gateway/session-delete-operation-journal.ts
```

### C5. 归属越界（spec 声明 vs 实际改动）

TF-0084 自评里记了一个已量化的归属缺口：一个只按六份 spec 的 `touchedAreas`
并集构建的 clean candidate **既不 typecheck 也跑不起来**，需要额外 38 个
其他 workstream 未提交的文件，清单在 `scripts/tf0084-candidate-inherited.json`，
重建脚本在 `scripts/tf0084-build-candidate.mjs`。

请**独立复核这个清单**：

1. 这 38 个文件里，哪些其实应当由本链某个节点的 `touchedAreas` 声明
   （例如 TF-0083 自己的 `goal-wake-arm/cancel/dispatch/fencing/timer/timeout/triggers`
   与 cron 模块，明显属于 TF-0083 却不在任何 spec 里）？
2. 哪些确实属于别的 workstream（DCS/SEKB lineage、git-api、chat store）？
3. `shared/host-api/contract.ts` 同时携带本链与 git-api workstream 的改动——
   这种「一个文件两个 workstream」的耦合还有没有别处？

结论请给成两张表：**应补声明的路径** 与 **真实跨 workstream 耦合点**。

---

## 7. 反自欺硬规则

1. **报告是主张。**每条结论必须能追到 `file:line` 或一条你亲自跑过的命令 + exit code。
2. **不复用任何历史数字。**`audit-0..6`、各节点报告里的测试数与指标，一律重跑取证。
3. **测试绿 ≠ 生产可达。**凡「可达性」结论必须经生产 registry / 真实入口 dispatch。
4. **环境阻塞就写 blocked，不写 pass。**已知会遇到的：
   - diff-aware `harness validate` 在脏工作树里必被无关路径阻断（写 blocked + 原因）
   - `check:loc` 全仓库红且无 allowlist，不是本链引入
   - `agents-core` 全分片有 3–4 个既有失败（`bash-tools.exec.goal-wait`、
     `bash-tools.exec.durable-helper`），报错点在 `registerExecApprovalRequestForHost`，
     根因是 `ws://127.0.0.1:18789` gateway 未就绪，**早于任何 goal-wake 代码**；
     这些文件 `git status` 未修改 → 记为「既有、非本链」
   - `build:runtime` 偶发 Windows 原生崩溃 `0xC0000409`，重跑即过（如实记两次）
5. **改坏再改回，是允许且鼓励的**（回归探针）。但必须在报告里写明：改了什么、
   观察到什么、已还原，并用 `git diff` 证明还原干净。
6. **不修复。**你只审计与建议。除回归探针外不改生产代码；探针必须还原。
7. **不提交、不推送、不 stash、不清理**其他 workstream 的脏文件；不动 Task Forest 写入。
8. 语言：**中文**输出。

## 8. 交付物

### 8.1 报告

`artifacts/tf0078-chain-health-audit/report.md`，结构：

1. **结论摘要**（不超过 15 行）：三条审计线各自的总判定 + 最高严重度 finding 数
2. **审计线 A：假阳性与缺口** —— finding 列表
3. **审计线 B：预期达成度** —— 六个节点 × 逐条 AC/requirement/metric 的四态表
4. **审计线 C：越界** —— 逐条红线核对表 + 归属两张表
5. **重跑门禁实测表** —— 命令 / exit code / 测试数 / 与报告声称值的差异
6. **回归探针记录** —— 改了什么、是否变红、是否还原
7. **未能验证项** —— 每项写明「为什么验证不了」与「需要什么才能验证」
8. **建议**（按优先级，不含代码改动）

### 8.2 机读结果

`artifacts/tf0078-chain-health-audit/findings.json`：

```json
{
  "auditedAt": "<ISO8601>",
  "head": "<git rev-parse HEAD>",
  "worktreeDirtyPathCount": 0,
  "verdict": { "falsePositive": "", "expectationConformance": "", "boundary": "" },
  "findings": [
    {
      "id": "FP-01",
      "line": "A|B|C",
      "severity": "blocker|major|minor|note",
      "title": "",
      "location": "path/to/file.ts:123",
      "claim": "报告/spec 里的说法",
      "observed": "你实测到的事实",
      "reproduction": "可复制的命令",
      "impact": "",
      "recommendation": "",
      "confidence": "confirmed|likely|suspected"
    }
  ],
  "gateReruns": [{ "command": "", "exitCode": 0, "tests": 0, "claimedTests": 0, "match": true }],
  "notVerified": [{ "item": "", "reason": "", "needs": "" }]
}
```

### 8.3 严重度定义

- `blocker` —— 声称交付但生产不可达 / 产品锁被翻动 / 敏感数据落盘 /
  权限越界（例如 read 面能写、无授权跨 agent 控制）
- `major` —— 验收标准实际未达成但被记为达成 / 指标口径与措辞不符 /
  失败矩阵有恒真断言 / 归属声明缺失导致无法独立验收
- `minor` —— 死字段、死导出、文档与实现不一致、命名或注释误导
- `note` —— 观察与改进建议，不影响判定

## 9. 明确不在本次审计范围

- 其他 workstream 的未提交改动（DCS/SEKB、git-api、chat store、UI 等）本身的质量
- 真人验收、真实第三方 channel、产品批准、GA 授权 —— 这些从未声称达成，不要当缺陷
- 性能与容量评估
- 是否应当提交这条链 —— 那是用户的决定，不是审计结论

## 10. 结束条件

三条审计线各自给出明确总判定（`pass` / `pass-with-findings` / `fail`），
两份交付物落盘，所有回归探针已还原且 `git status` 相对你开始时**只多出这两份产物**。
若任何一条线无法给出判定，写明缺什么。





