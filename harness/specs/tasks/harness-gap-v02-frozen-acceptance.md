---
lifecycleStatus: completed
id: harness-gap-v02-frozen-acceptance
title: 冻结候选并完成独立全链回归验收（V02）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: V02 冻结 harness-gap-closure 收口后的 clean candidate，运行 design.md §3 的正式全门（unit、uncached typecheck、lint、comms、contract、i18n、build、Electron E2E、harness:ci），由 agent 驱动的独立 Verifier 从磁盘原始产物重算，产出不会因实现者自述而放行的 PASS/NO-GO 记录。
touchedAreas:
  - harness/specs/tasks/harness-gap-v02-frozen-acceptance.md
  - harness/specs/tasks/harness-gap-delivery-verdict.md
  - docs/dev/harness-gap-closure/v02-frozen-acceptance.md
  - docs/dev/harness-gap-closure/v02-acceptance.json
  - docs/dev/harness-gap-closure/V02-SHA256SUMS
  - docs/dev/harness-gap-closure/v03-delivery-verdict.md
  - docs/dev/harness-gap-closure/v03-acceptance.json
  - docs/dev/harness-gap-closure/V03-SHA256SUMS
  - tests/unit/harness-gap-v02-acceptance.test.ts
  - .gitignore
  - scripts/repository-artifacts.json
ownedPaths:
  - harness/specs/tasks/harness-gap-v02-frozen-acceptance.md
  - harness/specs/tasks/harness-gap-delivery-verdict.md
  - docs/dev/harness-gap-closure/v02-frozen-acceptance.md
  - docs/dev/harness-gap-closure/v02-acceptance.json
  - docs/dev/harness-gap-closure/V02-SHA256SUMS
  - docs/dev/harness-gap-closure/v03-delivery-verdict.md
  - docs/dev/harness-gap-closure/v03-acceptance.json
  - docs/dev/harness-gap-closure/V03-SHA256SUMS
  - tests/unit/harness-gap-v02-acceptance.test.ts
  - .gitignore
  - scripts/repository-artifacts.json
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/harness-gap-v02-acceptance.test.ts
acceptance:
  - 冻结 clean candidate 的 commit/tree/lock 摘要，Executor 只从该候选生成原始产物。
  - design.md §3 正式全门逐项有 command/exit/count/timing 与原始结果：pnpm test；pnpm run typecheck（uncached）；定向/正式 lint；comms:replay+compare；contract:check；i18n:lint；build:vite + 完整 Electron E2E；harness:ci。
  - agent 驱动的独立 Verifier 从磁盘原始产物重算关键计数，而非引用实现者结论；记录 actor 与 driven_by。
  - skip/flake/中断/未执行项单列；缺跑不 PASS；诚实标注本地/未执行范围。
  - 产品锁维持 false（live_ready/product_approved/default_on），不发布、不公开、不调用付费 provider。
  - 保留候选身份、命令与 hash 索引，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能从 v02-acceptance.json 与原始产物逐项回读全门结果、候选身份与残余；全门通过即得内部受控验收 PASS，但不构成 GA/发布。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/v02-frozen-acceptance.md
---

# V02 冻结实施边界

V02 不新增产品功能，只冻结 clean candidate 并运行 design.md §3 的正式全门，产出可由独立 Verifier 从磁盘重算的证据。第 4 类预算全门（真实 provider/付费/发布）不在本包范围，明确记为 not-measured；产品锁保持 false。缺跑/中断项单列，不用 focused/缓存/smoke 冒充全门。
