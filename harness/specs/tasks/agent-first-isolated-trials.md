---
lifecycleStatus: active
id: agent-first-isolated-trials
title: Agent First 隔离重复执行、资源绑定和磁盘统计回读
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 完成 TF-0592 的执行部分，复用 TF-0590 冻结任务、QA Runtime 与统计仪器，让实际 trial、终态断言、资源与失败分类可保存和独立重算。
diffBase: b9abfe08a6a13b39bc106d95be8b1710c2c86afe
touchedAreas:
  - harness/specs/tasks/agent-first-isolated-trials.md
  - scripts/agent-first-trials.mjs
  - scripts/agent-first-trials.d.mts
  - scripts/lib/agent-first-trial-worker.mjs
  - scripts/lib/agent-first-trials.mjs
  - scripts/lib/agent-first-trials.d.mts
  - tests/unit/agent-first-trials.test.ts
  - openclaw_runtime/extensions/qa-lab/src/scenario-flow-runner.ts
  - openclaw_runtime/extensions/qa-lab/src/suite.ts
  - openclaw_runtime/extensions/qa-lab/api.ts
  - harness/specs/fixtures/agent-first-system/trials/**
  - harness/specs/fixtures/agent-first-system/trial-adapters.v1.json
  - openclaw_runtime/extensions/qa-lab/src/scenario-flow-runner.test.ts
  - openclaw_runtime/test/tsconfig/tsconfig.qa-lab.test.json
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - disk-temp-policy
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/agent-first-trials.test.ts tests/unit/rsi-tf0592-statistical-adjudication.test.ts tests/unit/agent-first-task-corpus.test.ts --maxWorkers=1
  - node scripts/agent-first-trials.mjs check --run-dir harness/specs/fixtures/agent-first-system/trials --retained
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-qa.config.ts extensions/qa-lab/src/scenario-flow-runner.test.ts extensions/qa-lab/src/suite-startup.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/agent-first-isolated-trials.md
acceptance:
  - 注册的冻结任务经过真实执行，每个 arm/task/repeat 唯一，k=3，完整案例至少20项；未跑和失败 trial 都保留。
  - manifest 绑定干净候选、产品源码与构建来源、语料和 grader 摘要、model/provider/tools、资源 floor/ceiling、网络、并发、timeout/retry/seeds。
  - 每个 trial 使用空且独立的 home/workspace/cache/temp，不接收前次 Git history；真实 QA Runtime 仅使用脚本 provider，工具工作目录与文件访问限制在隔离 workspace。
  - 每个终态条件来自 QA 内实际执行的观察回调或实际负例判定；叙述、报告和 callback 缺项不能产生 pass。
  - wall/RSS/process 预算可观察且越界使 trial 无效；monitored ceiling 与 native hard cap 如实区分，未执行的强制资源上限不得声称执行。
  - 从磁盘 task/trace/final-state/log/cleanup 重算 pass^k、pass@k、95% CI、配对差异、失败四分类、预算和 insufficient-evidence；不复制 stdout 结论。
  - resume 只能复用 manifest/input/hash 不变且已封存的 trial，篡改/缺项/同 trial 重复/跨目录状态/错误分类都 fail closed。
  - 新的注册适配器接入不改核心；本轮两 arm 是同候选独立重放，不能声称 RSI 改进或模型泛化能力。
expectedUserBehavior:
  - 维护者可以 plan/run/check 同一个不可变执行包，并从进度资料恢复。
  - 结果显示实际完成和未完成任务、失败归属及证据路径，无法用未跑资料替代真实终态。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-isolated-trials.md
readmeUpdates: not-required
---

# TF-0592 执行入口

`node scripts/agent-first-trials.mjs plan --run-dir <ignored-dir>` 冻结当前候选和两 arm 的相同脚本 provider 配置。`run` 执行冻结任务；`check` 从磁盘重新计算。原始运行目录用 D:，Electron/低完整性子进程使用项目内 ignored 路径。

资源声明保留主机观测值、单任务 timeout、并发和 RSS 监测。硬内存/cpu 限制没有真实实施凭据时只写为未实施，不把声称的 ceiling 当 kernel containment。失败或未跑记录仍进入失败分类和 incomplete 分布。

QA 可选 `onFlowEvent` 回调只观测实际动作和断言，不替代 executor、oracle 或产品 owner。工具 workspaceOnly 和 config patch 仅用于本 trial 的临时配置，正式产品默认值不变。结果属于源宿主/脚本 provider 的实际控制流；定性模型审查与发布仍属于后续独立节点。
