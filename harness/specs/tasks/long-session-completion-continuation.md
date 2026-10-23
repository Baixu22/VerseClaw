---
lifecycleStatus: active
id: long-session-completion-continuation
title: 汇总子会话完成事件并在主会话空闲时幂等续接
program: long-session-development-20261022
taskKey: C3
phase: C
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 把已接受的委派结果送回正确主会话，避免重复通知、丢失失败或在新 generation 上续跑。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - C2
touchedAreas:
  - harness/specs/tasks/long-session-completion-continuation.md
  - harness/specs/tasks/long-session-development-plan.md
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-announce-delivery.ts
  - openclaw_runtime/src/agents/subagent-control.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/orchestration-completion-batches.ts
  - electron/services/session-activity-api.ts
  - shared/types/session-activity.ts
  - harness/specs/guides/long-session-delegation-admission.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - tests/e2e/long-session-completion-continuation.spec.ts
  - shared/host-api/contract.ts
  - tests/unit/long-session-completion-continuation.test.ts
  - harness/specs/fixtures/long-session-development/c3/**
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 把已接受的委派结果送回正确主会话，避免重复通知、丢失失败或在新 generation 上续跑。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/subagent-announce-generation-pin.test.ts src/agents/subagent-announce-delivery.visible-reply.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-completion-continuation.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/long-session-completion-continuation.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/long-session-completion-continuation.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-completion-continuation.test.ts
  - tests/e2e/long-session-completion-continuation.spec.ts
acceptance:
  - 同一次协调委派的 accepted workers 形成有界 batch，成功/失败/取消全部计入；只有该 batch 终态可判定才提交一次 consolidated result。
  - completion delivery 与 task acceptance 分开；主会话 busy/paused 时保留既有 owner 的 delivery intent，idle 后继续，不抢当前用户 turn。
  - 传输允许 at-least-once，但 receipt/idempotency key/generation fencing 保证重复或迟到事件不重复副作用、不跨 reset/handoff 错接。
  - 重启 replay、worker 拒收/秒完成、主会话删归档/暂停、主动 stop worker 和多个独立 batch 有产物；只有模型最终文本不能判定结果已交付。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
    - harness/specs/guides/long-session-delegation-admission.md
---

**C3 · 汇总子会话完成事件并在主会话空闲时幂等续接**

把已接受的委派结果送回正确主会话，避免重复通知、丢失失败或在新 generation 上续跑。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段三：交付单工作区长期协调入口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- C2：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-completion-continuation.md`。

**实现和核验入口**

- openclaw_runtime/src/agents/subagent-registry.ts
- openclaw_runtime/src/agents/subagent-announce-delivery.ts
- openclaw_runtime/src/agents/subagent-control.ts
- openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
- openclaw_runtime/src/agents/orchestration-result-bundle.ts
- electron/services/session-activity-api.ts
- shared/types/session-activity.ts
- shared/host-api/contract.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 同一次协调委派的 accepted workers 形成有界 batch，成功/失败/取消全部计入；只有该 batch 终态可判定才提交一次 consolidated result。
2. completion delivery 与 task acceptance 分开；主会话 busy/paused 时保留既有 owner 的 delivery intent，idle 后继续，不抢当前用户 turn。
3. 传输允许 at-least-once，但 receipt/idempotency key/generation fencing 保证重复或迟到事件不重复副作用、不跨 reset/handoff 错接。
4. 重启 replay、worker 拒收/秒完成、主会话删归档/暂停、主动 stop worker 和多个独立 batch 有产物；只有模型最终文本不能判定结果已交付。

**门禁与待交付检查**

- `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/subagent-announce-generation-pin.test.ts src/agents/subagent-announce-delivery.visible-reply.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-completion-continuation.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-completion-continuation.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/c3/completion-batch-receipts.json
- harness/specs/fixtures/long-session-development/c3/continuation-delivery-matrix.json
- harness/specs/fixtures/long-session-development/c3/restart-replay-check.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 复用 announce/result bundle/send-intent owner；如缺持久 delivery metadata，在该 owner 明确扩展，不建平行常驻 scheduler。
- 失联不是 completed；不能在 deadline 后把未证实 worker 当成功，可报告 explicit incomplete/timeout 并执行已定义退出。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

