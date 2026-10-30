---
lifecycleStatus: active
id: agent-first-mainline
title: 接入 Windows 产品验收主链并形成最终候选清单
intent: 完成 TF-0596，把 Agent First 分维度裁决映射到既有 14 个产品验收 gate，保留历史 verdict 和产品锁，输出可复核的最终候选清单与下一 gate。
diffBase: 715b23bea
touchedAreas:
  - harness/specs/tasks/agent-first-mainline.md
  - scripts/agent-first-mainline.mjs
  - scripts/agent-first-mainline.d.mts
  - tests/unit/agent-first-mainline.test.ts
  - harness/specs/fixtures/agent-first-system/mainline/**
  - harness/specs/guides/agent-first-acceptance.md
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/agent-first-mainline.test.ts --maxWorkers=1
  - node scripts/agent-first-mainline.mjs verify --report harness/specs/fixtures/agent-first-system/mainline/candidate-report.v1.json
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/agent-first-mainline.md
  - pnpm repo:artifacts:check
  - git diff --check
acceptance:
  - 14 个矩阵 gate 都有 command、oracle、negative、artifact、skipBudget=0、actor 和当前 status；空字段或缺 gate 使报告失败。
  - 当前候选报告从 TF-0595 adjudication 读取 source/engineering/runtime/effect/distribution/operational/agentQuality/releaseApproval，不把 partial/not-run 涂成 pass。
  - 历史 a0-a5/b1/b2 verdict 以路径和 SHA256 保留为 historical，currentCandidate=false；不重写旧结论。
  - productLocks 与 matrix.lockedBoundaries 完全一致，releaseApproved/liveReady/productApproved/defaultOn 原值保留并单独显示。
  - 最终候选清单明确 verdict=not-release-ready、下一 gate=distribution、residual owner/reviewBy，并可由 checker 从磁盘重建和拒绝篡改。
  - Task Forest validate/export 与文档 contract 一致，未改变发布授权或产品默认值。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-mainline.md
    - harness/specs/guides/agent-first-acceptance.md
readmeUpdates: not-required
expectedUserBehavior:
  - 维护者能一眼看到 14 个阶段中哪些 pass、partial、not-run 或 not-approved，以及下一步是 packaged distribution。
  - 旧产品验收 verdict 仍有哈希和原候选边界，不会被本次 Agent First 证据覆盖。
---
# TF-0596

`candidate-report.v1.json` is rebuilt from the sealed matrix, the independent adjudication report and the historical product-acceptance artifacts. It is a candidate/readiness report, not a release action. The 14 phases are kept in matrix order; each row carries the matrix command/oracle/negative/evidence/actor plus an artifact, zero skip budget and the current dimension status.

`D1` remains `not-run` because no win-unpacked artifact was executed. `G1` remains `not-approved`; all product locks stay false. The report therefore returns `not-release-ready` and points to packaged distribution as the next gate.
