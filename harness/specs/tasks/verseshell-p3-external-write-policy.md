---
id: verseshell-p3-external-write-policy
title: VerseShell P3-02 External Write Policy
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 为 compiler、script 与 Git hook 等外部进程写入提供显式 external-write 分类和不可自动回滚声明，并接入既有 exec approval；不建立第二审批通道或第二 journal。
touchedAreas:
  - harness/specs/tasks/verseshell-p3-external-write-policy.md
  - harness/specs/rules/verseshell-external-write-policy-boundary.md
  - openclaw_runtime/src/agents/verseshell/external-write-policy.ts
  - openclaw_runtime/src/agents/verseshell/external-write-policy.test.ts
  - openclaw_runtime/src/agents/verseshell/external-write-policy.identity.test.ts
  - openclaw_runtime/src/agents/verseshell/external-write-git.ts
  - openclaw_runtime/src/agents/bash-tools.exec.external-write.test.ts
  - openclaw_runtime/src/agents/verseshell/command-profiles.ts
  - openclaw_runtime/src/agents/verseshell/command-profile-definitions.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec-runtime.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - tests/e2e/chat-tool-ui-execution-surfaces.spec.ts
  - tests/e2e/fakecoding-inbox-navigation.spec.ts
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/unit/inbox-store.test.ts
  - tests/unit/pending-run-approvals.test.tsx
  - tests/unit/approval-redaction-contract.test.ts
  - tests/unit/run-surface-promotion.test.ts
  # Test-isolation repairs found while running the full unit suite for this
  # package. Unrelated to external-write classification; see the deviation
  # recorded in the evidence document.
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-save-to-knowledge.test.tsx
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/use-session-status-failure-states.test.tsx
  - src/lib/permission-approval-display.ts
  - src/components/tool-ui/PendingRunApprovals.tsx
  - src/components/tool-ui/run-surfaces.ts
  - src/components/file-preview/WorkspaceAuditPanel.tsx
  - src/components/file-preview/WorkspaceGitPanel.tsx
  - src/components/file-preview/WorkspaceTerminalPanel.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/pages/Chat/run-surface-promotion.ts
  - src/pages/Inbox/index.tsx
  - src/stores/inbox.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/en/inbox.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ja/inbox.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/ru/inbox.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/zh/inbox.json
  - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - 外部进程写入在现有 exec approval 中显示“不在 ClawX write journal 内、无自动回滚”的静态警告。
  - 警告文本不包含命令、路径、参数、环境值或凭据。
  - compiler、script、Git hook 与 terminal-shell 代表用例被分类为 external-write。
  - 只读 Git 与常见只读命令不被误标为 external-write。
  - 不改变默认开关、审批策略、执行结果或自动重放语义。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - renderer-main-boundary
  - verseshell-foundation-p0-boundary
  - verseshell-command-profile-boundary
  - verseshell-external-write-policy-boundary
forbiddenPatterns:
  - 新增第二审批系统、第二 journal、第二 undo 栈或新 feature flag
  - 把 external-write 宣称为 ClawX write journal 事务或可自动回滚
  - 在警告或审计投影中保留原始命令、路径、环境值或凭据
  - 修改 defaultOn、liveReady、productApproved 或任何 rollout 锁
  - 自动重放 effectful 请求或切换 native/MCP fallback
featureFlags:
  - 复用既有 verifiedRuntime、typedAci、facade、governedExec 与 kill switch；不新增配置叶。
rollback:
  - 移除 external-write 警告或禁用对应分类不影响既有 exec approval 与 VerseShell 执行契约。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p3-external-write-policy.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p3-external-write-policy.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.unit-fast.config.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run typecheck:node
  - pnpm run test:e2e:run tests/e2e/chat-tool-ui-execution-surfaces.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - VerseShell command plan 对每个外部进程写入声明 effectLevel、trigger 与 rollbackClaim=false。
  - compiler、script、Git hook 与 terminal-shell 代表用例均有 focused policy tests。
  - 既有 exec approval 是唯一授权面；本策略只增加显式警告，不改变 allow/ask/deny 结果。
  - 警告文本是静态枚举语义，不复制命令或敏感内容。
  - ClawX write journal 仍是 commit/undo/recovery 的唯一 authority；external-write 不宣称事务覆盖。
  - 不引入新配置、新依赖、新 UI 通道或产品锁变化。
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/handoffs/LATEST.md
---

# VerseShell P3-02 External Write Policy

本包只解决外部进程写入的**可见性与诚实恢复语义**。OpenClaw 的既有 exec
approval 仍是唯一授权面；ClawX write journal 仍是唯一 commit/undo/recovery
authority。compiler、script、Git hook 和 terminal shell 产生的文件变化不属于
journal transaction，因此必须显式声明 `external-write` 与 `rollbackClaim=false`。

分类挂在 host-owned immutable command plan 上，随既有 approval 请求传递静态
警告。警告不包含命令内容，审批面的既有 sanitizer 继续负责命令展示脱敏。
