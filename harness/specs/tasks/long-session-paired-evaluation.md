---
lifecycleStatus: completed
id: long-session-paired-evaluation
title: 配对评测长期连续性的保真度、时延与费用
program: long-session-development-20261022
taskKey: D2
phase: D
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 以固定任务证明长期策略的效益，避免只用 token 曲线或摘要看起来合理就推广。
contractIndex: harness/specs/tasks/long-session-development-plan.md
diffBase: 333d7ca846ff116da9f7419059cc7ad38776dd17
dependsOnTasks:
  - D1
touchedAreas:
  - harness/specs/tasks/long-session-paired-evaluation.md
  - harness/specs/tasks/long-session-development-plan.md
  - scripts/context-compression-eval-runner.mjs
  - scripts/long-session-paired-evaluation.mjs
  - shared/long-session-paired-evaluation.ts
  - package.json
  - openclaw_runtime/src/context-engine/exploration/soft-threshold.ts
  - openclaw_runtime/src/context-engine/exploration/segment-summary-ledger.ts
  - openclaw_runtime/src/context-engine/exploration/value-pruning.ts
  - tests/unit/context-lifecycle-boundary.test.ts
  - tests/unit/context-lifecycle-soft-threshold.test.ts
  - tests/unit/context-lifecycle-value-pruning.test.ts
  - tests/unit/context-lifecycle-segment-ledger.test.ts
  - tests/unit/long-session-paired-evaluation.test.ts
  - tests/e2e/long-session-paired-evaluation.spec.ts
  - harness/specs/fixtures/long-session-development/d2/**
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - context-family-boundary
  - context-runtime-kit-boundary
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 以固定任务证明长期策略的效益，避免只用 token 曲线或摘要看起来合理就推广。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/long-session-paired-evaluation.spec.ts
  - pnpm exec vitest run tests/unit/context-lifecycle-boundary.test.ts tests/unit/context-lifecycle-soft-threshold.test.ts tests/unit/context-lifecycle-value-pruning.test.ts tests/unit/context-lifecycle-segment-ledger.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-paired-evaluation.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm long-session:d2:evidence -- --out harness/specs/fixtures/long-session-development/d2
  - pnpm long-session:d2:evidence:check
  - pnpm harness validate --spec harness/specs/tasks/long-session-paired-evaluation.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-paired-evaluation.test.ts
  - tests/e2e/long-session-paired-evaluation.spec.ts
acceptance:
  - 评测前冻结不少于 30 对 agent 驱动工作负载、must-preserve 事实和指标预算，覆盖压缩/交接/分叉/重启/撤销；baseline 与最多一个初筛候选使用相同输入和模型参数。
  - 关键事实保真目标 100%、错误任务完成声明 0、下一步正确率目标至少 95%；记录真实 token/cache/cost 与 first-token/wall-clock P50/P95，不用字符估算冒充费用。
  - 候选推广目标为费用或输入 token 净减少至少 15%、P95 时延不超过 baseline 1.10 倍且安全零回归；阈值调整仅能在评测前按新提案固定。
  - 无获授权的 live provider/充分质量或成本样本时，产物明确 evidenceInsufficient/NO-GO 并完成决策输入；不得用 simulated-provider 数据推广正式默认。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**D2 · 配对评测长期连续性的保真度、时延与费用**

以固定任务证明长期策略的效益，避免只用 token 曲线或摘要看起来合理就推广。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段四：保持上下文连续性并评测策略。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- D1：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-paired-evaluation.md`。

**实现和核验入口**

- scripts/context-compression-eval-runner.mjs
- openclaw_runtime/src/context-engine/exploration/soft-threshold.ts
- openclaw_runtime/src/context-engine/exploration/segment-summary-ledger.ts
- openclaw_runtime/src/context-engine/exploration/value-pruning.ts
- tests/unit/context-lifecycle-boundary.test.ts
- tests/unit/context-lifecycle-soft-threshold.test.ts
- tests/unit/context-lifecycle-value-pruning.test.ts
- tests/unit/context-lifecycle-segment-ledger.test.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 评测前冻结不少于 30 对 agent 驱动工作负载、must-preserve 事实和指标预算，覆盖压缩/交接/分叉/重启/撤销；baseline 与最多一个初筛候选使用相同输入和模型参数。
2. 关键事实保真目标 100%、错误任务完成声明 0、下一步正确率目标至少 95%；记录真实 token/cache/cost 与 first-token/wall-clock P50/P95，不用字符估算冒充费用。
3. 候选推广目标为费用或输入 token 净减少至少 15%、P95 时延不超过 baseline 1.10 倍且安全零回归；阈值调整仅能在评测前按新提案固定。
4. 无获授权的 live provider/充分质量或成本样本时，产物明确 evidenceInsufficient/NO-GO 并完成决策输入；不得用 simulated-provider 数据推广正式默认。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/context-lifecycle-boundary.test.ts tests/unit/context-lifecycle-soft-threshold.test.ts tests/unit/context-lifecycle-value-pruning.test.ts tests/unit/context-lifecycle-segment-ledger.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-paired-evaluation.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-paired-evaluation.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/d2/paired-workload-manifest.json
- harness/specs/fixtures/long-session-development/d2/fidelity-latency-cost-report.json
- harness/specs/fixtures/long-session-development/d2/candidate-decision-inputs.json

另生成同目录 README.md 与 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围；无 live provider 时 token/cache/cost 与 P50/P95 必须为 null 并如实标注未测。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 优先现有 provider 与已授权预算；若确需外部模型/项目，只请求一次资源，随即自动化；不要求所有者给真人数据或手工 verdict。
- TF-0424 历史 NO-GO 不改写；新评测有新 candidate identity，三种探索不默认全做。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

