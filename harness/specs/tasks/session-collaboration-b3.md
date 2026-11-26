---
lifecycleStatus: active
id: session-collaboration-b3
title: B3 明确协作消息与原会话控制语义
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c5faf509526d1aa04138dec48cb1e28525e95152
intent: 共用具体动作目录，绑定原 scope/run 并使用已有消息、引导、停止与上下文 owner。
touchedAreas:
  - shared/types/session-collaboration-control.ts
  - src/lib/session-collaboration-control.ts
  - tests/unit/session-collaboration-control-semantics.test.ts
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/e2e/session-collaboration-controls.spec.ts
  - harness/specs/tasks/session-collaboration-b3.md
  - docs/dev/session-lifecycle-control-matrix.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-control-semantics.test.ts tests/unit/session-collaboration-panel.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-controls.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-b3.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-b3.md --dry-run
acceptance:
  - 消息、同 run 引导、中断后发送、stop、truncate、compact、fork、接力和迁移分别引用原 owner。
  - 同 run 输入只消费原 guide，sessions.steer 的中断后发送语义保持；缺少 capability 时返回具体禁用原因。
  - 实际调用前重新读取目标 scope/run，旧代和旧运行不覆盖新选择；消息不会完成任务或移动 writer。
docs:
  required: true
  files:
    - docs/dev/session-lifecycle-control-matrix.md
---
# B3 动作路由

协作目录显示动作的 owner、效果和必要条件。stop/compact 消费原带 generation 的接口；guide 先核验目标 run，再打开原 /loop 输入 owner，由它核对 capability 和实际入队。范围、分支、接力及环境迁移打开对应原 owner 的操作入口，继续由该入口选择边界、保存 operationId 并提交。

本轮完成源码与回归定义，执行验收仍延期。
