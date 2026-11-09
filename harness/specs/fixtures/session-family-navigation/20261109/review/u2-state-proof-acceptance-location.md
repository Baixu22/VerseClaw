driven_by: agent  
actor: u2-state-proof  
requested_route: ccs-workbuddy/deepseek-v4.1-flash

已交付一个 Electron 候选文件，3 个 case；TypeScript 语法与暂存文件导入路径检查通过，Electron 执行状态为 `not_run`。读取分支为 `codex/session-interaction-acceptance-20261109`，请求 base 为 `5ffcdfe89`；证据映射生成时 HEAD 为 `68d9603ce42f378406df19971a573ebc8106de8f`。完整来源、原候选、SHA256 和当前源码对比在 [evidence-map.json](D:/tmp/unified-management-20261109/u2-state-proof/evidence-map.json)。

候选：[session-task-state-guidance.spec.ts](D:/tmp/unified-management-20261109/u2-state-proof/tests/e2e/session-task-state-guidance.spec.ts)。语法结果：[syntax-check.json](D:/tmp/unified-management-20261109/u2-state-proof/syntax-check.json)。

| case | 设置和断言 | 当前源码的具体缺口 |
|---|---|---|
| AC8 未绑定负责人 | 真实 `workspaces.create` 不传 `activeSessionKey`，回读无 project coordinator；点击项目，断言不借用其它会话、明确显示未绑定 | `Projects/index.tsx:34` 只有通用 unavailable；末尾“未绑定”文案断言预期失败 |
| AC8 loading → permission → refresh | 先读真实 Task Ledger，再在 Main `host:invoke` 保持回包；断言 loading。释放为注入的 `PERMISSION_DENIED`，断言权限原因、任务不可选、草稿保留；恢复原 handler 后通过现有刷新按钮读回同一 task | `TaskLedgerSummaryPanel.tsx:91` 丢弃错误类型；权限原因使用 soft assertion，失败后仍执行真实刷新恢复 |
| AC9 依赖原因及下一步 | 真实 TaskSystemStore 创建前置/后续任务；真实 claim 返回 `TASK_DEPENDENCY_UNSATISFIED` 且无 claim；从任务清单进入 Persistent tasks，要求等待原因及以标题命名的依赖入口，再通过现有 Claim 按钮领取前置任务 | `ManagedTasks.tsx:269` 未渲染 dependencies；等待原因和 `Open dependency: <objective>` 按钮断言预期失败 |

第二例是明确的回包延迟/权限拒绝故障注入。成功恢复来自撤销注入后的原 Host handler；未写入成功 fixture。第一、三例使用真实 owner 事实。每例 `afterEach` 将实际 Playwright 状态、错误、已到达的 owner/UI 观察和故障事件保存到 `state-guidance.json`；失败后的步骤不记作已执行。

已实际通过的证据定位如下。以下为磁盘回读的历史结果，并非本次新增用例的执行结果。

| 状态 / AC | 已通过的结果和断言位置 | 证据性质 |
|---|---|---|
| empty、960px 抽屉、Enter/Escape / AC8 | [final4-scope.tests.json](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/fixtures/session-task-chain/20261109/commands/final4-scope.tests.json) 中 project entry 用例；[project-agent-entry.spec.ts:64](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/project-agent-entry.spec.ts:64)；[project-entry.json](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/fixtures/session-task-chain/20261109/journeys/final4-scope/project-agent-entry-projec-9a4df-closure-only-folds-the-list/project-entry.json) | 真实 Electron、Main/Gateway，local-scripted provider；同一用例覆盖空项目与键盘抽屉 |
| Ledger unavailable / AC8 | [final4-warnings-rerun.tests.json](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/fixtures/session-task-chain/20261109/commands/final4-warnings-rerun.tests.json)，1/1；[session-chain-scope-faults.spec.ts:262](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/session-chain-scope-faults.spec.ts:262) | 真实 Electron renderer + Host warning fixture。原 final4-scope 该例 launch timedOut、suite exit=1 均保留；后续单例 passed 接替 |
| stale / AC8 | 同一 final4-scope 的 `Ledger transcript navigation rejects a replaced session generation`；[断言位置](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/session-chain-scope-faults.spec.ts:281) | Host fixture 换 generation，实际 UI 显示 refresh 原因且不导航 |
| failed + retry / AC8 | [final-session-unit.tests.json](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/fixtures/session-task-chain/20261109/commands/final-session-unit.tests.json) 中 `WorkspaceAgentsPanel transcript failure (R2) renders failed+retry instead of an empty transcript when history fails` | 组件单测、mock history 拒绝，确有 passed；所读包中未定位此分项的专门 Electron 结果 |
| empty 与 owner failure 区分 / AC8 | 同一 final-session-unit 的 `scoped task container distinguishes a discussion container from owner failure` | read-model 单测 passed |
| 依赖 guard / AC9 | [final-durable-task.tests.json](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/fixtures/session-task-chain/20261109/commands/final-durable-task.tests.json) 中 `enforces dependencies and rejects cycles` | 真实 TaskSystemStore 单测 passed；当前 store 文件哈希已变化，历史结果保留原候选，新增第三例负责当前 UI 链 |
| queued / 核实 / 可继续动作 / AC9 | [final4-worker.tests.json](D:/ClawX-work/session-task-unified-relay-20261109/harness/specs/fixtures/session-task-chain/20261109/commands/final4-worker.tests.json) 的首例；[session-worker-task-journey.spec.ts:199](D:/ClawX-work/session-task-unified-relay-20261109/tests/e2e/session-worker-task-journey.spec.ts:199) | 真实 worker queue、丢 ack 注入、刷新读回 `runtime-intervention` queued、继续 steer 通过。这是运行中消息排队；不是 scheduler 容量等待 |
| admission / run / report / acceptance 分离 / AC9 | final-session-unit 的 `keeps accepted, run completion and report delivery separate from task acceptance` | 单测 passed，验收状态保持 unavailable；不涉及本轮其他 agent 的父 Sidebar 状态修复 |

上述 empty/narrow、warning、stale 用例及其 Projects、TaskLedgerSummaryPanel、TaskLedger 页面相关文件与原结果 manifest 的哈希相同；worker 与 failed 单测相关文件对比亦相同。机器映射保留逐文件对比。抽取的结果/命令/产物哈希均与精选包 manifest 相符。

精确的最小 patch 建议，供主 agent 接手：

1. [Projects/index.tsx:34](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/Projects/index.tsx:34)：`workspace && !coordinatorKey` 选择 `projectEntry.unbound`，文案为 `No coordinator bound to this project.` / `此项目未绑定负责人。`。沿用现有 `project-entry-unavailable` 容器；其余错误仍选择现有 unavailable。补齐四语 key 即可满足第一例。
2. [TaskLedgerSummaryPanel.tsx:91](D:/ClawX-work/session-task-unified-relay-20261109/src/components/task-ledger/TaskLedgerSummaryPanel.tsx:91)：catch 保留现有 `normalizeAppError(error).code`；PERMISSION 保存 `permission-denied`。在 [状态文案位置](D:/ClawX-work/session-task-unified-relay-20261109/src/components/task-ledger/TaskLedgerSummaryPanel.tsx:169) 将该原因映射至四语权限不可用提示，仍保持 `data-state="unavailable"` 和现有刷新动作。原始异常内容不直接展示。
3. [ManagedTasks.tsx:269](D:/ClawX-work/session-task-unified-relay-20261109/src/pages/TaskLedger/ManagedTasks.tsx:269)：从已回读的 `contract.dependencies` 和 TaskView 列表显示未完成前置任务的 objective、当前 state、`Waiting for dependency`，提供 `Open dependency: <objective>` 按钮，定位并聚焦现有前置任务卡片，其 Claim 按钮完成后续动作。claim 的最终裁决继续调用原 Task owner；缺失依赖回读不能当成已完成。候选只创建两个已加载任务，不引入调度逻辑。
4. 容量原因仅交接、不新增 case：[long-session-delegation-receipt.ts:254](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/long-session-delegation-receipt.ts:254) 目前把每个 wave 的 `reason` 改成固定 `scheduled`、丢弃 `deferredReasons`；[scheduler:265](D:/ClawX-work/session-task-unified-relay-20261109/openclaw_runtime/src/agents/orchestration-resource-scheduler.ts:265) 已产生 `concurrency-cap` 等原因。沿现有 schedule.waves 类型透传字段，在 [SessionDelegationStatus.tsx:21](D:/ClawX-work/session-task-unified-relay-20261109/src/components/chat/SessionDelegationStatus.tsx:21) 展示同 scope 的 owner 原因；下一步复用 [resource-chip](D:/ClawX-work/session-task-unified-relay-20261109/src/components/chat/ResourceChip.tsx:173) 查看容量与现有 worker 入口。计划 defer 信息须与实时排队事实区分，不能仅见历史波次就声称当前仍在等待。本次已读 worker 回执 `queued=0`、`reason=scheduled`，不能据其通过关闭容量原因分项。

集成时只复制候选 spec 到源树同名路径。需要对应 UI 构建包含上述选择接纳的 patch；本次未启动 Electron 或 build。主 agent 可在现有构建上运行：

```powershell
$env:TEMP = 'D:/tmp'
$env:TMP = 'D:/tmp'
$env:CLAWX_E2E_RUN_ROOT = 'D:/tmp/unified-management-20261109/u2-state-proof/run-temp'
New-Item -ItemType Directory -Force -Path $env:CLAWX_E2E_RUN_ROOT | Out-Null
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'D:/tmp/unified-management-20261109/u2-state-proof/state-guidance.tests.json'
Set-Location 'D:/ClawX-work/session-task-unified-relay-20261109'
& 'C:/Program Files/nodejs/node.exe' node_modules/@playwright/test/cli.js test tests/e2e/session-task-state-guidance.spec.ts --workers=1 --retries=0 --reporter=list,json --output=D:/tmp/unified-management-20261109/u2-state-proof/results
```

回读 `state-guidance.tests.json` 和三个用例目录的 `state-guidance.json`。第二例另存 loading、permission 截图。候选中未使用 skip/xfail；若缺口尚未修复，保留实际失败和已完成的恢复断言。
