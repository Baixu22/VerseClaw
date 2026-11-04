---
id: architecture-skeleton-admission-ast-hardening
lifecycleStatus: active
diffBase: bfcf57616b361a12845014b3f054b95e31c4021c
title: 修复单一 IPC 入口门禁的语法漏检
type: task
intent: 将架构测评复现的计算属性和空白调用漏检修复到既有 contract:check，使用已安装的 TypeScript AST 覆盖等价接入写法并保持运行时行为不变。
requiredProfiles:
  - fast
requiredRules:
  - contract-first-boundary
  - renderer-main-boundary
  - repository-artifact-retention
  - docs-sync
  - task-forest-autoclose-and-roles
ownedPaths:
  - scripts/contract-check.mjs
  - scripts/contract-check.d.mts
  - scripts/repository-artifacts.json
  - .gitignore
  - tests/unit/contract-check.test.ts
  - tests/fixtures/contract-check/**
  - harness/specs/tasks/architecture-skeleton-admission-ast-hardening.md
  - harness/specs/rules/contract-first-boundary.md
  - harness/specs/fixtures/architecture-admission-ast/**
  - docs/dev/architecture-skeleton/ADMISSION-GATE.md
  - docs/dev/architecture-skeleton/CHARTER.md
requiredTests:
  - pnpm contract:check
  - pnpm exec vitest run tests/unit/contract-check.test.ts
  - pnpm run typecheck
  - pnpm repo:artifacts:check
  - git diff --check
acceptance:
  - 标准、计算属性、空白或注释调用以及静态本地 Electron import/对象/方法别名的额外 handler 均被真实 --fixture 入口拒绝，诊断含源文件、行号和 flat-ipc 规则；handleOnce、call/apply、重复 host:invoke 与不可枚举方法同样拒绝。
  - electron 下的 ts、tsx、mts、cts、js、jsx、mjs、cjs 生产文件全部参与枚举；测试和声明文件继续排除。
  - 注释和字符串中的伪调用不被当成 handler，非字面量 channel 仍 fail-closed，preload 的等价 invoke 写法也参与既有检查。
  - 当前仓库 contract:check 通过且只保留 host:invoke；不修改运行时路径、Host API actions、冻结默认值、权限或产品锁。
  - 干净候选上保留测试 JSON、真实反例结果、候选 commit/tree、命令退出码、全文件哈希清单及零命中凭据扫描；未运行的门禁明确列出。
  - 更新既有 ADMISSION-GATE 与 CHARTER 当前状态，任务森林通过提案收口并保留历史。
nonGoals:
  - 不引入新依赖、通用静态分析平台、第二注册表或运行时组件。
  - 本叶子不解除服务依赖环或清理权威矩阵豁免，这些缺口按串行后续节点推进。
  - 不从专项通过推导全仓通过、整体成熟、GA 或真人证据。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/ADMISSION-GATE.md
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: not-required
---

本叶子为 TF-0787，父阶段 TF-0786，续接 TF-0628，依据 2026-11-05 架构测评的三个内存反例。
基线为 bfcf57616b361a12845014b3f054b95e31c4021c。修复沿用既有
ContractCheckFixture/v1 和门禁规则；AST 负责源码枚举，不新增运行时权威。
`gateway-backend-communication` 的接入边界保持原样。本轮没有产品可见行为变化。
