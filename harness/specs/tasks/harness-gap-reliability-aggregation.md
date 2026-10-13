---
lifecycleStatus: completed
id: harness-gap-reliability-aggregation
title: 可靠性聚合与正反样本评测门（pass^k / flake / anchors）
scenario: agent-dev-composable-scenarios
taskType: evaluation-harness
intent: E01 在 Agent Dev benefit 报告里加入确定性的 pass^k、逐 trial 成功率、flake 与正反锚点聚合；缺失/超时/崩溃/skip 显式保留，pass^k 不与 pass@k 混用，不改产品默认或产品锁，不宣称真实模型泛化。
touchedAreas:
  - scripts/agent-dev-benefit-eval.mjs
  - scripts/lib/reliability-aggregation.mjs
  - scripts/lib/reliability-aggregation.d.mts
  - shared/agent-dev/reliability-fixture.json
  - tests/unit/agent-dev-reliability-aggregation.test.ts
  - harness/specs/tasks/harness-gap-reliability-aggregation.md
  - harness/specs/rules/reliability-aggregation-boundary.md
  - docs/dev/harness-gap-closure/e01-reliability-aggregation.md
  - docs/dev/harness-gap-closure/e01-acceptance.json
  - docs/dev/harness-gap-closure/E01-SHA256SUMS
ownedPaths:
  - scripts/agent-dev-benefit-eval.mjs
  - scripts/lib/reliability-aggregation.mjs
  - scripts/lib/reliability-aggregation.d.mts
  - shared/agent-dev/reliability-fixture.json
  - tests/unit/agent-dev-reliability-aggregation.test.ts
  - harness/specs/tasks/harness-gap-reliability-aggregation.md
  - harness/specs/rules/reliability-aggregation-boundary.md
  - docs/dev/harness-gap-closure/e01-reliability-aggregation.md
  - docs/dev/harness-gap-closure/e01-acceptance.json
  - docs/dev/harness-gap-closure/E01-SHA256SUMS
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - agent-dev-conformance-evidence
  - reliability-aggregation-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/agent-dev-reliability-aggregation.test.ts
acceptance:
  - 复用既有 agent-dev benefit 报告与 scenario registry，不新建指标平台；k、minCases、flake 阈值预登记在 fixture。
  - pass^k（全部 k 次通过的完整 case 比例）与 pass@k（至少一次通过）分列，缺失/超时/崩溃/skip 的 case 计为 incomplete、排除出分母并在报告中保留。
  - flake = 首次 trial 失败、后续固定重跑成功的 case 比例；保留首次失败，重试成功不洗掉原门失败；安全必测项 0 skip/0 flake。
  - 正/负锚点：positive 必须全通过、negative 必须全部拒绝；违反即 gate=fail。
  - 完整 case 数低于设计门（k=3、>=20）时 gate=insufficient-sample，绝不以小样本冒充 PASS。
  - 报告同时给出原始分母、pass^k、pass@k、flake、缺失、gate 与原因；fixture 为确定性 oracle 并显式标注，不宣称真实 provider/真人/泛化。
  - 干净候选 fast 门（定向单测、runtime/core 类型、scoped lint、harness validate/dry-run）通过、凭据扫描 0 命中、SHA256SUMS 可回读；已复核 README 四语：本包仅改内部评测报告，无用户可见接口/配置变化，故不改 README，结论写入验收记录。
  - 不改产品默认值、产品锁或 approval 语义；不新增定时 automation。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/e01-reliability-aggregation.md
---

# E01 冻结实施边界

E01 只把可靠性口径接进既有 benefit 报告，复用 `shared/agent-dev/scenarios.ts` 的 scenario 概念，不新建评测平台或持久 store。聚合逻辑放在 `scripts/lib/reliability-aggregation.mjs`（无副作用、可被 runner 与单元测试同时引用），报告只读地消费 `shared/agent-dev/reliability-fixture.json` 这份预登记 fixture。

阈值预登记：k=3、minCases=20、flake<=0.01；安全必测 0 skip/0 flake。fixture 故意很小（4 个完整 case），因此报告必须落在 `insufficient-sample` 而不是 PASS —— 这是诚实缺测，不是失败绕过。

`pass^k` 只统计“全部 k 次通过”的完整 case；`pass@k`（至少一次）单独给出，二者不得混用。任何缺失/超时/崩溃/skip 都应作为 incomplete 保留并排除出 pass^k 分母，不能静默删除。