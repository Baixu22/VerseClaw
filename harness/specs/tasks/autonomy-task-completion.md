---
lifecycleStatus: active
id: autonomy-task-completion
title: A3 把自动完成声明提交为可回读的任务验收
scenario: gateway-backend-communication
taskType: runtime-bridge
previousValidationDiffBase: null
diffBase: 177ee7ed214979b82c4615fca6ddfda3b400a6b3
intent: 只在现有 TaskLoop、Evidence Verifier、Task Ledger 与 effect owner 的同一候选记录齐备时，允许自动业务任务声明产生一次可回读的完成提交；缺证据、错任务、旧 generation、篡改或模型自述一律拒绝。
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/rules/autonomy-task-completion-boundary.md
  - harness/specs/scenarios/autonomy-task-completion.md
  - harness/specs/fixtures/autonomy-task-completion/**
  - shared/types/task-ledger.ts
  - docs/modules/multi-agent-and-tasks.md
  - shared/host-api/contract.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-ledger-service.ts
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts
  - openclaw_runtime/src/runtime-core/task-completion-claim.ts
  - tests/unit/autonomy-task-completion.test.ts
expectedUserBehavior:
  - completed 或 exit 0、run/text、accepted 本身都不能把业务任务转成 done。
  - 只有同 task、同 candidate、同 generation 的 verifier 与 owner 证据齐备时才产生完成提交。
  - 证据缺失、篡改、来源过期、错任务、旧 generation 均被拒绝并可回读诊断。
residualPaths:
  - harness/specs/tasks/autonomy-object-owner-contract.md
  - harness/specs/tasks/autonomy-session-task-scope.md
  - harness/specs/tasks/autonomy-host-readiness.md
  - harness/specs/tasks/durable-task-owner-acceptance.md
  - harness/specs/tasks/g5-foundation-current-acceptance.md
  - tests/e2e/u6-interaction-metrics.final.spec.ts
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-task-completion.test.ts
  - pnpm run typecheck:test
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/autonomy-task-completion.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-task-completion.md --dry-run
  - git diff --check
acceptance:
  - complete+repair/blocked/unavailable 不能产生自动验收 done；单纯 accepted/exit0/text 也不能。
  - 证据缺失、篡改、来源过期、错误任务、旧 generation 被拒；验收成功可从磁盘和 owner 事件重算。
  - 保留 TaskLedger 任务事实与 Workboard/TaskLoop 调度状态分离；一般编辑不被伪装成独立验证。
  - 负例覆盖模型自证 passed、旧分支证据验收新合并候选、伪造 verifier、缺失 artifact。
  - 证据包含 driven_by:agent、真实 actor、source/candidate/input/config 版本、命令/exit/count、artifact hash、负例与未测范围；不以 stdout 或模型自述收口。
docs:
  required: true
  files:
    - harness/specs/guides/autonomous-project-system-plan.md
---

# A3 自动完成声明准入

## Scope

This task adds one bounded admission layer between existing owners and the Task Ledger
completion event. It does not introduce a second verifier, TaskLoop state machine, completion
decision service, or independent decision store.

The completion claim must bind the active task, candidate digest, generation, verification
receipt and effect evidence. A successful admission may emit the existing Task Ledger
`status_changed` event to `done`; it must not infer completion from the run outcome, model
text, a bare `accepted` flag, or exit code 0.

## Acceptance mapping

| Requirement | Required evidence |
| --- | --- |
| No completion from bare run/text/exit0 | rejection matrix with no `status_changed` event |
| Same candidate and generation | digest/generation mismatch negatives |
| Missing, stale, tampered evidence | fail-closed diagnostics and no done transition |
| Recomputable success | raw event replay plus verifier/effect receipts |
| Owner separation | TaskLoop/Workboard status remains independent |

## Owner-readback boundary

Main supplies its Gateway manager to the Task Ledger API. `submitCompletion` reads the
managed task and current writer, then requests `tasks.contract.receipt` from the existing
Runtime owner. The Runtime checks the persisted task, generation, candidate and saved
verifier/effect references. A validated credential is submitted through the existing
TaskSystem acceptance operation, and Task Ledger reads its resulting projection.

A missing Gateway, execution contract, current owner or matching receipt produces a
rejection. Caller-authored verdicts and effects remain outside this readback contract.

## Evidence

Curated evidence lives under `harness/specs/fixtures/autonomy-task-completion/`, with a
SHA256SUMS manifest, command exits/counts, negative cases, and unmeasured boundaries. All
artifacts are agent-driven and no real-human evidence is claimed.
