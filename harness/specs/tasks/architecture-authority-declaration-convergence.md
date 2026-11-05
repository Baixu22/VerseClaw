---
id: architecture-authority-declaration-convergence
lifecycleStatus: active
diffBase: 3a362590d6b54e1e2083ec626d4cb9553905a3ad
title: 修正陈旧组件权威声明并撤销对应裁定
type: task
intent: 依据冻结默认矩阵与已有运行实现修正五个组件的描述，撤销八条已解决的冲突登记，并逐项解释三十五个登记缺口。
requiredRules:
  - contract-first-boundary
  - repository-artifact-retention
  - docs-sync
  - disk-temp-policy
  - task-forest-autoclose-and-roles
ownedPaths:
  - shared/component-authority-manifest.ts
  - shared/dcs/component-disposition-catalog.ts
  - scripts/check-semantic-authority-adjudication.json
  - tests/unit/semantic-authority-consistency.test.ts
  - tests/unit/architecture-authority-convergence.test.ts
  - tests/fixtures/semantic-authority/**
  - harness/specs/fixtures/architecture-authority-convergence/**
  - harness/specs/tasks/architecture-authority-declaration-convergence.md
  - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
  - docs/dev/architecture-skeleton/CHARTER.md
  - docs/dev/component-disposition-matrix-20261021.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - .gitattributes
requiredTests:
  - pnpm exec vitest run tests/unit/semantic-authority-consistency.test.ts tests/unit/architecture-authority-convergence.test.ts tests/unit/component-authority-manifest.test.ts tests/unit/component-disposition-catalog.test.ts tests/unit/model-capability-profile.test.ts tests/unit/default-config-matrix.test.ts --maxWorkers=1
  - node scripts/check-semantic-authority.mjs
  - pnpm contract:check
  - pnpm run typecheck
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-evidence-refs.mjs
  - pnpm harness validate --spec harness/specs/tasks/architecture-authority-declaration-convergence.md
  - git diff --check
acceptance:
  - 当前基线18条规则、8条裁定、54结构例外、35gap有独立报告；五组件逐一对照实际owner与冻结默认矩阵。
  - working-memory与tool-registry描述为baseline；VToken生产assembly与bridge描述为retired；退役表自身是internal组件。仅更新描述性注册表，不改变任何运行默认值、权限、产品锁或运行执行代码。
  - 对应八条registered-pending-fix删除，重新注入五处旧描述经真实checker入口exit1。过时/空observed/非默认规则/缺理由等豁免仍被拒绝，结构例外只按实际观测变化同步，规则不得放宽。
  - 35项gap按class与target一一映射到external-owner、description-gap或implementation-gap，逐行给出源码锚点、判据及限制；不把登记缺失伪装成新运行组件或已修复功能。
  - 相关测试、类型、契约、scoped lint与Harness均执行，干净候选commit/tree、命令、退出码、哈希与凭据扫描可以从保留证据读回。
nonGoals:
  - 不增加权威中心、推理引擎、产品功能或默认开关。
  - 运行注册表的状态投影可如实反映既有retirement；不将旧opt-in误称仍可启用。
  - 历史封存证据不重签，完整架构复验属于TF-0791。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: required
---

TF-0790接续TF-0789。gateway-backend-communication边界保持；本叶只纠正对已有行为的声明。
用户本轮明确要求完成剩余相关节点，故在本叶证据收口后串行推进TF-0791。
README三语须复核；现有默认矩阵及VToken退役决定不修改。
