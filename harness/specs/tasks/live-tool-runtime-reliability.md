---
lifecycleStatus: archived
id: live-tool-runtime-reliability
title: 真实语料后续工具执行、终止与恢复可靠性
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: HEAD
intent: 接力已完成的 TF-0209..TF-0213，以当前源码可执行反例完成 TF-0214..TF-0223 的节点等待取消、审批等待取消、退出登记幂等、poll backoff 边界及 timeout 默认回退修复。
ownedPaths:
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r6-20260915.md
  - openclaw_runtime/src/agents/bash-process-registry.ts
  - openclaw_runtime/src/agents/command-poll-backoff.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.abort.test.ts
  - openclaw_runtime/src/agents/command-poll-backoff.test.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r5-20260913.md
  - openclaw_runtime/src/utils/await-with-abort.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r4-20260913.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-20260913.md
  - openclaw_runtime/src/agents/bash-tools.process-send-keys.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.output.test.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/bash-tools.process-send-keys.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-20260913.md
  - openclaw_runtime/src/agents/bash-tools.process.ts
  - openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.reliability.test.ts
  - openclaw_runtime/src/logging/diagnostic-session-state.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-20260912.md
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/native-hook-relay.loop-detection.test.ts
  - openclaw_runtime/src/agents/harness/native-hook-relay.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.types.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
  - openclaw_runtime/src/agents/bash-tools.exec.foreground-heartbeat.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.lifecycle.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.loop-termination.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.cancellation.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.shadow-failure.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/tool-loop-detection.ts
  - openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/schema.help.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - harness/specs/tasks/live-tool-runtime-reliability.md
  - harness/specs/rules/tool-runtime-lifecycle.md
  - docs/dev/context-moat/reviews/tool-runtime-reliability-20260912.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r6-20260915.md
  - openclaw_runtime/src/agents/bash-process-registry.ts
  - openclaw_runtime/src/agents/command-poll-backoff.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.abort.test.ts
  - openclaw_runtime/src/agents/command-poll-backoff.test.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r5-20260913.md
  - openclaw_runtime/src/utils/await-with-abort.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/bash-tools.process-send-keys.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r4-20260913.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.output.test.ts
  - openclaw_runtime/src/agents/bash-tools.process.ts
  - openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.reliability.test.ts
  - openclaw_runtime/src/logging/diagnostic-session-state.ts
  - docs/dev/context-moat/reviews/tool-runtime-reliability-relay-20260912.md
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.types.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
  - openclaw_runtime/src/agents/harness/native-hook-relay.ts
  - openclaw_runtime/src/agents/native-hook-relay.loop-detection.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.foreground-heartbeat.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.lifecycle.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.loop-termination.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.cancellation.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.shadow-failure.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/tool-loop-detection.ts
  - openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/schema.help.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - harness/specs/tasks/live-tool-runtime-reliability.md
  - harness/specs/rules/tool-runtime-lifecycle.md
  - docs/dev/context-moat/reviews/tool-runtime-reliability-20260912.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - 策略钩子和工具准备尚未完成时，取消即可结束本地等待；晚到结果不得启动后续阶段。
  - 输入确认时若进程已退出，应答保留所有者记录的终态、退出信息和输出。
  - 别名合并后的同一工具调用只计一次；改变 process poll 等待时长不重置无进展证据。
  - 未包装工具与客户端委托在取消后不准备、不交付晚到成功或 pending，工具终态后不再投递进度。
  - 审批登记与输入回调等待均可取消；策略各异步阶段取消后不得启动后续钩子或审批。
  - 退出轮询等待输出读完，保留执行所有者的终态和退出原因；已移除进程不因晚到退出重新出现。
  - 同一运行的同一工具终态不重复计数；乒乓两侧均需重复稳定结果才能判定无进展。
  - 远程命令保留完整输出、超时事实和发起消息的投递路由。
  - process 取消后不写入输入或消费输出，首次退出轮询保留真实退出码和信号。
  - 工具终态关闭进度回调；策略和结果观察器触发取消后不得交付错误的成功或拒绝结果。
  - 低阈值警告、策略改写参数、会话别名合并均不破坏循环检测。
  - 策略钩子、插件审批和适配器路径上的取消保持取消语义，不改写成拦截。
  - 本地等待 node.invoke 时取消不交付晚到成功。
  - process remove 不能终止前台会话；send-keys 写入后仍检查取消；首次 poll 观察已退出子进程。
  - 有进展的乒乓不警告；别名合并按活动周期保留告警退避，新进展重置不被覆盖；观察器异常不改变成功结果。
  - 取消工具执行后不再收到前台心跳，也不启动尚未启动的命令。
  - 前台进度只提示当前可用的操作，正常输出和最终结果保留。
  - 工具循环终止不能被模型回退重新启动，按会话标识隔离检测状态。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - tool-runtime-lifecycle
humanEvidence: not-required
featureFlags:
  - 不新增或翻转产品默认开关。
forbiddenPatterns:
  - 为满足节点数量把已有 done 节点或仅登记、格式化工作计作新完成
  - 将模拟模型和自动化执行计作具名真人验收
  - 通过改变历史证据、产品锁或审批策略使检查通过
rollback:
  - 回退对应工具生命周期修复及其回归测试，无持久化格式迁移。
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts bash-tools.exec.foreground-heartbeat.test.ts bash-tools.exec.lifecycle.test.ts agent-tools.before-tool-call.loop-termination.test.ts agent-tools.before-tool-call.cancellation.test.ts agent-tools.before-tool-call.shadow-failure.test.ts agent-tools.before-tool-call.diagnostics.test.ts model-fallback.loop-termination.test.ts tool-loop-detection.progress.test.ts bash-tools.exec-host-node.abort.test.ts bash-tools.exec-host-node.output.test.ts bash-tools.process.lifecycle.test.ts agent-tools.before-tool-call.reliability.test.ts --passWithNoTests=false
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts bash-tools.exec-host-node.abort.test.ts bash-tools.exec-host-node.output.test.ts bash-tools.exec.lifecycle.test.ts bash-tools.process.lifecycle.test.ts bash-tools.exec-host-node-phases.abort.test.ts command-poll-backoff.test.ts --passWithNoTests=false
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-fast.config.ts src/agents/native-hook-relay.loop-detection.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground
acceptance:
  - 每项完成节点包含修复前失败、修复后通过的独立行为证据。
  - 取消、自然退出、后台交接和循环终止均遵守现有生命周期所有权。
  - 所有新增行为以相邻测试验证；涉及界面呈现的行为包含 Electron E2E。
  - 通过 Task Forest CLI 更新图和交接，并区分工程证据、真人证据及仍未完成的父节点。
docs:
  required: true
  files:
    - docs/dev/context-capability-blueprint.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

本批按用户“至少完成五个节点”的授权顺序推进。后续子节点只从实际代码、真实语料或
可执行反例发现的独立缺口建立，不重做 TF-0156/0157，不将本地工程结果升级为产品放行。

本次接力的五节点是 TF-0209..TF-0213，上一批已完成的 TF-0199..TF-0208 保持历史状态。所有新节点先有
行为断言失败再修复，文档与任务登记不计入开发完成数。远程 `node.invoke` 发出后的远程
进程终止协议仍不在本批范围，不能把本地等待取消解释为已经取消远程执行。

## 第六批接力范围与证据（TF-0214～TF-0223，2026-09-15）

本批从当前源码发现并修复十个独立、可执行的 runtime 反例，节点均挂在 TF-0102 下并通过官方
Task Forest CLI 登记为 done/100；blocked 节点保持跳过。节点范围为：

- TF-0214：节点目标解析等待 node.list 时的取消；
- TF-0215：远程 system.run.prepare 等待的取消；
- TF-0216：远程审批策略快照等待不吞原始取消；
- TF-0217：自动审阅等待的取消；
- TF-0218：审批登记等待的取消；
- TF-0219：markExited 首次终态登记幂等；
- TF-0220：finished 日志读取清理 poll backoff；
- TF-0221：poll backoff 计数与清理年龄边界归一化；
- TF-0222：普通 exec 非法 timeout 回退默认值；
- TF-0223：node host 非法 timeout 回退默认值。

每项均先有失败反例，再以相邻行为测试验证修复。共同证据为：
docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r6-20260915.md；
六文件 runtime 专项为 57/57 passed，修复前同一反例专项 exit 1；测试文件和生产路径已列入
本 spec 的 ownedPaths/touchedAreas。取消语义只覆盖本地等待，不承诺终止已经发出的远程调用或
进程；本批不新增或翻转默认开关，不构成真人/provider 验收或产品发布解锁。
