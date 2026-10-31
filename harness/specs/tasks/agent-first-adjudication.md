---
lifecycleStatus: active
id: agent-first-adjudication
title: Agent First 独立 agent 裁决、证据包与跨会话恢复
intent: 完成 TF-0595，在不同 actor/worktree 中重算 TF-0592/0593/0594 的磁盘证据，输出分维度 verdict、残余和下一 gate，并支持新会话仅凭证据包复核。
diffBase: ce7980c3b
touchedAreas:
  - harness/specs/tasks/agent-first-adjudication.md
  - scripts/agent-first-adjudicate.mjs
  - scripts/agent-first-adjudicate.d.mts
  - tests/unit/agent-first-adjudication.test.ts
  - harness/specs/fixtures/agent-first-system/adjudication/**
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/agent-first-adjudication.test.ts --maxWorkers=1
  - node scripts/agent-first-adjudicate.mjs verify --plan harness/specs/fixtures/agent-first-system/adjudication/plan.v1.json --report harness/specs/fixtures/agent-first-system/adjudication/review.json --actor codex/adjudicator-verifier --out D:/tmp/agent-first-tf0595/verify.json
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/agent-first-adjudication.md
  - git diff --check
acceptance:
  - Plan/executor/reviewer/verifier 使用不同 actor 和不同输出目录；review 与 verify 在不同 checkout 中重放同一磁盘证据。
  - Reviewer 重算 plan/artifact hashes、candidate tree、trial/control/rubric/operational 计数，并检查 source closure、negative controls、freshness 和 residuals；不能信任已有 report 字段。
  - 缺失、hash 变化、同 actor、product-runtime drift、篡改 report、无 recovery 或 unexpected skip 均判 fail/invalid，不产生 release approval。
  - 报告分别给出 source/engineering/runtime/effect/distribution/operational/agentQuality/releaseApproval，并明确下一未完成 gate。
  - 新 agent 仅凭 plan、report、verification 和候选 commit 即可复算；不依赖聊天记忆、私有原始路径或未声明的本地状态。
  - report/verification 标 driven_by=agent，realHuman/releaseApproved/distributionApproved 为 false；residual 有 owner/reviewBy。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-adjudication.md
readmeUpdates: not-required
expectedUserBehavior:
  - 新会话能定位当前是 engineering stale、distribution not-run 还是 live quality 未测，并给出下一条可执行 gate。
  - 裁决不把 source、scripted agent quality、distribution 或 release approval 混为一个绿色总分。
---
# TF-0595

`plan.v1.json` 固定候选、actor 分工和必需证据哈希。`review` 在当前 checkout 重算证据并写分维度 report；`verify` 在第二个 checkout 从磁盘重放相同计算，比较 report 的 dimensions/residuals/verdict/nextGate。评审输出到独立目录，不使用先前的聊天上下文。

当前证据包含 TF-0592/0593 的 evaluation-system-only source closure：执行试验绑定在更早的 runtime/evidence commit，之后的差异只位于 `harness/`、`scripts/`、`tests/`，没有产品运行时代码变化。该 closure 在 report 中显式记录；product-runtime drift 仍 fail closed。