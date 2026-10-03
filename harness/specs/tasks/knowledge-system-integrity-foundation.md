---
id: knowledge-system-integrity-foundation
title: Knowledge system KS-00 baseline and authority freeze
taskType: architecture-freeze
intent: Establish one executable authority baseline for the unified knowledge system, reconcile dirty worktree evidence with the written architecture, and freeze the contracts and serial execution boundary before implementation packages proceed.
ownedPaths:
  - WORKTREE.md
  - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
  - docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/handoffs/KS-04-06-DEVELOPMENT-PROMPT.md
  - harness/specs/tasks/knowledge-system-integrity-foundation.md
  - harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md
  - harness/specs/tasks/knowledge-system-ks02-experience-session-truth.md
  - harness/specs/tasks/knowledge-system-ks03-governance-store-adapters.md
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
touchedAreas:
  - docs/dev/knowledge-system-unification/**
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/handoffs/KS-04-06-DEVELOPMENT-PROMPT.md
  - harness/specs/tasks/knowledge-system-*.md
  - WORKTREE.md
  - .agent-workbench/task-forest/proposals/TFP-knowledge-system-unification-20260817.json
expectedUserBehavior:
  - A developer can identify one primary plan, one active package, and the exact next command without consulting chat history.
  - The authority matrix names one canonical owner and one write boundary for Wiki, Memory, SEKB, DCS, compilation, provider output, and effects.
  - Dirty implementation changes are labelled WIP/unverified and are not silently counted as accepted package evidence.
  - KS-01, KS-02, and KS-03 have separate executable task specifications with explicit dependencies and acceptance gates.
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/knowledge-system-integrity-foundation.md
  - pnpm harness validate --no-diff --spec harness/specs/tasks/knowledge-system-integrity-foundation.md
  - git diff --check
acceptance:
  - one-plan-entrypoint: The tracked development plan and authority ADR define the same serial KS-00..KS-09 route; local WORKTREE.md is optional historical context, not a checkout prerequisite.
  - authority-matrix-frozen: ADR and plan agree on canonical owners, write boundaries, and product locks.
  - artifact-contract-frozen: ContextRef/v1, GovernanceProposal/v1, CompilationSnapshot, PromptPlan, RequestEnvelope, CapabilityGrant, and EffectReceipt are named consistently.
  - dirty-wip-labelled: baseline evidence lists relevant concurrent WIP and explicitly separates implementation from verified evidence.
  - task-spec-boundary: KS-01, KS-02, and KS-03 are the only executable implementation specs for the first serial slice.
  - no-new-authority: the plan does not introduce a new database, sidecar, vector store, provider, memory writer, or context authority.
docs:
  required: true
  files:
    - docs/dev/knowledge-system-unification-development-plan.zh-CN.md
    - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
    - docs/dev/repository-artifact-retention.md
---

# KS-00：基线与权威冻结

## 用途

这是统一知识系统的基线规格，不是 KS-01 的替代实现卡。它只负责把审计结论、权威矩阵、契约、状态源和串行边界冻结下来。

## 执行顺序

1. 审阅 `D:\ClawX` 与本工作树的 dirty diff，并在 `KS-00-BASELINE-DIFF.md` 记录移植、保留或拒绝理由。
2. 审阅 ADR、总规划和 `runtime-convergence/STATUS.md`；把“已决定”“已实现”“已验证”分开记录。
3. 运行本规格的 `context` 与 `--no-diff validate`。
4. 仅在 Task Forest proposal 经用户确认并应用后，把 KS-00 置为唯一 `ready` 节点。
5. KS-00 通过后，才启动 `knowledge-system-ks01-review-bundle-integrity.md`。

## 明确不做

- 不在 KS-00 新增生产代码、数据库、sidecar、向量索引或第二套 authority。
- 不把共享 worktree 中未审阅的 WIP 当作任何 KS 包的完成证据。
- 不修改 `default-off`、`liveReady=false`、`productApproved=false` 或 `defaultOn=false`。
- 不把 Task Forest 的候选路线写入 canonical graph；必须走 CLI proposal-save/proposal-apply 流程。

## 输出

- 总规划：`docs/dev/knowledge-system-unification-development-plan.zh-CN.md`
- 权威 ADR：`docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md`
- 差异证据：`docs/dev/knowledge-system-unification/evidence/KS-00-BASELINE-DIFF.md`
- 下一执行卡：`harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md`
