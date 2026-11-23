---
lifecycleStatus: active
id: session-collaboration-identity-read-model
title: A1 接齐跨会话身份与活动投影的 owner 合同
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: b3b7109448744e82145a57572d7caf88a77ec79b
intent: 作为会话协作中心首个实施叶，复用 SessionActivity 和原任务/会话 owner，建立显式 scope、generation、run 与来源可用性的只读合同。
touchedAreas:
  - shared/types/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - electron/services/session-activity-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - harness/specs/tasks/session-collaboration-identity-read-model.md
  - tests/unit/session-collaboration-identity.test.ts
  - harness/specs/fixtures/session-collaboration-center/A1/**
  - docs/modules/sessions.md
  - docs/modules/multi-agent-and-tasks.md
expectedUserBehavior:
  - 对两个独立会话和一个子代理读取各自目标、范围、代次及原始来源。
  - 来源未读取、任务为空、旧代次和确实无活动分别返回可辨认状态。
  - 读取不改变会话、任务、模型、工作区或资源资格。
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
  - pnpm exec vitest run tests/unit/session-collaboration-identity.test.ts tests/unit/session-activity-store-scope.test.ts tests/unit/session-family-read-model.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-identity-read-model.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-identity-read-model.md --dry-run
  - git diff --check
acceptance:
  - 两独立会话与一个子代理保留各自 workspace/project/sessionKey/generation/run/task owner 身份，并能从原 owner 回读。
  - 同 key 跨工作区、旧 generation、旧绑定 revision、来源缺失和读取期间 reset 均返回对应 unavailable/stale/unknown；不回退到当前会话。
  - 查询不修改任务、会话、模型配置或资源 owner；前后 owner 状态与现有准入不变。
  - Host 使用 typed host:invoke，Main 保持 Gateway WebSocket owner；新增合同通过 contract 检查与定向类型检查。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
---
# 首叶实施合同

前置是已完成的 TF-0673、TF-0843 和 TF-0864；实施开始前由 CLI 回读状态及当前源码。source owner、身份规则与覆盖案例见 guide 的 A1。

本规格已具备实施读取入口，测试和新增字段由本叶实现后运行。规划交付仅检查该规格的存在、引用和 context，不将 prospective 测试声明当作执行结果。

- 复用 shared/types/identity-scope.ts；会话 generation 来自原 session owner，task/claim 来自当前 TaskSystem，root/binding/incarnation 来自 execution owner。
- 在 SessionActivity 扩展合同保留来源和可用性。跨 scope、旧代和读取中换代返回稳定错误/状态，不以 currentSession 或主 agent 默认 key 兜底。
- Main 与 Runtime 保持明确的读取分工，typed host-api/host:invoke 与 Main-owned Gateway WebSocket 不变。查询不引入第二 session/task/resource 写入者。
- 先覆盖原 scope/owner 的正反单测，再运行受影响的类型/contract/comms 与窄 Harness，回读原 owner 前后状态。
- A1 精选证据记录输入 scope、原 owner 回执、candidate/source/输入哈希、命令/exit/count、拒绝反例、读前读后状态与 driven_by:agent。原始临时输出写 D:/tmp。
- 回退使用 guide 的 A1 策略。其他会话在做文件以实际 worktree/写集核对，开始实现时更新 diffBase 和本叶边界，避免混入并发 UI 改动。

