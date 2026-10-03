# 工具运行时可靠性第六批接力（TF-0214～TF-0223）

日期：2026-09-15。工作区：D:/ClawX。本批按用户“最近十个节点、blocked 默认跳过”的要求，
只接续当前源码中可执行的十个独立反例；未修改或强行验收任何 blocked 节点，也没有把文档、任务登记
或格式化计入开发节点。

## 节点与修复

| 节点 | 修复前反例 | 修复后行为 |
|---|---|---|
| TF-0214 | node.list 未返回时取消，100ms 有界等待仍超时 | resolveNodeExecutionTarget 使用 awaitWithAbort；取消立即释放本地等待，晚到节点列表不进入执行 |
| TF-0215 | 远程 system.run.prepare 未返回时取消，100ms 有界等待仍超时 | prepareNodeSystemRun 的 node.invoke 等待尊重取消，晚到 prepare 不进入后续阶段 |
| TF-0216 | 远程审批快照未返回时取消，取消被降级为普通审批分析结果 | 审批快照等待可取消；catch 仅处理真实读取失败，原始 AbortError 重新抛出 |
| TF-0217 | 自动审阅 Promise 未返回时取消，100ms 有界等待仍超时 | 自动审阅等待使用 awaitWithAbort，晚到审阅不创建后续审批或执行副作用 |
| TF-0218 | 审批登记 Promise 未返回时取消，100ms 有界等待仍超时 | 审批登记等待使用 awaitWithAbort，取消后不创建 detached follow-up 或消费晚到批准 |
| TF-0219 | 重复退出通知覆盖首次 finished 记录 | markExited 对已退出会话幂等，首次终态、退出码、信号与原因拥有写入所有权 |
| TF-0220 | 读取 finished 日志后仍保留旧 poll backoff | finished 日志读取前清除会话级 poll retry suggestion |
| TF-0221 | 负数、NaN、非法计数或清理年龄导致错误 backoff/清理判断 | backoff 计数、持久化计数和 prune 年龄归一化到有限、非负边界 |
| TF-0222 | 普通 exec 的 -10、0、NaN、Infinity 被当作显式 timeout | 非法显式 timeout 回退到默认 1800s，有效 timeout 行为不变 |
| TF-0223 | node host 的 timeoutSec=0 绕过默认值 | 非正数或非有限 node timeout 回退到请求默认值 |

## 红绿证据

修复前为先行行为反例，使用同一 agents 配置执行时 exit 1：

    pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts bash-tools.exec-host-node.abort.test.ts bash-tools.exec-host-node.output.test.ts bash-tools.exec.lifecycle.test.ts bash-tools.process.lifecycle.test.ts bash-tools.exec-host-node-phases.abort.test.ts command-poll-backoff.test.ts --passWithNoTests=false

红测逐项表现为：TF-0214～TF-0218 在 100ms 有界等待内返回 timeout；
TF-0219 的第二次退出通知改写了首次 finished 终态；TF-0220 finished 日志读取后仍能观察到 poll backoff；
TF-0221 的负数/NaN/非法年龄进入错误边界；TF-0222 的四个非法普通 exec timeout 没有回退；
TF-0223 的 node timeout=0 保持为 0。未将这些红测失败误报为阻塞节点。

修复后的同一专项为 6 个文件、57/57 passed、exit 0：

    pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts bash-tools.exec-host-node.abort.test.ts bash-tools.exec-host-node.output.test.ts bash-tools.exec.lifecycle.test.ts bash-tools.process.lifecycle.test.ts bash-tools.exec-host-node-phases.abort.test.ts command-poll-backoff.test.ts --passWithNoTests=false

新增/更新行为测试：

- openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.abort.test.ts
- openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
- openclaw_runtime/src/agents/bash-tools.process.lifecycle.test.ts
- openclaw_runtime/src/agents/command-poll-backoff.test.ts
- openclaw_runtime/src/agents/bash-tools.exec.lifecycle.test.ts

既有相邻专项基线另有 2 文件 61/61、初始 3 文件 35/35 通过；本批以 57/57 的六文件专项作为
十个新增节点的共同绿证据。本批相关路径的 scoped git diff --check 通过；共享工作树其他会话的
未归属改动未被清理。

## 实现范围

生产代码仅触及以下六个运行时文件：

- openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.ts
- openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
- openclaw_runtime/src/agents/bash-process-registry.ts
- openclaw_runtime/src/agents/bash-tools.process.ts
- openclaw_runtime/src/agents/command-poll-backoff.ts
- openclaw_runtime/src/agents/bash-tools.exec.ts

实现复用现有 awaitWithAbort，没有新增依赖、持久化格式、协议字段或产品开关。取消只结束本地等待，
不能解释为已经终止已发出的远程 node.invoke 或远程进程。退出终态仍由执行所有者登记；本批没有
改写默认开关、审批策略、真人/provider 验收、产品锁或发布状态。

## 最终门禁与交接结果

十个节点均已通过官方 Task Forest CLI 登记为 done、进度 100，挂在 TF-0102 下；TF-0102
及其真人/外部验收边界保持原状态。

| 检查 | 结果 |
|---|---|
| 六文件 runtime 专项 | 57/57 passed，exit 0 |
| spec 保留的 agents 相邻回归 | 12 files / 136 passed，exit 0 |
| spec 保留的 native unit-fast | 1 file / 2 passed，exit 0 |
| pnpm --dir openclaw_runtime tsgo:core | PASS；首次发现同步 autoReviewer 类型问题，Promise.resolve 修复后复跑通过 |
| pnpm run lint | PASS，0 errors / 119 warnings |
| pnpm run build:vite | PASS；保留既有 chunk、动态导入和 Tailwind 警告 |
| pnpm run build:runtime | PASS；Gateway smoke ready |
| pnpm run comms:replay / comms:compare | 均 PASS |
| pnpm harness validate --spec ... --no-diff | PASS，spec 结构有效 |
| pnpm harness validate/run --spec ... | 共享工作树均因其他会话已有未归属脏路径失败；不是本批 runtime 断言失败，未扩大 spec 所有权或改历史基线 |
| foreground Electron E2E | build:runtime 前由 stale dist fixture 拒绝；重建后 2/2 passed |
| Task Forest validate/export | 均 PASS；HTML 已导出到 .agent-workbench/task-forest/exports/task-forest.html |
| scoped git diff --check | PASS |

取消只释放本地等待，不声称终止已经发出的远程调用或远程进程。没有新增或翻转默认开关，
没有把本地工程证据升级为真人/provider 验收，也没有解锁产品锁或 default-on。
