---
id: harness-gap-error-recovery-next-action
title: 错误返回可执行且受权限约束的修复动作（G01）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: G01 让每个错误类携带稳定 code + retryable + 受权限约束的 nextAction：nextAction 只能是固定动词（retry/reauthenticate/reconfigure/open-settings/contact-support）加有界参数，绝不是 shell 指令或原始脚本；无法自动修复时明确“向用户暴露原始错误”，不伪造可修复。
touchedAreas:
  - src/lib/error-model.ts
  - tests/unit/error-recovery-next-action.test.ts
  - harness/specs/tasks/harness-gap-error-recovery-next-action.md
  - docs/dev/harness-gap-closure/g01-error-recovery-next-action.md
  - docs/dev/harness-gap-closure/g01-acceptance.json
  - docs/dev/harness-gap-closure/G01-SHA256SUMS
ownedPaths:
  - src/lib/error-model.ts
  - tests/unit/error-recovery-next-action.test.ts
  - harness/specs/tasks/harness-gap-error-recovery-next-action.md
  - docs/dev/harness-gap-closure/g01-error-recovery-next-action.md
  - docs/dev/harness-gap-closure/g01-acceptance.json
  - docs/dev/harness-gap-closure/G01-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - error-governance-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/error-recovery-next-action.test.ts
  - tests/unit/error-governance-boundary.test.ts
acceptance:
  - 每个 AppErrorCode 都有稳定的 recovery 表项（retryable + scope + 可选 action），无遗漏。
  - 仅 self-retry 类是 retryable，且其 action 恰好是 { kind: 'retry' }；非 retryable 一律 user-action-required 且 action.kind != 'retry'。
  - nextAction 只允许固定动词集合，且键只有 kind(+target)，绝不含 command/script/shell/exec/argv 等可执行字段。
  - AppError 实例带 retryable 与 nextAction；UNKNOWN 无 action（明确要求向用户暴露原始错误，不伪造修复）。
  - 复用既有错误治理单一 envelope（HostResponse/AppError），不新增第二套 envelope 或错误类型；错误治理检查仍 PASS。
  - 干净候选定向测试、web 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 每个错误都能给 agent 一个安全、有界、受权限约束的恢复动作；无法自动修复时把原始错误交给用户。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/g01-error-recovery-next-action.md
---

# G01 冻结实施边界

G01 只在既有 `src/lib/error-model.ts` 的 `AppError`/`AppErrorCode` 上增加预登记的 recovery 表与 `retryable`/`nextAction`，复用既有错误治理 envelope（HostResponse/AppError），不新增第二套 envelope 或错误类型。nextAction 是固定动词枚举 + 有界 target，绝不是 shell 指令或原始脚本；UNKNOWN 不携带 action，表示必须把原始错误暴露给用户。
