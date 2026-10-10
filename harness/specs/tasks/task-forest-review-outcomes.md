---
lifecycleStatus: archived
id: task-forest-review-outcomes
title: Task Forest 复核结果收口与遗留类型错误修复
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 按用户明确要求将通过验收的工作标记 done，对未通过项修复并复验，外部真人证据缺失则明确 blocked；修复已发现的八个测试类型错误与 M2 的契约注释缺口，执行 M4 实际 L2 门禁。
ownedPaths:
  - scripts/agent-dev-audit.d.mts
  - scripts/uas-00-evidence-freeze.mjs
  - scripts/dcs-ops-preflight.mjs
  - harness/specs/rules/tf0009-real-canary-authority.md
  - harness/specs/rules/uas-00-evidence-freeze-boundary.md
  - harness/specs/tasks/tf0009-engineering-evidence-audit.md
  - harness/specs/tasks/uas-00-evidence-freeze-governance.md
  - harness/specs/tasks/m2m4-l2-greenline-closeout.md
  - scripts/validate-system-maturity-evidence.mjs
  - tests/unit/system-maturity-evidence-validator.test.ts
  - tests/unit/tf0009-engineering-evidence-audit.test.ts
  - plans/system-maturity/INDEX.md
  - plans/system-maturity/phase6-supply-release/**
  - artifacts/system-maturity/P6-005/STATUS.md
  - plans/system-maturity/*/tasks/*.delivery.md
  - tests/unit/runtime-memory-locomo-full-500.test.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/summary-contract.ts
  - docs/dev/context-moat/DEV-PROTOCOL.md
  - docs/dev/context-moat/GATE-BASELINE.md
  - docs/dev/context-moat/reviews/review-outcomes-20260910.md
  - docs/dev/context-moat/reviews/m2m4-closeout-20260911.md
  - docs/dev/context-moat/reviews/revalidation-sec002-gov003-20260910.json
  - artifacts/unblock-pack/tf0127-tf0129-tcorpus.md
  - docs/dev/handoffs/LATEST.md
  - harness/specs/rules/task-review-outcome-boundary.md
  - harness/specs/tasks/task-forest-review-outcomes.md
  - harness/specs/tasks/context-moat-m4-evidence-review.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - scripts/agent-dev-audit.d.mts
  - scripts/uas-00-evidence-freeze.mjs
  - scripts/dcs-ops-preflight.mjs
  - harness/specs/rules/tf0009-real-canary-authority.md
  - harness/specs/rules/uas-00-evidence-freeze-boundary.md
  - harness/specs/tasks/tf0009-engineering-evidence-audit.md
  - harness/specs/tasks/uas-00-evidence-freeze-governance.md
  - harness/specs/tasks/m2m4-l2-greenline-closeout.md
  - scripts/validate-system-maturity-evidence.mjs
  - tests/unit/system-maturity-evidence-validator.test.ts
  - tests/unit/tf0009-engineering-evidence-audit.test.ts
  - plans/system-maturity/INDEX.md
  - plans/system-maturity/phase6-supply-release/**
  - artifacts/system-maturity/P6-005/STATUS.md
  - plans/system-maturity/*/tasks/*.delivery.md
  - tests/unit/runtime-memory-locomo-full-500.test.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/summary-contract.ts
  - docs/dev/context-moat/**
  - artifacts/unblock-pack/tf0127-tf0129-tcorpus.md
  - docs/dev/handoffs/LATEST.md
  - harness/specs/rules/task-review-outcome-boundary.md
  - harness/specs/tasks/task-forest-review-outcomes.md
  - harness/specs/tasks/context-moat-m4-evidence-review.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - 已通过实际验收的决策和修复有 done 结果，不因旧的 review_needed 终态约定停滞。
  - 未通过验收的工程工作进入 in_progress 并修复；不可替代的真人证据缺失明确 blocked。
  - 不改变原始验收条件、生产默认值、预算、真人计数或产品锁，不用状态调整代替技术验收。
  - 已通过的局部修复可作为 done 子任务记录，未通过全局验收的父节点继续保留真实剩余工作。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - task-review-outcome-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - system-maturity-traceability
  - tf0009-real-canary-authority
  - uas-00-evidence-freeze-boundary
humanEvidence: not-required
requiredTests:
  - pnpm run typecheck:test
  - pnpm exec vitest run tests/unit/dcs-prod-flags-catalog.test.ts tests/unit/app-version-rollback.test.ts
  - pnpm exec vitest run tests/unit/agent-dev-regularization.test.ts
  - pnpm exec vitest run tests/unit/system-maturity-evidence-validator.test.ts tests/unit/tf0009-engineering-evidence-audit.test.ts
  - pnpm harness validate --spec harness/specs/tasks/task-forest-review-outcomes.md
acceptance:
  - 八个已知测试类型错误修复后，完整 tests 类型检查实际 exit 0；不通过 any、ts-ignore 或删掉受检文件绕过。
  - M2 契约文件明确解释两个 Key Decisions 段落的不同用途，不改变八段顺序或空内容判据。
  - 已通过决策验收的 TF-0137 写入 done，未通过技术验收的节点不得冒充 done。
  - M4 L2 逐段执行并按冻结失败集合比较，不把未运行或新增失败归为通过。
  - 已绑定的 acceptance-matrix 报告失败时，校验器拒绝 done；P6-005 当前失败报告与 task/delivery/phase 状态一致，原始日志不改写。
  - Task Forest 状态通过 CLI 写入；validate/export 后待复核队列不再承载已经裁定完毕的工作。
docs:
  required: true
  files:
    - docs/dev/context-capability-blueprint.md
    - docs/dev/Sustained-Development-Playbook.md
---

用户本轮明确要求“通过就 done，不通过就处理问题”，覆盖旧协议把已结束的复核长期
保留为 review_needed 的表达方式。技术验收、实际能力、历史证据和产品锁保持原义。
TF-0009 的真人任务不能由 agent 伪造；未完成的真人验收必须保留为阻塞。

README 三语公开流程不变：本任务修正开发验证与任务状态，不增加产品功能或配置。
