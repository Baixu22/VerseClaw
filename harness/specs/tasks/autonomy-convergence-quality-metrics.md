---
id: autonomy-convergence-quality-metrics
title: TF-0892 / V2a 交付收敛质量量化度量套件（最优率、浪费率、冗余度与收敛曲线）
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 作为 TF-0689 的前置度量子叶，基于逆向归因链、求解器基线与形式化核验回执实现离线纯函数收敛质量度量，量化方案最优率、资源浪费率、步骤冗余度与迭代收敛曲线。
requiredRules:
  - agent-engineering-acceptance-boundary
  - paired-ablation-boundary
  - trace-cost-sampling-boundary
  - autonomy-object-owner-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - portable-spec-commands
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 自治评测报告除终态通过率外，同时给出方案可行率 vs 最优率、第 1..K 轮累积收敛曲线、无效重试与废写集资源浪费率以及无因果贡献的步骤冗余度。
  - 高成本反复试错后勉强通过的候选在浪费率与收敛斜率维度被明确区分和告警，不会与一次精准收敛候选混同为同质绿灯。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-convergence-quality-metrics.md
  - shared/task-system/convergence-quality-metrics.ts
  - openclaw_runtime/src/observability/decision-quality-auditor.ts
  - openclaw_runtime/src/observability/scorecard.ts
  - scripts/evaluate-convergence-quality.mjs
  - scripts/agent-engineering-acceptance.mjs
  - scripts/runtime-effectiveness.mjs
  - tests/unit/autonomy-convergence-quality-metrics.test.ts
  - harness/specs/fixtures/autonomous-project-system/v2a/**
  - docs/modules/resources-and-observability.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-convergence-quality-metrics.test.ts tests/unit/decision-quality-auditor.test.ts tests/unit/a4-decision-quality-dev-tool.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-convergence-quality-metrics.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-convergence-quality-metrics.md --dry-run
  - git diff --check
acceptance:
  - 度量计算保持离线纯函数边界，不介入在线生产 turn 热路径，不充当运行时动态权限门禁。
  - 基于固定基准样本可复算输出四组核心指标：可行率与最优率（对标 COMPASS 口径）、迭代轮次至累积成功率曲线、废写集/被弃代资源浪费率、无因果贡献步骤冗余度，每项均含明确分母与 unknown 单列统计。
  - 已知高冗余/高重试负控样本即使终态验收通过，也必须在浪费率与冗余度门禁上触发明确劣化诊断，禁止单一平均分掩盖分项退化。
  - 报告严格区分确定性重放样本与真实在线模型样本，小样本禁止外推宣称系统级 GA，全部产物标 driven_by:agent。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/resources-and-observability.md
---

# TF-0892 / V2a 收敛质量量化度量套件规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0892 / V2a`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0891`、`TF-0888`、`TF-0889`，并挂入既有 `TF-0689`（`V2`）作为长程自治质量实证的统计底座。
- **既有路径复用**：`openclaw_runtime/src/observability/decision-quality-auditor.ts`、`openclaw_runtime/src/observability/scorecard.ts`、`scripts/agent-engineering-acceptance.mjs`、`scripts/runtime-effectiveness.mjs`、`harness/specs/guides/agent-first-acceptance.md`、`docs/runtime-design/development-manual.md`（严守 §1.2 A4 离线纯函数边界）。
- **拟新增路径**：`shared/task-system/convergence-quality-metrics.ts`（拟新增）、`scripts/evaluate-convergence-quality.mjs`（拟新增）、`tests/unit/autonomy-convergence-quality-metrics.test.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/v2a/**`（拟新增）。
- **回退策略**：回退新增收敛质量评估脚本与报告字段，保留既有 `AgentFirst` 与 `decision-quality-auditor` 基础计分能力不变。
