---
lifecycleStatus: active
id: coding-vg-sts-jj-baseline
title: TF-0764 冻结编码反例与 VG STS JJ VS 同候选评测基线
scenario: versegit-validation-layer-extension
taskType: evaluation
diffBase: 32236f49295fc73b7f63e1cbcb9216042f2ec359
intent: 将十组源码审计反例变为隔离且可复跑的基线驱动，冻结真实组件身份、支持域、项目输入、后续评测oracle及证据验收，不改变产品执行路径。
ownedPaths:
  - harness/specs/tasks/coding-vg-sts-jj-convergence-plan.md
  - harness/specs/tasks/coding-vg-sts-jj-baseline.md
  - harness/specs/fixtures/coding-vg-sts-jj-baseline/**
  - scripts/coding-baseline/**
  - tests/unit/coding-baseline-evidence.test.ts
requiredRules:
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles: []
expectedUserBehavior:
  - 后续修复可用同一组实际文件、Git工作树、Gateway处理器和MCP SDK反例验证效果。
  - 基线完成仅表示输入与缺陷测量可信，不把已复现缺陷写成修复通过或GA。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/coding-baseline-evidence.test.ts --maxWorkers=1
  - node scripts/coding-baseline/run.mjs --help
  - node scripts/contract-check.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/coding-vg-sts-jj-baseline.md
acceptance:
  - A1-A10全部有当前冻结源码的实际观测、正常或负向对照、来源类型、唯一后续修复节点，历史原始证据保持原hash。
  - VG VS binary与source/contract身份、STS源/安装包/目标解释器环境、jj-lib与可用独立CLI的区别均落盘，缺失或不适用不得写成已支持。
  - 固定两个独立pytest项目、一个TypeScript项目和双Git工作树夹具；共同candidate/full oracle、重复次数、预算、成本与负例在评测之前声明。
  - 验证器拒绝摘要篡改、缺失观测、旧source、scope或候选不一致、missing当pass；支持域能力表和后续节点命令映射完整。
  - 实际跑次从干净候选执行，依赖复用明确记录；全部raw、命令exit/count、hash与限制可以从盘上重算。
docs:
  required: false
  readmeTranslations: not-required
---

# TF-0764

本节点只实现基线驱动和冻结验收输入。原生 write、undo、worktree、journal、MCP、CodingRun 和编排的缺陷由 TF-0765—0774 按现有依赖后续修复。原审计 d8d1691a2 的失败结果不可重签为当前结果；驱动使用当前脚本所在工作树的源码。

所有产生写入或进程的探针仅在本次新建的独立目录和生成的文件上执行。配置/状态目录隔离，模型 spawn 是显式替身，不连接 provider 或第三方服务。VG/VS 只读版本/能力探测单列，STS 环境探测与正式 full/selected 的测量分开。Task Forest 使用 D:\ClawX 的唯一图；该本地路径不是本驱动的依赖。

选取语料时固定公开来源和精确 commit/tree，锁定命令及环境要求。基线阶段不声称已重跑第三方项目性能、模型质量或安装包。测试选择只适用于 Python/pytest；其他语言保留各自完整 runner。
