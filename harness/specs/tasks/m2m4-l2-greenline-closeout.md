---
lifecycleStatus: archived
id: m2m4-l2-greenline-closeout
title: M2/M4 全局 L2 绿线建立与回归修复
scenario: system-maturity-traceability
taskType: program-governance
intent: 在干净候选上执行 L1/L2 全部门禁，实测白名单外失败按 §D4.2/§D4.6 外科研复（本轮引起的失败只能修，不得进任何台账），并如实保留里程碑独立复核与半径裁定等未完成项。
ownedPaths:
  - plans/system-maturity/phase6-supply-release/tasks/P6-005.delivery.md
  - artifacts/system-maturity/P6-005/full-electron-e2e-audit.json
  - docs/dev/context-moat/reviews/review-outcomes-20260910.md
  - docs/dev/handoffs/LATEST.md
  - harness/specs/tasks/m2m4-l2-greenline-closeout.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - plans/system-maturity/phase6-supply-release/tasks/P6-005.delivery.md
  - artifacts/system-maturity/P6-005/**
  - docs/dev/context-moat/reviews/review-outcomes-20260910.md
  - docs/dev/handoffs/LATEST.md
  - harness/specs/tasks/m2m4-l2-greenline-closeout.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - 接力者能用冻结白名单做集合差分，区分“冻结基线”与“本轮新增回归”。
  - 本轮引起的门失败一律修复，不以台账或状态调整绕过。
  - L2 未全绿的父节点不得标记 done；独立复核与半径裁定缺位时明确保留。
requiredProfiles:
  - fast
requiredRules:
  - task-review-outcome-boundary
  - system-maturity-traceability
humanEvidence: not-required
requiredTests:
  - pnpm run typecheck:test
  - pnpm exec vitest run tests/unit/tf0009-engineering-evidence-audit.test.ts
  - node scripts/validate-system-maturity-evidence.mjs
acceptance:
  - L1 六条门 exit 0；L2 五道门失败集 ⊆ GATE-BASELINE 冻结白名单，且 config-schema-parity 不在失败集内。
  - maturity 第 5 段失配集恰为 25 项钉住基线 ∪ 4 项 A2 轮外；第 7 段 ≤ 96；其余五段 exit 0。
  - P6-005 交付 EVIDENCE 哈希与实际 artifact 一致，被移走的审计文件按原字节恢复；不改 artifact 内容。
  - TF-0009 按 2026-09-27 政策与更新后的 R7/R2 接受具名 agent 证据收口；历史报告与真人零计数保留，不再因缺真人而 blocked。
  - 里程碑独立复核与 §R3.6 半径裁定缺位时，TF-0115/TF-0127 保持 in_progress，不冒充 done。
docs:
  required: true
  files:
    - docs/dev/context-capability-blueprint.md
    - docs/dev/Sustained-Development-Playbook.md
---

本任务为治理与门禁复核：不改运行时代码、配置默认值、产品锁、预算或历史 artifact 内容。
maturity 门一律在 `git worktree add --detach` 隔离树内运行，共享树 `artifacts/system-maturity`
全程不被写入。README 三语无公开流程变化。
