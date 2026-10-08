---
id: harness-scenario-baseline-validation
title: 场景基线与任务变更归属校验
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 修复 TF-0029 的全局 Harness 阻断，按场景和任务的实际文件身份执行各自的校验，并完整保留真实 Git 路径和通信边界扫描。
touchedAreas:
  - harness/src/cli.mjs
  - harness/src/git.mjs
  - scripts/agent-dev-deep-test.mjs
  - package.json
  - pnpm-lock.yaml
  - tsconfig.node.json
  - tsconfig.web.json
  - tsconfig.test.json
  - harness/specs/tasks/agent-dev-ecosystem-regularization.md
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/runtime-lifecycle-governance.test.ts
  - vitest.config.ts
  - harness/specs/tasks/runtime-lifecycle-governance.md
  - docs/dev/runtime-lifecycle-governance/README.zh-CN.md
  - harness/specs/tasks/harness-scenario-baseline-validation.md
  - harness/specs/layers/harness.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/generated/catalogs/tools.md
  - docs/generated/catalogs/prod-flags.md
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-workbench/**
  - docs/dev/task-forest-engineering-20260913.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
expectedUserBehavior:
  - 全局场景运行扫描全部真实变更，不要求单个场景拥有其他任务的文件。
  - 任意任务规格仍拒绝未声明归属的变更，即使复制了场景的 id 和 type。
  - 中文和包含空格的路径保持原值；Git 差异读取失败时拒绝继续。
  - 生成的工具和旗标目录从现有唯一源重新生成，不更改旗标值。
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/harness-git.test.ts
  - node --test harness/src/git.test.mjs
  - pnpm harness validate --spec harness/specs/tasks/harness-scenario-baseline-validation.md
  - pnpm harness run --spec harness/specs/scenarios/gateway-backend-communication.md --dry-run
  - pnpm run harness:ci
  - pnpm run typecheck
  - pnpm agent-dev:fast
  - pnpm agent-dev:deep-test
acceptance:
  - 场景规格由已加载的 scenarios 目录记录识别，任务不能通过更改元数据绕过归属校验。
  - 场景运行报告保留完整 changedFiles，并明确归属检查不适用；非法 Renderer 调用仍导致退出码非零。
  - 任务无论是否关联 scenario，越界变更均导致退出码非零；exact residual 规则不变。
  - 未传 --since 的任务校验仍读取默认基线与工作树差异；只有显式 --no-diff 才执行结构校验。
  - Agent Dev 的共享诊断校验已注册的场景基线；实际修改仍单独执行任务规格的差异归属校验。
  - committed、staged、unstaged 和 untracked 的非 ASCII 路径均被完整读取，不裁剪文件名空格。
  - 合法但没有共同祖先的 Git 基线不得被静默转换为空变更。
  - 冷类型检查使用与 runtime 一致的固定版本原生 TypeScript 编译器，保留 Node/Web/Test 的文件覆盖、严格检查和未缓存执行；移除 baseUrl 后路径映射仍与原配置等价。
  - 编译器迁移需与原 TypeScript 5.9 检查对照，并实际验证原生编译器拒绝类型错误；不得提高性能上限或把缓存结果当作全量验收。
  - Agent Dev 的完整单测在同一 Vitest 调用中保留六个 Node 文件与独立 jsdom facade 环境，减少重复启动而不减少测试。
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - harness/specs/layers/harness.md
---

本修复归属既有 TF-0029。场景是共享规则和验证步骤的入口，不是整条分支的唯一任务所有者。
任务规格仍逐文件验证归属；场景运行仍读取完整差异、验证必需规则并扫描通信边界。
通过这一门不等于 RC-01R 或全局独立工程验收通过。
