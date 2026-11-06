---
id: architecture-convergence-final-verification
lifecycleStatus: active
diffBase: a80f06b17246ecc4010570b51fcdd038e822a913
title: 关键产品关系端点约束与架构收敛最终复验
type: task
intent: 拒绝已知概念之间语义错误的关系组合，复用既有owner行为测试和原架构门禁，在一个干净候选上复验并收口剩余节点。
requiredRules:
  - contract-first-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
  - disk-temp-policy
ownedPaths:
  - shared/product-semantics.ts
  - scripts/check-evidence-refs.mjs
  - tests/unit/product-semantics.test.ts
  - tests/unit/evidence-refs-exist.test.ts
  - harness/specs/fixtures/ontology-lite-existing-contracts/negatives/**
  - harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures/**
  - harness/specs/fixtures/architecture-convergence-final/**
  - harness/specs/tasks/architecture-convergence-final-verification.md
  - docs/clawx-product-semantics.md
  - docs/dev/architecture-skeleton/CONTRACT-HARDENING.md
  - docs/dev/architecture-skeleton/CHARTER.md
  - .gitattributes
requiredTests:
  - pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts tests/unit/semantic-authority-consistency.test.ts tests/unit/contract-check.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/task-loop-controller.test.ts tests/unit/routing-memo.test.ts tests/unit/orchestration-plan-ledger-projection.test.ts tests/unit/task-loop-upgrade.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/task-ledger-reference-inheritance.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/architecture-small-cycles.test.ts tests/unit/architecture-runtime-cycles.test.ts tests/unit/context-engine-registry-default-on.test.ts tests/unit/architecture-authority-convergence.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm contract:check
  - node scripts/check-semantic-authority.mjs
  - node scripts/check-evidence-refs.mjs
  - pnpm run runtime:source:check
  - pnpm repo:artifacts:check
  - pnpm harness validate --spec harness/specs/tasks/architecture-convergence-final-verification.md
  - git diff --check
acceptance:
  - 五种关系kind的domain/range只允许既有六条语义形状，合法词表中的错误端点也拒绝；原关系/执行owner/权限/默认值保持。
  - 纯validator、原证据checker真实入口和校验器失效探针都覆盖新规则；六条合法关系通过，来源篡改、候选变化与无效版本继续拒绝。旧封存证据不改写。
  - 同一干净候选运行完整架构专项集合与所列owner行为集合、类型、契约、authority、证据report/verify、lint、comms、两侧静态图、runtime source六个子门禁。完整source继承LOC失败保留原exit1并与基线比较，不放宽门禁。
  - 重新注入旧IPC写法、旧权威声明、错误关系和失效证据仍被拒绝。基线失败、当前通过和未测范围明确；报告覆盖前四叶来源与当前代码一致性。
  - 保留候选commit/tree、逐项命令/退出码/计数、SHA256SUMS、零凭据命中，CHARTER/任务图/最终报告一致。全部满足后关闭TF-0791、TF-0786、TF-0628。
nonGoals:
  - 不新增概念、运行owner、通用推理引擎、存储、权限、默认开关或产品路径。
  - 不接受全产品/全runtime构建、全仓所有测试、Electron或live provider效果；专项全量指此spec列出的完整测试文件集合，不是pnpm test全仓。
  - 不承诺未测的维护成本、任务成功率或运行性能收益，不宣称GA。
docs:
  required: true
  files:
    - docs/clawx-product-semantics.md
    - docs/dev/architecture-skeleton/CONTRACT-HARDENING.md
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: not-required
---

TF-0791为TF-0786末叶。沿用gateway-backend-communication的分层边界，静态语义检查不成为运行准入。
本次追加relation-endpoint-mismatch规则；现有v1形状、六条关系和应用行为不变，报告的封闭规则集合随之增加一项。
旧证据不重签；旧规则列表的报告在当前checker下invalid。
