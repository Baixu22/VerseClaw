---
id: harness-gap-verifier-completion-verdict
title: 受限且可撤销的 verifier 完成裁决入口（S07）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S07 给 evidence verifier 一个受限、可撤销的完成裁决入口：复用既有 evaluateEvidenceVerifier，只对授权范围内的指定 task 产出 digest-only verdict，approved 才产生唯一 node->done 状态转换，且可从记录的 prior status 撤销。verdict 不授予发布/产品锁权限，也不是第二套权限层。
touchedAreas:
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.test.ts
  - harness/specs/tasks/harness-gap-verifier-completion-verdict.md
  - docs/dev/harness-gap-closure/s07-verifier-completion-verdict.md
  - docs/dev/harness-gap-closure/s07-acceptance.json
  - docs/dev/harness-gap-closure/S07-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.test.ts
  - harness/specs/tasks/harness-gap-verifier-completion-verdict.md
  - docs/dev/harness-gap-closure/s07-verifier-completion-verdict.md
  - docs/dev/harness-gap-closure/s07-acceptance.json
  - docs/dev/harness-gap-closure/S07-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.test.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier.test.ts
acceptance:
  - 复用既有 evaluateEvidenceVerifier 产出裁决：completed->approved，insufficient_evidence->insufficient-evidence，其它->rejected；不新建第二套 verifier 权限层。
  - 受限（bounded）：只对 scope.taskIds 内的 task 产出 verdict；范围外一律 out-of-scope 且不产生状态转换。
  - 唯一状态转换：仅 approved 产生 node->done；其它 verdict 一律不转换。verdict 记录 digest-only（taskId/verdict/evidenceDigest/findingCodes/priorStatus），不含原始证据内容。
  - 可撤销（revocable）：approved 记录 priorStatus，撤销返回 from=done,to=priorStatus；非 approved 无可撤销内容。
  - 能力边界：verdict 绝不授予发布/产品锁/释放权限（记录显式 grantsPublish=false / grantsProductLock=false）。
  - 确定性/可重放：同一证据得到相同 evidenceDigest 与相同 verdict；不改产品默认值/锁/approval。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - verifier 只能对授权任务给出完成裁决；缺证据不自动转 done，越权任务无裁决。
  - approved 的完成可被撤销回到先前状态；裁决不带来任何发布/产品锁权限。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s07-verifier-completion-verdict.md
---

# S07 冻结实施边界

S07 只加一个受限、可撤销的完成裁决入口，复用 `runtime-core/evidence-verifier.ts` 的 `evaluateEvidenceVerifier`。它不写状态库、不发布、不改产品锁：调用方拿 verdict 记录后，由既有 task ledger 的 `status_changed` 单一来源执行获准的 node->done 转换，撤销则回到记录的 priorStatus。verdict 记录 digest-only，绝不含原始证据正文。
