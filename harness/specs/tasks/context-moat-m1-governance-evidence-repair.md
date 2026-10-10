---
lifecycleStatus: archived
id: context-moat-m1-governance-evidence-repair
title: 修复 TF-0108 的 P2-005 治理证据失配并裁定收口范围
scenario: system-maturity-traceability
taskType: program-governance
intent: 修复已归因于本轮的 P2-005 证据路径与状态失配，移除错误的轮外豁免，并落实其必要修复的受限收口裁定。
touchedAreas:
  - plans/system-maturity/phase2-authorization-isolation/STATUS.json
  - plans/system-maturity/phase2-authorization-isolation/tasks/P2-005.md
  - plans/system-maturity/phase2-authorization-isolation/tasks/P2-005.delivery.md
  - plans/system-maturity/phase2-authorization-isolation/tasks/P2-001.delivery.md
  - plans/system-maturity/phase2-authorization-isolation/tasks/P2-002.delivery.md
  - plans/system-maturity/phase2-authorization-isolation/tasks/P2-003.delivery.md
  - plans/system-maturity/phase7-continuous-governance/tasks/P7-004.delivery.md
  - plans/system-maturity/phase8-residual-closure/tasks/P8-001.delivery.md
  - plans/system-maturity/phase8-residual-closure/tasks/P8-004.delivery.md
  - plans/system-maturity/INDEX.md
  - docs/dev/context-moat/DEV-PROTOCOL.md
  - docs/dev/context-moat/GATE-BASELINE.md
  - docs/dev/context-moat/reviews/TF-0108.md
  - tests/unit/system-maturity-findings-registry.test.ts
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
  - harness/specs/tasks/context-moat-m1-governance-evidence-repair.md
expectedUserBehavior:
  - P2-005 保留 API 级历史证据；生产工具执行边界未经验证时，任务及所属阶段不得声称完成。
requiredProfiles:
  - fast
requiredRules:
  - system-maturity-traceability
requiredTests:
  - tests/unit/system-maturity-evidence-validator.test.ts
  - tests/unit/system-maturity-traceability-p7-001.test.ts
  - tests/unit/system-maturity-findings-registry.test.ts
acceptance:
  - P2-005 的任务状态、delivery、验收复选框、阶段状态和 INDEX 一致，且使用既有状态枚举。
  - EVIDENCE 只包含可解析且哈希有效的历史证据路径；说明文字不冒充路径。
  - 三项 P2-005 失配从轮外台账移除，归因和修复可追溯，25 项既有哈希基线不被重刷。
  - 只更新由本次 STATUS.json 与 INDEX.md 更正导致的六条派生哈希引用，不重刷其他证据。
  - 在隔离工作树逐段运行 maturity 七门，比较修复前后失败集合；保留历史 artifacts 和默认值。
  - 本次收口范围、半径及总量门采用 DEV-PROTOCOL.md §R3.6.1 的封闭路径与生效条件；范围外路径即使未超过数值上限也不得放行。
  - 范围裁定只解除本项已明确处理的治理阻塞，不能代替最终提交的完整 L2 与正式独立会签；TF-0137 保持合法 landed-unwired 状态。
docs:
  required: false
---

归属 TF-0108。修复依据为其独立审核记录中的本轮回归判定；不扩展 CVK 执行能力，也不把历史 API 测试提升为生产硬阻断证据。
