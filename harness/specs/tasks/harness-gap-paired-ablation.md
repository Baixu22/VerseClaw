---
id: harness-gap-paired-ablation
title: 首次真实生效的单组件配对消融（type-aware eviction vs FIFO）
scenario: agent-dev-composable-scenarios
taskType: evaluation-harness
intent: E02 用一个可逆、非安全的真实组件（Phase-4 type-aware eviction）在真实 RuntimeMemoryStore 上做 baseline vs leave-one-out 的配对消融，给出 pass^k、p50/p95、tokens 代理、误拦截、安全违规、效应量与 95% 区间；零/负效应如实记录，不伪造收益，不改产品默认/锁。
touchedAreas:
  - scripts/lib/paired-ablation.mjs
  - scripts/lib/paired-ablation.d.mts
  - shared/agent-dev/paired-ablation-fixture.json
  - tests/unit/agent-dev-paired-ablation.test.ts
  - tests/unit/runtime-memory-paired-ablation.test.ts
  - harness/specs/tasks/harness-gap-paired-ablation.md
  - harness/specs/rules/paired-ablation-boundary.md
  - docs/dev/harness-gap-closure/e02-paired-ablation.md
  - docs/dev/harness-gap-closure/e02-acceptance.json
  - docs/dev/harness-gap-closure/E02-SHA256SUMS
ownedPaths:
  - scripts/lib/paired-ablation.mjs
  - scripts/lib/paired-ablation.d.mts
  - shared/agent-dev/paired-ablation-fixture.json
  - tests/unit/agent-dev-paired-ablation.test.ts
  - tests/unit/runtime-memory-paired-ablation.test.ts
  - harness/specs/tasks/harness-gap-paired-ablation.md
  - harness/specs/rules/paired-ablation-boundary.md
  - docs/dev/harness-gap-closure/e02-paired-ablation.md
  - docs/dev/harness-gap-closure/e02-acceptance.json
  - docs/dev/harness-gap-closure/E02-SHA256SUMS
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - agent-dev-conformance-evidence
  - paired-ablation-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/agent-dev-paired-ablation.test.ts
  - tests/unit/runtime-memory-paired-ablation.test.ts
acceptance:
  - 选一个可逆、非安全、opt-in 的真实组件：Phase-4 type-aware eviction（treatment）对前 Phase-4 FIFO（baseline / leave-one-out），生产消费者为真实 RuntimeMemoryStore。
  - 先验证组件生效 / 移除痕迹：baseline 与 treatment 的保留/淘汰集合至少在一处不同。
  - 语料为确定性本地 fixture（无真实 provider）：>=20 case x 3 重复 x 2 条件，配对 seed，隔离 store，逐 case 固定插入顺序。
  - 报告同时给出成功、pass^k（复用 E01 口径）、p50/p95 延迟、tokens 代理、误拦截、安全违规、效应量与 95% 区间；主指标与退化预算在 fixture 预登记。
  - 零/负效应是有效结果，不得事后挑赢家；组件有益也仅用于内部报告，不改产品默认、产品锁或 approval。
  - 干净候选定向单测与 runtime/core 类型、scoped lint、harness validate/dry-run 通过，凭据扫描 0 命中，SHA256SUMS 可回读；已复核 README 四语：本包仅内部评测，无用户可见变化，故不改。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/e02-paired-ablation.md
---

# E02 冻结实施边界

E02 只在真实 RuntimeMemoryStore 上做一次受控配对消融，复用 O02/E01 已确立的观测与可靠性口径（pass^k 复用 `scripts/lib/reliability-aggregation.mjs`）。不新建指标平台、不建持久 store、不引入真实 provider 调用、不改产品默认值/锁。

组件：Phase-4 type-aware eviction（treatment）对前 Phase-4 FIFO（baseline）。二者都是既有代码路径，可逆（只切 evictionPolicy），非安全。主指标 = procedural retention（越高越好），退化预算 = 0；k=3、>=20 case。

效应量与区间在 `scripts/lib/paired-ablation.mjs` 计算：按 (caseId, repeat) 配对，均值差 + 95% 区间（正态近似 z=1.96）、Cohen d_z。判决只允许 component-helps / no-effect / hurts / safety-regression / insufficient-sample，且必须由区间决定，不接受事后挑选。

tokens 用 maxFacts 槽位作显式代理（非真实模型 token），延迟用 `perf_hooks` 实测；无真实 provider、无账单，故不宣称真实成本或泛化。