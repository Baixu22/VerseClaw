---
lifecycleStatus: completed
id: harness-gap-residuals-closure-20261014
title: 收口 harness-gap-closure 残余：E2E 全绿 + A2/A4/A5/A6 缺实现补齐（TF-0264）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 收口 TF-0264 的剩余验收：修复三个残余 Electron E2E 失败（HTML preview CSP 继承、goal-wake stderr 耦合、git-panel order flake），恢复 area-composition-spec 指定的 A2/A5/A6 组合 facade 并补齐 A4 的 offline dev-tool caller，使 A2/A4/A5/A6 不再以缺实现记为 NO-GO；随后刷新 V02/V03 证据。
touchedAreas:
  - harness/specs/tasks/harness-gap-residuals-closure-20261014.md
  - harness/specs/tasks/a2-multi-agent-orchestration-pilot.md
  - harness/specs/tasks/a4-decision-quality-pilot.md
  - harness/specs/tasks/a5-adaptive-context-budget-pilot.md
  - harness/specs/tasks/a6-long-running-persistence-pilot.md
  - harness/specs/tasks/harness-gap-a05-adaptive-context-budget-pilot-reverify.md
  - harness/specs/tasks/harness-gap-a06-long-running-persistence-pilot-reverify.md
  - harness/specs/tasks/harness-gap-v02-frozen-acceptance.md
  - harness/specs/tasks/harness-gap-delivery-verdict.md
  - docs/dev/harness-gap-closure/**
  - docs/dev/p2-issue-fixes-batch10-20261010.md
  - docs/runtime-design/development-manual.md
  - docs/runtime-design/area-composition-spec.md
  - openclaw_runtime/src/agents/cross-area/**
  - electron/main/html-preview-protocol.ts
  - electron/main/index.ts
  - electron/services/files-api.ts
  - index.html
  - package.json
  - scripts/a4-decision-quality-audit.mts
  - scripts/repository-artifacts.json
  - shared/host-api/contract.ts
  - shared/security/url-policy.ts
  - src/components/file-preview/HtmlPreview.tsx
  - src/lib/file-preview-client.ts
  - src/lib/host-api.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - tests/unit/a02-a2-gate-coverage.test.ts
  - tests/unit/a04-a4-gate-coverage.test.ts
  - tests/unit/a05-a5-gate-coverage.test.ts
  - tests/unit/a06-a6-gate-coverage.test.ts
  - tests/unit/a4-decision-quality-dev-tool.test.ts
  - tests/unit/cross-area-composition.test.ts
  - tests/unit/deep/a5-deep.test.ts
  - tests/unit/deep/a6-deep.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/harness-gap-v02-acceptance.test.ts
  - tests/unit/html-preview-security.test.tsx
  - tests/unit/performance-budgets.test.ts
  - tests/unit/workspace-browser-body.test.tsx
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-workbench/**
  - artifacts/browser-security-recovery/evidence.json
  - artifacts/sekb-golden-path/evidence.json
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
  - tests/unit/html-preview-security.test.tsx
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/cross-area-composition.test.ts
  - tests/unit/deep/a5-deep.test.ts
  - tests/unit/deep/a6-deep.test.ts
  - tests/unit/a4-decision-quality-dev-tool.test.ts
  - tests/unit/a02-a2-gate-coverage.test.ts
  - tests/unit/a04-a4-gate-coverage.test.ts
  - tests/unit/a05-a5-gate-coverage.test.ts
  - tests/unit/a06-a6-gate-coverage.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/harness-gap-v02-acceptance.test.ts
acceptance:
  - 三个残余 Electron E2E 失败修复：HTML preview 经 `clawx-preview:` scheme 提供文档、goal-wake stderr 断言去耦、git-panel 在完整串行套件中通过；全量 E2E 测试级 0 失败。
  - A2 判据4 多 worker resume 新会话由 `tests/unit/cross-area-composition.test.ts`（Stage 3 / 3.7）验证，不再以缺实现记 NO-GO。
  - A4 offline-only 边界保持；新增显式 dev-tool CLI `scripts/a4-decision-quality-audit.mts` 作为唯一 sanctioned caller，并有测试覆盖。
  - A5 判据3 `ContextBudgetPlanner.replanOnResume` 由恢复的组合 facade 实现并被测试覆盖。
  - A6 `ResumeContractVerifier`、`FingerprintLeaseCoordinator` 与 10-cycle pause/resume p99 由恢复的组合 facade + 测试覆盖。
  - V02/V03 证据刷新为内部受控 PASS，产品锁维持 false。
  - 定向测试、typecheck、lint、harness:ci、comms、contract、i18n、build 全通过，凭据扫描 0 命中。
expectedUserBehavior:
  - 维护者可从 v02-acceptance.json 与各 pilot spec 回读：三个 E2E 残余已修复、A2/A4/A5/A6 的缺实现已由真实代码+测试补齐（A4 仍是 offline-only），产品锁不变，全门内部受控 PASS，非 GA/发布。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/v02-frozen-acceptance.md
---

# 冻结实施边界

本包收口 TF-0264 的剩余验收：不新增产品行为（HTML preview 修复除外，它恢复了既有设计意图），不改变任何产品锁或默认值，不发布。A4 保持开发手册规定的 offline-only 边界，只新增显式 dev-tool CLI；A2/A5/A6 恢复 `area-composition-spec.md` 指定的组合 facade，属 shadow/pilot 阶段的可测试层，不等同生产 wiring 或 GA。
