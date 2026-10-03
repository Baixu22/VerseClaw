# 工具运行时可靠性第三批十节点（TF-0189..TF-0198）

> 收尾提交复核补充见文末。原始第三批结果保留；最终提交还包含 TF-0197 告警活动周期修正。

- 日期：2026-09-13
- 工作区：`D:/ClawX`
- 规格：`harness/specs/tasks/live-tool-runtime-reliability.md`
- 规则：`harness/specs/rules/tool-runtime-lifecycle.md`
- Task Forest：起始提案 `TFP-tool-runtime-relay-ten-start-20260913`，收口提案 `TFP-tool-runtime-relay-ten-close-20260913`

## 节点与反例

| 节点 | 反例 | 修复 |
|---|---|---|
| TF-0189 | `runBeforeToolCallHook` 的 catch 把 AbortError 收成 blocked failure | 取消时重新抛出原因 |
| TF-0190 | 插件审批等待被取消后返回 blocked | 通知 CANCELLED 后抛出取消原因 |
| TF-0191 | `toToolDefinitions` 不把 signal 传入策略链，取消后仍 execute | 传入 signal，并在策略后 throwIfAborted |
| TF-0192 | `invokeNodeSystemRunDirect` 忽略 AbortSignal，取消后仍等待并可能交付成功 | 本地 race 取消等待，不交付随后成功 |
| TF-0193 | `process remove` 可终止非后台会话 | 与 kill 一样要求 backgrounded |
| TF-0194 | `send-keys` 在 stdin 写入完成时若已取消仍返回成功 | 写入后 throwIfAborted |
| TF-0195 | ping-pong warning 不要求无进展证据 | warning 与 critical 一样要求 noProgressEvidence |
| TF-0196 | child 已退出但 session.exited 未置位时 poll 报告 running | 首次 poll 观察 child.exitCode/signalCode |
| TF-0197 | 别名合并在一侧缺少告警时间戳时清空限频 | 保留已有 stuck/long-running 时间戳 |
| TF-0198 | `onToolOutcome` 抛出非取消错误时把成功改成失败 | 观察器异常只记日志 |

回归用例与节点编号对应，位于：

- `openclaw_runtime/src/agents/agent-tools.before-tool-call.reliability.test.ts`
- `openclaw_runtime/src/agents/bash-tools.exec-host-node.output.test.ts`
- `openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts`
- `openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts`

## 验证记录

修复前聚焦回归 10 failed / 31 passed。修复后：

| 检查 | 结果 |
|---|---|
| agents 聚焦回归 | 11 文件，71/71 PASS |
| native-hook relay 的独立 unit-fast 回归 | 1 文件，2/2 PASS |
| 运行时类型检查 | `pnpm --dir openclaw_runtime tsgo:core` PASS |
| 运行时静态检查 | 变更 TS 文件通过 scoped oxlint `--type-aware --type-check`；`git diff --check` PASS |
| 构建 | `build:runtime` 与 Gateway smoke PASS |
| 通信回放 | `pnpm run comms:replay`、`pnpm run comms:compare` PASS |
| Electron E2E | `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground --workers=1 --reporter=list`，2/2 PASS |
| 专用 Harness | `pnpm harness validate --spec harness/specs/tasks/live-tool-runtime-reliability.md` 与 `--dry-run` PASS |

原始命令日志保存在本机 `%LOCALAPPDATA%/ClawX-scratch/tool-runtime-relay-20260913/`。

## 交付边界与后续

这是本地工程行为验证。Electron 用例使用真实桌面进程和模拟 IPC 事件；没有调用付费模型，没有真实远程 node-host 执行，也没有产生具名真人验收记录。

已发出的远程 `node.invoke` 仍不支持通过本地 AbortSignal 终止远端进程；本批只停止本地等待，不把取消解释为已经杀掉远程进程。既有 TF-0009、TF-0133 与相关产品锁不因本批完成而改变。

README 中、英、日三语已同步上述行为。Task Forest 只通过官方 CLI 写入。十个新节点均为 done/100，父节点 TF-0102 保持 in_progress。

## 收尾提交复核补充（2026-09-13）

用户要求提交第三、第四批成果并留下干净工作区。对完整待提交增量的结构化复核发现 TF-0197 的一个 P2：较新进展已经清空告警退避，别名合并却恢复旧周期的告警年龄，可能延迟告警及恢复请求。该问题已实际复现并修复，没有新增节点计数。

合并现在保留真实较新活动周期的告警重置或退避；刚创建的空别名不刷新停滞时钟；仅同一周期合并告警年龄。两侧 generation 是独立计数，不能用计数大小代替活动时间。原有 sessionFile 选择、队列相加、工具历史及完成身份摘要合并保持原约定。

定向验证先出现 **5 failed / 1 passed**，修复后 **6/6 PASS**，覆盖双向新进展、重置后的再次告警、空别名以及同周期限频。完整 agents **111/111**、native relay **2/2**、Electron **2/2**、运行时类型、scoped typed lint、runtime 构建与 Gateway smoke、通信 replay/compare 已复验通过。Frontend/主进程源码没有改动，沿用第四批已验证的 Vite 构建。

本轮日志在 `%LOCALAPPDATA%/ClawX-scratch/tool-runtime-commit-20260913/`；`warning-cycle-red.log`、`warning-cycle-green.log`、`agents-final.log`、`native-relay.log`、`electron-e2e.log`、`types-lint.log`、`build-runtime.log`、`comms.log` 为对应证据。

CLI 复核多次因服务容量失败，没有计为 PASS。用户随后明确要求改由新的 Astra 会话 review；ChatGPT 账号入口不可用后，独立 Astra 审查代理完成只读复核，返回 `findings=[]`、`patch is correct`，确认原 P2 闭合且两个 TS 文件与冻结清单一致。结果保存在 `astra-independent-review.json`。本次提交保存两批代码、测试、规格、文档和全部任务历史，TF-0189..TF-0208 均为 done/100。全局 Harness 历史路径归属阻断保持单独记录。
