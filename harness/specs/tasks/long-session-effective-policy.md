---
lifecycleStatus: active
id: long-session-effective-policy
title: 生成会话生效配置快照并区分原生后端
program: long-session-development-20261022
taskKey: B1
phase: B
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 把配置文件、静态目录、实际可执行能力和动作授权分开，复用 ModelCapabilityProfile 的 current-run 事实。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - A2
  - TF-0512
touchedAreas:
  - harness/specs/tasks/long-session-effective-policy.md
  - harness/specs/tasks/long-session-development-plan.md
  - docs/clawx-product-semantics.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - shared/types/session-effective-policy.ts
  - shared/types/session-activity.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - electron/services/session-activity-api.ts
  - src/pages/Chat/SessionActivityPanel.tsx
  - openclaw_runtime/src/agents/runtime-effective-capability.ts
  - openclaw_runtime/src/agents/session-runtime-compat.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/gateway/session-effective-policy.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/chat-abort.ts
  - openclaw_runtime/extensions/codex/src/app-server/session-binding.ts
  - openclaw_runtime/extensions/codex/src/app-server/compact.ts
  - openclaw_runtime/extensions/anthropic/cli-backend.ts
  - tests/unit/runtime-effective-capability.test.ts
  - tests/unit/long-session-effective-policy.test.ts
  - tests/unit/session-activity-panel-sections.test.tsx
  - openclaw_runtime/src/gateway/session-activity-handler.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.test.ts
  - tests/e2e/long-session-effective-policy.spec.ts
  - harness/specs/fixtures/long-session-development/b1/**
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
  - e2e
expectedUserBehavior:
  - 把配置文件、静态目录、实际可执行能力和动作授权分开，复用 ModelCapabilityProfile 的 current-run 事实。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-effective-capability.test.ts tests/unit/model-capability-profile.test.ts tests/unit/identity-scope.test.ts tests/unit/long-session-effective-policy.test.ts tests/unit/session-activity-panel-sections.test.tsx --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-core.config.ts src/gateway/session-activity-handler.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/session-activity.test.ts --maxWorkers=1
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/long-session-effective-policy.spec.ts
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-effective-policy.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-effective-policy.test.ts
  - tests/unit/session-activity-panel-sections.test.tsx
  - openclaw_runtime/src/gateway/session-activity-handler.test.ts
  - tests/e2e/long-session-effective-policy.spec.ts
acceptance:
  - 从 TF-0512 的 owner-resolved current facts 生成只读 session policy，字段包含 scope/generation、backend/binding、model/effort、grant、context/queue/resource/schedule limits 与来源。
  - configured、effective、unverified、unsupported、ignored 分开；缺失/过期/错 generation 回执保持 unknown，不能靠 JSON 文件或 enabled=true 推断可执行。
  - Codex native compact、Claude ownsNativeCompaction 与 OpenClaw 参数有逐项兼容表，忽略参数带原因，不创建第二 capability inventory。
  - 输出不含密钥、认证值或原始私有 prompt；读取快照不产生执行、配置写入或扩大授权。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**B1 · 生成会话生效配置快照并区分原生后端**

把配置文件、静态目录、实际可执行能力和动作授权分开，复用 ModelCapabilityProfile 的 current-run 事实。

本规格已由当前候选实现并验证：ModelCapabilityProfile 的 current-run facts 经有界 observation 进入只读 SessionEffectivePolicy，session activity Host/API/UI 在真实 Gateway 路径回读 configured/effective/unknown，不把配置冒充为执行能力。

所属阶段二：让会话配置与实际运行状态可见。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- A2：回读其当前合同与输出，不根据旧 summary 推断通过。
- TF-0512：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-effective-policy.md`。

**实现和核验入口**

- shared/host-api/contract.ts
- src/lib/host-api.ts
- electron/services/sessions-api.ts
- electron/services/session-activity-api.ts
- openclaw_runtime/src/agents/runtime-effective-capability.ts
- openclaw_runtime/src/agents/session-runtime-compat.ts
- openclaw_runtime/extensions/codex/src/app-server/session-binding.ts
- openclaw_runtime/extensions/codex/src/app-server/compact.ts
- openclaw_runtime/extensions/anthropic/cli-backend.ts
- tests/unit/runtime-effective-capability.test.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 从 TF-0512 的 owner-resolved current facts 生成只读 session policy，字段包含 scope/generation、backend/binding、model/effort、grant、context/queue/resource/schedule limits 与来源。
2. configured、effective、unverified、unsupported、ignored 分开；缺失/过期/错 generation 回执保持 unknown，不能靠 JSON 文件或 enabled=true 推断可执行。
3. Codex native compact、Claude ownsNativeCompaction 与 OpenClaw 参数有逐项兼容表，忽略参数带原因，不创建第二 capability inventory。
4. 输出不含密钥、认证值或原始私有 prompt；读取快照不产生执行、配置写入或扩大授权。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/runtime-effective-capability.test.ts tests/unit/model-capability-profile.test.ts tests/unit/identity-scope.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-effective-policy.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-effective-policy.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/b1/effective-session-policy.json
- harness/specs/fixtures/long-session-development/b1/policy-source-and-override-matrix.json
- harness/specs/fixtures/long-session-development/b1/backend-parity.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 依赖 TF-0512 完成并回读其产物；不接手其在途文件或用本 lane 重做同一能力清单。
- A1 固定字段与 version，后端不支持的属性允许 explicit unavailable，不伪造等价性。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

