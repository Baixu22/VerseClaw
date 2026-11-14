---
lifecycleStatus: active
id: unified-gateway-snapshot-readback
title: 会话重载回读完整 Gateway 快照并保留后续事件
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: b6dc868ded45b192501ed0c821ee940934161dfc
intent: 修复 Gateway 初始化和状态对账漏读同状态身份字段、迟到快照覆盖后续事件的路径。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - api-client-transport-policy
  - session-derivation-ui-contract
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
ownedPaths: &paths
  - src/stores/gateway.ts
  - tests/unit/gateway-store-status-snapshot.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - harness/specs/tasks/unified-gateway-snapshot-readback.md
  - harness/specs/tasks/unified-acceptance-fixture-refresh.md
  - harness/specs/rules/gateway-readiness-policy.md
  - tests/e2e/session-family-counter-layout.spec.ts
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
touchedAreas: *paths
expectedUserBehavior:
  - 重载后的 Chat 使用当前连接就绪状态和会话身份。
  - 同为 running 的快照仍更新 readiness、端口、PID 和连接时间。
  - 请求期间收到状态事件后，迟到快照保留该事件。
acceptance:
  - 初始化的确认回读采用完整 Main Gateway 快照。
  - 定时对账读取同一 owner 的完整状态；同状态身份变化可以更新。
  - 初始化和定时对账的迟到响应不能覆盖请求期间收到的状态事件。
  - 初始化确认和定时对账共享请求顺序，重叠响应保留最新请求的完整状态。
  - 原 73 个唯一用例身份和 64+5 验收标准保持，原失败记录独立保留。
  - 当前候选四语 Electron 场景、单测、类型、通信和 Harness 回执可以从磁盘复算。
requiredTests:
  - pnpm exec vitest run tests/unit/gateway-store-status-snapshot.test.ts tests/unit/chat-startup-hydration.test.ts tests/unit/chat-load-sessions-startup.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/session-family-counter-layout.spec.ts tests/e2e/session-task-locales.spec.ts tests/e2e/long-session-coordination.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/unified-gateway-snapshot-readback.md
  - pnpm harness run --spec harness/specs/tasks/unified-gateway-snapshot-readback.md --dry-run
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

TF-0867 的会话生命周期回读修补。四个修补前负例由 b6dc868de 的磁盘测试报告确认：初始化和定时对账分别遗漏同状态身份变化，并可被迟到响应覆盖后续事件。

沿用 Main Gateway 的状态接口和 Renderer Host API。请求开始时保存当前视图快照及共享请求序号；响应返回时，只有请求仍为最新且该快照仍为当前视图才采用回读结果。完成验收继续按固定候选、原始用例和实际进程清理回执执行。

所有执行与模拟证据标注 driven_by: agent、实际 actor、realHumanEvidence: false。
