---
lifecycleStatus: active
id: g5-readiness-test-lifecycle
title: 校验自治宿主测试的启动、退出与重启证据
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: f90c1b1938a68d8a83b73674df5a0beb45de34c8
intent: 复用受控 Electron 夹具执行生产窗口生命周期，保留启动失败清理、旧进程退出和新进程身份的实际证据。
ownedPaths: &paths
  - tests/e2e/autonomy-host-readiness.spec.ts
  - tests/e2e/autonomy-runtime-readiness.spec.ts
  - tests/e2e/fixtures/electron.ts
  - harness/specs/tasks/autonomy-host-readiness.md
  - harness/specs/tasks/g5-readiness-test-lifecycle.md
  - scripts/g5/node-gateway-process-evidence.cjs
  - tests/fixtures/g5-node-process-evidence/**
  - harness/specs/fixtures/g5-readiness-review/20261118/**
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - 同一会话在窗口隐藏、Gateway 重启和应用重启后继续执行，读取实际 owner 与历史记录。
acceptance:
  - 生产窗口测试通过既有 Electron 夹具登记启动标记和 PID 创建时间；失败启动仍由测试运行器清理。
  - 隐藏窗口中的执行完成后窗口仍隐藏；应用重启前核对旧 Main 与 launcher 退出，重启后记录新的进程身份。
  - Provider 服务从启动后的准备阶段起进入 finally 清理，宿主清理错误仍会关闭 Provider 连接。
  - Node Gateway 的两次启动、创建时间、generation、输入配置摘要和退出由实时观察与独立原生进程检查绑定。
  - TF-0670 至 TF-0674 的原始 27 条验收条件保持完整；验收报告记录被测产品候选、测试源、构建来源与每次失败。
requiredTests:
  - node tests/fixtures/g5-node-process-evidence/selfcheck.cjs
  - pnpm exec vitest run tests/unit/electron-process-identity.test.ts tests/unit/autonomy-host-readiness.test.ts tests/unit/gateway-manager-restart-recovery.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm typecheck:test
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm test:e2e:run tests/e2e/autonomy-runtime-readiness.spec.ts tests/e2e/autonomy-host-readiness.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/g5-readiness-test-lifecycle.md
  - pnpm harness run --spec harness/specs/tasks/g5-readiness-test-lifecycle.md --dry-run
  - git diff --check
docs:
  required: true
  readmeTranslations: not-required
  reason: 测试夹具与进程证据校验修补，产品操作和能力声明沿用现有文档。
  files:
    - harness/specs/tasks/g5-readiness-test-lifecycle.md
---

`productionWindowLifecycle` 让测试夹具使用现有生产窗口关闭处理，同时保留
运行器的启动登记、PID 账本和失败清理。默认 E2E 流程继续使用原关闭行为。

Node 观察器记录实际启动时的进程身份与输入摘要，退出检查复用 Windows 原生
PID 与创建时间校验。缺失、重复、冲突或过期记录使对应检查失败。

冻结产品候选与测试工具修订分别记录。接续已有跑次时保留原命令、回执和
哈希；新增步骤使用新的输出目录。原始失败、运行器中止和后续复测各自保存。
