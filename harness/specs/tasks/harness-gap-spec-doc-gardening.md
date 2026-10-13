---
lifecycleStatus: completed
id: harness-gap-spec-doc-gardening
title: 精简规范入口并防止文档僵化（G02）
scenario: backend-communication-boundary
taskType: harness-governance
intent: G02 把「规范可维护」变成可执行门禁：每个 task spec 带 lifecycleStatus（active/completed/archived，退役走归档不机械删除）；文档引用必须可解析；AGENTS.md 保持轻量路由入口（<=400 行）不堆成规范仓库；新增单一 doc-gardening 规则，不复制平行清单。
touchedAreas:
  - harness/specs/rules/spec-doc-gardening-boundary.md
  - tests/unit/spec-doc-gardening.test.ts
  - harness/specs/tasks/harness-gap-spec-doc-gardening.md
  - docs/dev/harness-gap-closure/g02-spec-doc-gardening.md
  - docs/dev/harness-gap-closure/g02-acceptance.json
  - docs/dev/harness-gap-closure/G02-SHA256SUMS
  - harness/specs/tasks/harness-gap-browser-effect-boundary.md
  - harness/specs/tasks/harness-gap-checkpoint-attachment-binding.md
  - harness/specs/tasks/harness-gap-context-pressure-recovery.md
  - harness/specs/tasks/harness-gap-credential-use-boundary.md
  - harness/specs/tasks/harness-gap-envelope-reject.md
  - harness/specs/tasks/harness-gap-error-recovery-next-action.md
  - harness/specs/tasks/harness-gap-external-write-boundary.md
  - harness/specs/tasks/harness-gap-hot-file-write-owner.md
  - harness/specs/tasks/harness-gap-in-run-steering.md
  - harness/specs/tasks/harness-gap-memory-effect-receipt.md
  - harness/specs/tasks/harness-gap-paired-ablation.md
  - harness/specs/tasks/harness-gap-rate-circuit-breaker.md
  - harness/specs/tasks/harness-gap-reliability-aggregation.md
  - harness/specs/tasks/harness-gap-sink-ledger.md
  - harness/specs/tasks/harness-gap-trace-cost-sampling.md
  - harness/specs/tasks/harness-gap-verifier-completion-verdict.md
  - harness/specs/tasks/harness-gap-working-context-single-source.md
ownedPaths:
  - harness/specs/rules/spec-doc-gardening-boundary.md
  - tests/unit/spec-doc-gardening.test.ts
  - harness/specs/tasks/harness-gap-spec-doc-gardening.md
  - docs/dev/harness-gap-closure/g02-spec-doc-gardening.md
  - docs/dev/harness-gap-closure/g02-acceptance.json
  - docs/dev/harness-gap-closure/G02-SHA256SUMS
  - harness/specs/tasks/harness-gap-browser-effect-boundary.md
  - harness/specs/tasks/harness-gap-checkpoint-attachment-binding.md
  - harness/specs/tasks/harness-gap-context-pressure-recovery.md
  - harness/specs/tasks/harness-gap-credential-use-boundary.md
  - harness/specs/tasks/harness-gap-envelope-reject.md
  - harness/specs/tasks/harness-gap-error-recovery-next-action.md
  - harness/specs/tasks/harness-gap-external-write-boundary.md
  - harness/specs/tasks/harness-gap-hot-file-write-owner.md
  - harness/specs/tasks/harness-gap-in-run-steering.md
  - harness/specs/tasks/harness-gap-memory-effect-receipt.md
  - harness/specs/tasks/harness-gap-paired-ablation.md
  - harness/specs/tasks/harness-gap-rate-circuit-breaker.md
  - harness/specs/tasks/harness-gap-reliability-aggregation.md
  - harness/specs/tasks/harness-gap-sink-ledger.md
  - harness/specs/tasks/harness-gap-trace-cost-sampling.md
  - harness/specs/tasks/harness-gap-verifier-completion-verdict.md
  - harness/specs/tasks/harness-gap-working-context-single-source.md
requiredProfiles:
  - fast
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - spec-doc-gardening-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/spec-doc-gardening.test.ts
  - node scripts/check-spec-lifecycle.mjs
acceptance:
  - 每个 harness/specs/tasks 下的 task spec 带 lifecycleStatus（active|completed|archived）；缺失/非法由 `node scripts/check-spec-lifecycle.mjs` 失败。
  - 退役规范走 archived 归档，不机械删除；不改产品默认/规则/源码保留。
  - 文档引用可解析：`node scripts/validate-policy-docs.mjs` 与 `check-error-governance.mjs` 仍 PASS。
  - AGENTS.md 保持轻量路由入口（<=400 行）并指向 harness/specs 作为规范归属，不复制平行清单。
  - 只有一条 doc-gardening 规则且命名可执行检查（check-spec-lifecycle.mjs）；不新建第二份规范 source of truth。
  - 干净候选定向测试、harness validate/dry-run 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能用一条命令看到规范生命周期是否合规；文档/规范退役走归档而非删除；AGENTS.md 仍是可读入口。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/g02-spec-doc-gardening.md
---

# G02 冻结实施边界

G02 把规范园艺做成可执行门禁而非文本：`check-spec-lifecycle.mjs` 要求每个 task spec 带 lifecycleStatus；`validate-policy-docs.mjs`/`check-error-governance.mjs` 保持文档引用与单一 envelope；新增唯一 `spec-doc-gardening-boundary` 规则；AGENTS.md 保持 <=400 行路由入口。退役优先 archived，不机械删除，不改产品默认/锁。
