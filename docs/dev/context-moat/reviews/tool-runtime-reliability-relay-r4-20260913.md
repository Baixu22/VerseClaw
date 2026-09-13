# 工具运行时可靠性第四批十节点（TF-0199..TF-0208）

> 本文记录第四批节点验收。后续整批提交复核另修复第三批 TF-0197 的告警活动周期，最新提交验证见[第三批记录的收尾补充](tool-runtime-reliability-relay-20260913.md#收尾提交复核补充2026-09-13)。此前 `final-evidence.json` 保留原验收版本指纹，不替代收尾提交版本证据。

本批十个节点已完成开发、测试与工程验收：agents 106/106、native relay 2/2、Electron E2E 2/2，以及类型、静态检查、构建、通信回放和专用 Harness 均通过。结构化复核发现的两项问题已修复，第二轮审查无发现。TF-0199..TF-0208 已通过 Task Forest CLI 收口为 done/100。全局 Harness CI 的历史分支路径归属红门单独保留，不计为通过。

- 日期：2026-09-13
- 工作区：`D:/ClawX`，入口路径 `C:/Users/27933/Desktop/clawx/ClawX` 指向同一工作树。
- 规格：[live-tool-runtime-reliability](../../../../harness/specs/tasks/live-tool-runtime-reliability.md)
- 规则：[tool-runtime-lifecycle](../../../../harness/specs/rules/tool-runtime-lifecycle.md)
- 场景：[gateway-backend-communication](../../../../harness/specs/scenarios/gateway-backend-communication.md)
- Task Forest：父节点 `TF-0102`；官方 CLI 起始提案 `TFP-tool-runtime-relay-r4-start-20260913`，收口提案 `TFP-tool-runtime-relay-r4-close-20260913`。

本轮新节点仅为 `TF-0199..TF-0208`。进入会话时已有未提交的 `TF-0189..TF-0198` 成果保留，见[第三批记录](tool-runtime-reliability-relay-20260913.md)，不重复计入本轮十节点；文档、任务登记和门禁执行也不计作新增开发节点。

## 节点、反例与修复

| 节点 | 修复前反例 | 当前修复 |
|---|---|---|
| TF-0199 | 未包装工具在预取消后仍进入 prepare；晚到成功或失败覆盖取消，终态后仍投递进度 | adapter 在准备和执行边界检查取消；取消保留原始原因；成功、失败、取消后关闭进度交付 |
| TF-0200 | 客户端委托已取消仍 reserve，或在 reserve/complete 中取消后留下 pending 交接 | 预取消不 reserve；reserve/complete 后检查取消并 discard，不返回 pending |
| TF-0201 | 插件审批登记等待不响应取消，晚到批准可覆盖取消 | 登记与决策等待均可取消；预取消不登记；晚到批准只产生 CANCELLED 通知并抛出取消原因 |
| TF-0202 | trusted policy 或 before-tool-call hook 等待期间取消后，仍进入后续 hook 或返回 allowed/veto | 各异步策略阶段返回后检查取消，停止后续 hook 和审批 |
| TF-0203 | `write`、`send-keys`、`submit`、`paste`、stdin `end` 的回调未返回时，取消无法结束本地等待 | 各输入等待支持取消，结束时移除 abort 监听器；已写入的字节和后台进程由原执行路径管理 |
| TF-0204 | 兼容 child 进程已给出退出码，但 stdout/stderr 尚未读完；首次 poll 提前 markExited 并销毁流 | 流尚未结束且未销毁时不补记退出，保留剩余输出的读取机会 |
| TF-0205 | 正在等待的首次 poll 把执行所有者记录的 timeout/failed、`exitCode=0` 重算为 completed，并覆盖终态记录 | 读取所有者已记录的失败状态，保留 `exitReason` 和 `endedAt` |
| TF-0206 | PID fallback remove 后，晚到退出回调再次向 finished registry 加回该会话 | remove 时先置 `backgrounded=false`，阻止晚到 markExited 重建 finished 条目 |
| TF-0207 | 同一 run、同一 `toolCallId` 的已记录终态重复交付，增加循环历史和观察器计数 | 完成身份摘要独立于历史窗口并在别名合并时保留；重复 outcome 返回 `undefined`；不同 run 隔离，首次 result-only 观察保留 |
| TF-0208 | 只有 `AB` 或 `ABA` 时，一侧尚未重复，低阈值仍可能判作乒乓无进展 | 至少四次完成的交替调用 `ABAB`，且两侧结果稳定重复才允许判定；启用检测时窗口至少四条，仍需满足配置阈值 |

取消等待通过共享的 [`await-with-abort.ts`](../../../../openclaw_runtime/src/utils/await-with-abort.ts) 实现，复用原 node-host 的本地等待语义。该辅助函数负责取消竞态和监听器清理，不提供撤回已启动操作或终止远端进程的协议。

回归用例带对应 TF 编号，主要位于：

- [`agent-tools.before-tool-call.reliability.test.ts`](../../../../openclaw_runtime/src/agents/agent-tools.before-tool-call.reliability.test.ts)：TF-0199..TF-0202。
- [`bash-tools.process.lifecycle.test.ts`](../../../../openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts)：TF-0203..TF-0206。
- [`tool-loop-detection.progress.test.ts`](../../../../openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts)：TF-0207..TF-0208。

## 已有验证证据

初次红门为 3 文件、62 项：**23 failed / 39 passed**，十个新节点各有失败用例。原始日志保留为 `red.log`。随后让两条取消断言显式持有预期原因，避免在异步取消发生前读取 `signal.reason`；不将初次失败项数等同于独立缺口数。

逐节点聚焦运行记录如下。通过数只统计被选中的用例，未选中用例不算通过；相邻旧节点用于回归保护，不加入本轮节点数。

| 聚焦范围 | 结果 | 本机日志 |
|---|---|---|
| TF-0199 | 5/5 PASS | `TF-0199.log` |
| TF-0200 | 3/3 PASS | `TF-0200.log` |
| TF-0201 | 3/3 PASS | `TF-0201.log` |
| TF-0202 | 3/3 PASS | `TF-0202.log` |
| TF-0203 | 5/5 PASS | `TF-0203.log` |
| TF-0204 与旧 TF-0196 | 2/2 PASS | `TF-0204.log` |
| TF-0205 与旧 TF-0183 | 2/2 PASS | `TF-0205.log` |
| TF-0206 与旧 TF-0193 | 2/2 PASS | `TF-0206.log` |
| TF-0207 | 1/1 PASS | `TF-0207.log` |
| TF-0208 与旧 TF-0195 | 2/2 PASS | `TF-0208.log` |

`pnpm --dir openclaw_runtime tsgo:core` 已通过，主任务执行记录为 exit 0。

首轮 agents 共同回归为 11 文件、95 项：**94 passed / 1 failed**，日志为 `agents-full.log`。失败项是旧 `TF-0190` 的审批等待测试：新增可取消等待引入的微任务时序，使测试在真正进入 `plugin.approval.waitDecision` 前取消。测试调整为观察到该调用后再取消，复跑 **95/95 PASS**（`agents-final.log`，16.45 秒）。native-hook relay 的独立 unit-fast 回归另有 **2/2 PASS**（`native-relay.log`，5.20 秒）。

所有本机日志位于 `%LOCALAPPDATA%/ClawX-scratch/tool-runtime-relay-20260913-r4/`。这些是当前机器的执行证据，路径本身不构成仓库内可重放日志；准确验证命令以任务规格的 `requiredTests` 和下表为准。

类型感知 lint 首轮指出测试使用了当前 TS lib 不提供的 `Promise.withResolvers`，以及三处审批 fixture 缺少必填 `description`。改为标准 Promise 并补全 fixture 后，lint exit 0，最终受影响测试 26/26 复验通过（`agents-final-fixtures.log`），没有放宽类型配置。首次 Electron 执行被构建新鲜度门拦住，因为修正后的测试文件比 runtime dist 更新；真实重新构建后 2/2 通过，没有绕过新鲜度检查。

结构化审查使用本机独立 Git 快照 `review-candidate-r1`，基线为进入会话时的工作树内容，涵盖 18 个本轮变更文件；`review-manifest.json` 记录与当前工作区逐文件相同的 SHA-256。审查可只读访问 `D:/ClawX` 中完整调用链，Task Forest 历史快照没有混入代码审查包。

R1 提出两项 P2，均采纳并实际复现：小窗口无法容纳四条乒乓证据（`review-208-red.log`），历史裁剪后的重复终态及别名合并仍重新计数（`review-207-red.log`）。修复使用共享四条下限和既有诊断会话状态中的身份摘要集合；后者每个完成 ID 保留一个摘要，清理由原有诊断会话 prune/TTL 负责。两组反例转绿，另保留通用循环检测关闭时首次 result-only 投递的正例。

修复后共同回归扩至 **12 文件 / 106 项 PASS**（含已有诊断谱系测试，`agents-review-final.log`），native **2/2 PASS**；两者分开运行。R2 对修复增量复核返回 `findings=[]`、`patch is correct`、exit 0，见 `autoreview-r2.json` 和 `autoreview-r2.log`；没有遗留需处理的审查发现。

R2 命令在本机 `review-candidate-r2` 中运行：

```powershell
$relayScratch = Join-Path $env:LOCALAPPDATA 'ClawX-scratch/tool-runtime-relay-20260913-r4'
python -X utf8 D:/ClawX/openclaw_runtime/.agents/skills/autoreview/scripts/autoreview --mode local --codex-bin "$env:USERPROFILE/.codex/plugins/.plugin-appserver/codex.exe" --prompt-file "$relayScratch/review-notes-r2.md" --dataset "$relayScratch/review-manifest-r2.json" --output "$relayScratch/autoreview-r2.txt" --json-output "$relayScratch/autoreview-r2.json" --stream-engine-output
```

`final-evidence.json` 记录最终 19 文件指纹：运行时代码与测试均与审查快照逐字节相同；仅任务规格文件在审查后统一了 CRLF/LF，内容未变。第三批原始报告、提案及两个历史快照的原字节也已核对保留。

## 共同门禁与最终收口

下表记录实际命令结果；待完成的检查不表示通过。

| 检查 | 当前状态 | 验收依据 |
|---|---|---|
| agents 共同回归 | PASS | 规格 `requiredTests` 的 12 文件命令，106/106；`agents-review-final.log`，16.77 秒 |
| native-hook relay 独立 unit-fast 回归 | PASS | `native-hook-relay.loop-detection.test.ts`，2/2；`native-relay-r2.log`，5.93 秒 |
| 运行时类型检查 | PASS | `pnpm --dir openclaw_runtime tsgo:core`，最终修复后 exit 0；`types-review-final.log` |
| 变更 TS 的类型感知静态检查 | PASS | 12 个变更文件全部通过 scoped oxlint `--type-aware --type-check`；`typed-lint-final.log` 与修复后的 `types-review-final.log`；E2E 文件 ESLint exit 0 |
| 运行时构建与 Gateway smoke | PASS | 最终 `build:runtime` 与实际 Gateway 启动检查；`build-runtime-r2.log`，Gateway ready，端口 50808 |
| Vite/Electron 构建 | PASS | 最终 `pnpm run build:vite`；`build-vite-r2.log`，保留现有 bundle 大小与混用动态/静态导入警告 |
| Electron 前台进度 E2E | PASS | `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground --workers=1 --reporter=list`；`electron-e2e-r2.log`，2/2，15.0 秒；失败结果含退出码 0 的超时场景 |
| 通信回放与回归比较 | PASS | 最终 `pnpm run comms:replay`、`pnpm run comms:compare`；`comms-r2.log`，loss/order/duplicates 均为 0，`rpc_p95` 相对基线无变化 |
| 专用 Harness 校验与选定流程 | PASS | diff-aware `pnpm harness validate --spec harness/specs/tasks/live-tool-runtime-reliability.md` 与 `pnpm harness run --spec harness/specs/tasks/live-tool-runtime-reliability.md --dry-run`；`harness-final.log` |
| 全局 Harness CI 基线 | FAIL，未计通过 | `pnpm run harness:ci`；`harness-ci.log`。整个分支的 Gateway 场景路径归属检查仍拒绝大量历史路径，与此前交接的全局基线阻断一致；未扩大所有权或修改基线来掩盖失败，后续全局阶段未运行 |
| 最终改动审查 | PASS | R1 两项 P2 已修复；R2 `findings=[]`、`patch is correct`、exit 0；`git diff --check` 通过 |
| Task Forest 与会话交接 | PASS | 十节点 done/100；官方 CLI validate/export 通过，HTML 内嵌当前图与 JSON 导出完全一致；`task-forest-final.log`、`task-forest-verification.json`；交接已更新 |

## 交付边界

本批范围是本地工程验收。聚焦测试中的策略、审批、客户端委托、进程回调和终态使用可控测试条件；它们证明相应代码行为，不证明真实 provider 的端到端效果。Electron 验证使用真实桌面进程和模拟事件，2/2 通过。

取消输入等待不会撤回已写入的字节，也不会自动杀掉后台进程。已发出的远程 `node.invoke` 仍无法通过本地 AbortSignal 终止远程执行；本地取消等待不能解释为远端进程已经停止。

本批未进行真实 provider 调用、真实远程 node-host 执行或具名真人验收。`TF-0009`、`TF-0133`、default-on 状态及相关产品锁保持原有边界；共同门禁通过也不改变这些边界，不构成联合系统 GA 或发布审批。

README 英、中、日三语在保留前三批说明的基础上同步新增行为，包含取消的副作用边界和第四批证据入口。父节点 TF-0102 保持 in_progress；后续从新的可执行反例接力。全局分支路径归属与具名真人验收仍按原有节点推进。
