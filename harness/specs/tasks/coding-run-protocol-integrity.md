---
lifecycleStatus: active
id: coding-run-protocol-integrity
title: TF-0771 CodingRun导出与CI运行身份绑定
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 6f4ddc0e1
intent: 使合法Task Loop展示导出可由CI读取，拒绝跨run与非法嵌套证据，并保持取消/错误状态和完成权威边界。
touchedAreas:
  - harness/specs/tasks/coding-run-protocol-integrity.md
  - shared/types/coding-run.ts
  - shared/types/identity-scope.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - tests/unit/coding-run.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/e2e/task-loop-panel.spec.ts
  - scripts/coding-baseline/probes/coding-run.mts
  - harness/specs/fixtures/coding-fixes/TF-0771/**
  - docs/modules/workspace-and-coding.md
expectedUserBehavior:
  - 有或无evidenceGate的合法Task Loop导出均round-trip成功，可选warning可省略。
  - 跨运行、非法scope/嵌套字段/枚举和乱序输入由CLI非零拒绝，取消和错误不变成completed。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/coding-run.test.ts --maxWorkers=1
  - node scripts/coding-baseline/probes/coding-run.mts
  - node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts -t "completes after one successful self-check|keeps legacy error status" --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node node_modules/@playwright/test/cli.js test tests/e2e/task-loop-panel.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/coding-run-protocol-integrity.md
acceptance:
  - Task Loop有无evidenceGate导出均被同一v1合同解析，真实CLI exit0。
  - 跨run验证、空scope、数字runIds、非法completion、未知字段/版本、乱序均CLI非零拒绝。
  - 取消/error保持原始终态，展示/CI不获得Task Ledger完成权限。
  - UI展示内容与CLI读回一致，正常/负例、命令exit/count、候选及hash/credential扫描齐备，agent标注真实。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 修复既有v1协议；README功能范围与默认值不变。
---

TF-0758/P1，A7。复用现有CodingRun关联视图与identity-scope，不新增任务状态机、存储或完成权限。
