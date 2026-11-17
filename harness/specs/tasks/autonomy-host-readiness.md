---
lifecycleStatus: active
id: autonomy-host-readiness
title: TF-0674 实际宿主能力与持续运行回读
scenario: gateway-backend-communication
taskType: runtime-bridge
previousValidationDiffBase: d0723901104107e602efb7473aae4e1975663398
diffBase: 177ee7ed214979b82c4615fca6ddfda3b400a6b3
intent: 在既有 sessionActivity/effective-policy 和 Gateway monitor 中回读当前宿主能力，拒绝把静态声明、过期探针或配置保存当成实际可用。
expectedUserBehavior:
  - 当前能力通过既有会话诊断回读，未知、失效与不可用保持区别。
  - 诊断不会启动任务或授予权限，现有 UI 操作保持原行为。
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - shared/types/session-effective-policy.ts
  - electron/gateway/capability-monitor.ts
  - electron/gateway/manager.ts
  - electron/gateway/session-host-readiness.ts
  - electron/services/session-activity-api.ts
  - openclaw_runtime/src/gateway/session-effective-policy.ts
  - tests/unit/autonomy-host-readiness.test.ts
  - tests/unit/long-session-effective-policy.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/dcs-preview-switch.test.ts
  - tests/e2e/autonomy-host-readiness.spec.ts
  - tests/e2e/autonomy-runtime-readiness.spec.ts
  - harness/specs/tasks/autonomy-host-readiness.md
  - harness/specs/rules/autonomy-host-readiness-boundary.md
  - harness/specs/scenarios/autonomy-host-readiness.md
  - harness/specs/fixtures/autonomous-project-system/a5/**
residualPaths:
  - docs/dev/architecture-skeleton/ADMISSION-GATE.md
  - electron/main/ipc-handlers.ts
  - electron/main/ipc/request-helpers.ts
  - electron/preload/index.ts
  - electron/services/system-notifications-api.ts
  - electron/services/window-api.ts
  - harness/specs/guides/admission-seam-migration.md
  - harness/specs/tasks/architecture-skeleton-admission-regression.md
  - harness/specs/tasks/architecture-skeleton-admission-retirement.md
  - scripts/contract-check-flat-ipc.json
  - scripts/contract-check.mjs
  - src/types/electron.d.ts
  - tests/fixtures/contract-check/flat-ipc-allowlist-dangling.json
  - tests/fixtures/contract-check/flat-ipc-preload-direct-invoke.json
  - tests/fixtures/contract-check/flat-ipc-preload-mismatch.json
  - tests/fixtures/contract-check/flat-ipc-removal-plan-missing.json
  - tests/fixtures/contract-check/flat-ipc-retired-channel-live.json
  - tests/unit/contract-check.test.ts
  - tests/unit/system-notifications-api.test.ts
  - harness/specs/tasks/autonomy-object-owner-contract.md
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/tasks/autonomy-session-task-scope.md
  - harness/specs/tasks/durable-task-owner-acceptance.md
  - harness/specs/tasks/g5-foundation-current-acceptance.md
  - tests/e2e/u6-interaction-metrics.final.spec.ts
requiredRules:
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - autonomy-host-readiness-boundary
  - contract-first-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/dcs-preview-switch.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm test:e2e:run tests/e2e/autonomy-runtime-readiness.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/autonomy-host-readiness.test.ts tests/unit/long-session-effective-policy.test.ts tests/unit/gateway-manager-diagnostics.test.ts tests/unit/gateway-manager-restart-recovery.test.ts tests/unit/session-activity-background-read.test.ts tests/unit/workspace-preflight.test.ts --maxWorkers=1
  - pnpm typecheck
  - pnpm typecheck:test
  - pnpm contract:check
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm build:vite
  - pnpm test:e2e:run tests/e2e/autonomy-host-readiness.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-host-readiness.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-host-readiness.md --dry-run
  - git diff --check
acceptance:
  - 同一 isolated session 的实际 run 与 continuation 可回读；关闭渲染窗口后的执行和应用/Gateway 重启恢复分别测量。
  - 宿主、工具与调度来自既有实际 owner；输出 supported/unsupported/unknown、source、observedAt 和拒绝原因，不产生 grant。
  - 旧连接探针、跨 workspace/session/generation、仅配置工具、未测预算及缺失服务不能显示为可用。
  - 原配置 schema 与 UFTK 等字段保留；若无需迁移不写配置，修复失败的 rollback 由原配置 owner 保证，不新增配置 writer。
  - 精选证据绑定干净候选、输入摘要、实际命令/退出码/计数、agent actor、负例、哈希清单与未测边界。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - harness/specs/rules/autonomy-host-readiness-boundary.md
    - harness/specs/scenarios/autonomy-host-readiness.md
---

本叶只扩展现有只读诊断，无新增 UI、自动派发、预算授权、服务安装、权限或冻结默认。
四语 README 复核但不新增自治已完成的产品宣称。验证复用 D:/ClawX 已安装依赖，
TEMP/TMP 与原始跑次在 D:/tmp；不构成 fresh-install、真实模型质量或安装包验收。
前置 A1 的 source/evidence 保留原候选；本叶不得重签。
