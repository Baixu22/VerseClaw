# 工具运行时可靠性接力（2026-09-12，TF-0179–TF-0188）

本轮接续已完成的 TF-0169–TF-0178。用户明确要求至少完成十个节点；本批十项均来自当前源码的独立行为反例，登记、格式整理和文档同步不计入完成数。父节点保持 TF-0102，不改变产品默认开关或真人验收状态。

## 十项修复与验收依据

| 节点 | 修复前可执行反例 | 修复与验收行为 |
|---|---|---|
| TF-0179 | 自动审核中取消仍登记审批；登记中取消仍自动批准 | 异步审核、登记和新后台跟进的边界检查取消；不再发出后续授权请求 |
| TF-0180 | 有 stdout 时 stderr 与错误文本不在可见结果中，超时字段丢失 | 同一份合并输出用于文本与结构化结果，保留远端超时事实 |
| TF-0181 | 直接与 prepare 执行丢掉调用者提供的消息路由 | 传递 channel、target、account、thread；数值 0 的 thread 保留 |
| TF-0182 | 预取消的 process 仍写输入或排空输出；写入中取消仍关闭 stdin | 入口、轮询消费输出前及写入完成后检查取消，后台进程本身继续由既有所有者管理 |
| TF-0183 | 首次观察到 SIGTERM 的 poll 把 null exitCode 改成 0，并丢失 exitSignal | 首次与 retained finished poll 均保留 null 退出码及实际信号；缺失退出码不再显示成功码 |
| TF-0184 | 工具成功或失败后保留的回调仍向消费者发送进度 | 工具执行终态关闭该次进度回调，正常执行中的更新保留 |
| TF-0185 | 异步策略 veto/failure 覆盖取消；结果观察器终止后仍返回成功 | 在策略结果交付与结果观察之后遵守取消原因，取消不被误报为策略结果或正常成功 |
| TF-0186 | warning=2、critical=4 时首次警告被十次限频桶吞掉 | 尚无历史桶时允许首次警告，随后同桶限频，critical 仍在原阈值触发 |
| TF-0187 | 策略规范化参数导致请求与结果无法关联，循环无法终止 | 同 run 内通过 toolCallId 配对，保留原请求哈希与实际执行参数，覆盖返回新对象和原地改写 |
| TF-0188 | sessionId/sessionKey 合并把旧输出接到最新进展之后，误判 critical | 合并历史按 timestamp 稳定排序，较旧输出不能掩盖最新进展 |

回归用例与节点编号直接对应，位于：

- `openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts`
- `openclaw_runtime/src/agents/bash-tools.exec-host-node.output.test.ts`
- `openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts`
- `openclaw_runtime/src/agents/agent-tools.before-tool-call.reliability.test.ts`
- `openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts`

## 验证记录

初始源码为 `0f88e3fe6be4555a47989148cf85d31736fe258d`。首次复现为 5 个文件、33 条用例：21 条新增行为断言失败，12 条原有用例通过。第一版修复后 33/33 通过。复核再补出 TF-0187 原地参数改写反例（1 failed / 7 passed），随后将配对修复下沉到共享结果记录器，避免仅覆盖返回新参数对象的路径。

最终工程验收：

| 检查 | 结果 |
|---|---|
| agents 聚焦回归 | 11 文件，59/59 PASS，包含 22 条本轮反例及上一批相关回归 |
| native-hook relay 的独立 unit-fast 回归 | 1 文件，2/2 PASS；两分片合计 12 文件、61/61 |
| 运行时类型检查 | `pnpm --dir openclaw_runtime tsgo:core` PASS，最后一次结果记录在 `typecheck-final.log` |
| 运行时静态检查 | 11 个变更 TS 文件通过 scoped oxlint `--type-aware --type-check`；Electron E2E 文件通过 ESLint；`git diff --check` PASS |
| 构建 | 最终 `build:runtime`、Gateway 启动 smoke 和完整 `build:vite`（前端、Main、preload）PASS |
| 通信回放 | `pnpm run comms:replay`、`pnpm run comms:compare` PASS |
| Electron E2E | `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground --workers=1 --reporter=list`，2/2 PASS；error/aborted 两种终态保留输出与错误文本，输入框恢复可用 |
| 专用 Harness | 隔离候选上的 diff-aware validate 与 dry-run PASS；没有使用 `--no-diff` 或放宽路径规则 |

直接在共享工作树运行专用 Harness 时，14 个本轮开始前已有的 `.codex-tools/`、`team/claude/` 未跟踪文件触发归属门，exit 1。随后从原 HEAD 创建 detached 候选，仅复制并逐文件核对本批变更 SHA-256，依赖通过本地 junction 复用，在该候选运行原始 Harness CLI 得到 PASS。复制清单为 scratch 目录内的 `candidate-manifest.json`；候选位于同目录的 `harness-candidate/`。这只隔离任务范围，没有修改、删除或忽略共享工作树的其他文件。

`pnpm run harness:ci` 已执行，仍在 Gateway 场景的整个分支路径归属检查失败（exit 1），属于此前交接已记录的全局基线问题。本批的独立任务检查通过不能解释为全局 Harness CI 或发布验收通过。

原始命令日志保存在本机 `C:/Users/27933/AppData/Local/ClawX-scratch/tool-runtime-relay-20260912/`。切换工作区期间中断的 JSON 单测、lint、Vite 构建调用不计为通过，以后续完整运行的退出码和报告为准。

测试路由核查发现 `native-hook-relay.loop-detection.test.ts` 被运行时自动归入 unit-fast，agents 分片会排除它。因此规格增加独立 unit-fast 命令，并核对 JSON 报告中的实际文件清单，不能仅靠多文件命令的整体退出码宣称覆盖全部用例。

## 交付边界与后续

这是本地工程行为验证。Electron 用例使用真实桌面进程和模拟 IPC 事件，验证完整输出展示与终态后编辑器恢复；没有调用付费模型，没有真实远程 node-host 执行，也没有产生具名真人验收记录。

已发出的远程 `node.invoke` 仍不支持通过本地 AbortSignal 终止远端进程；本批守卫仅阻止取消之后尚未开始的后续动作。既有 TF-0009、TF-0133 与相关产品锁不因本批完成而改变。

README 中、英、日三语已同步上述行为。持久规则归入 `harness/specs/rules/tool-runtime-lifecycle.md`，执行规格为 `harness/specs/tasks/live-tool-runtime-reliability.md`。Task Forest 只通过官方 CLI 写入，起始提案为 `TFP-tool-runtime-relay-ten-start-20260912`，收口提案为 `TFP-tool-runtime-relay-ten-close-20260912`。新完成节点仅为 TF-0179–TF-0188，原有父任务、真人阻塞及产品锁维持各自验收口径。

两份提案已应用，Task Forest validate/export 通过。收口核查确认十个节点均为 done/100，HTML 的 `CURRENT_GRAPH` 与 JSON 导出的节点数据完全一致，父节点 TF-0102 保持 in_progress，TF-0009/TF-0133 保持原状态。

## 提交前独立复核

按用户追加的收尾、提交与合并要求，重新逐项核对十个节点的验收条目和用例。Codex autoreview 最终 exit 0，`findings=[]`、`overall_correctness="patch is correct"`、confidence 0.9；没有需要接受或拒绝的缺陷项。审查者只检查代码和测试，61 条单测及 2 条 Electron 用例仍由本任务执行，未宣称审查者重跑测试。

命令：设置 `PYTHONUTF8=1` 后，运行 `python openclaw_runtime/.agents/skills/autoreview/scripts/autoreview --mode local --engine codex`，附 `autoreview-code-notes.md`、`runtime-review.patch` 和 JSON 输出参数。结果保存在 scratch 目录的 `autoreview-r2.json` / `autoreview-r2.log`。最初一次模型限流不计为审核通过；最终保持同一引擎和模型完成。审核副本只排除了独立验证的任务台账与巨型生成文件，所有本批源码和相邻测试均纳入范围。
