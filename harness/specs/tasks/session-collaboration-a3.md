---
lifecycleStatus: active
id: session-collaboration-a3
title: A3 按原 owner 等待运行终态和任务回执
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 25cc9abe099282721cf90e01c550506dd6fca703
intent: 提供有界、可取消、绑定会话代次和游标的只读条件等待，UI 与 agent 复用原运行和任务 owner。
touchedAreas:
  - shared/types/session-collaboration-watch.ts
  - shared/session-collaboration-watch.ts
  - shared/task-system/store.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/src/gateway/server-methods/agent-job.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-watch.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/agents/tools/sessions-watch-tool.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/agent-tools.policy.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.ts
  - electron/services/session-activity-api.ts
  - src/lib/host-api.ts
  - src/stores/session-collaboration.ts
  - tests/unit/session-collaboration-watch.test.ts
  - tests/unit/session-collaboration-query.test.ts
  - tests/e2e/session-collaboration-watch.spec.ts
  - harness/specs/tasks/session-collaboration-a3.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/rules/session-collaboration-center-contract.md
  - docs/modules/sessions.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - durable-task-system-boundary
  - contract-first-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-watch.test.ts tests/unit/session-collaboration-query.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-a3.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-a3.md --dry-run
acceptance:
  - 显式目标 generation、ScopedRun 或 TaskSystem 引用与有界游标决定条件；运行终态、空闲和任务回执分别表达。
  - 超时、取消、重复变化、断线补读、来源缺失和换代返回可读结果，所有退出路径释放监听资源。
  - UI 和 agent 消费同一只读合同，被动等待不调用目标模型、不写任务或取得 claim。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# A3 条件等待

消费 A2 的 scoped Query。单次只等待一个可见目标，最长 25 秒；已有 Gateway WebSocket 负责运输，Renderer 继续 typed host:invoke。工具发送者来自当前运行，模型仅选择目标和条件。

运行终态由原 agent-job owner 的缓存与重试宽限决定，保留事件的 sessionKey/generation。TaskSystem 事件只读分页保留 sequence、revision 和真实回执；会话空闲不改签成任务完成。游标绑定 requester、target 和条件，读取时间变化不产生重复通知。

取消按原读取者、等待 ID 和原 scope 匹配。运行事件与 session/task SQLite 文件变化只唤醒一次原 owner 回读；不扫描 transcript，也不建立新的任务、运行或投递状态库。重连从当前 owner 与上次游标补读，缺失来源保持 unknown/stale。

用户已授权连续推进剩余节点的开发，验收仍延期。此叶源码和回归可以接续前叶开发提交；Task Forest 完成状态仍由恢复后的同候选磁盘验收决定。
