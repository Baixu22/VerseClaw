---
lifecycleStatus: active
id: coding-worktree-merge-integrity
title: TF-0769 工作树回流删除与并发写入完整性
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 99ba8836d
intent: 让工作树回流反映真实add/modify/delete/rename效果，拒绝旧base和并发覆盖，通过已有journal与candidate owner记录实际终态。
touchedAreas:
  - harness/specs/tasks/coding-worktree-merge-integrity.md
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-service.test.ts
  - openclaw_runtime/src/agents/worktree-merge-files.ts
  - openclaw_runtime/src/plugin-sdk/journaled-git-apply.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - openclaw_runtime/src/agents/orchestration-candidate-apply.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - scripts/coding-baseline/probes/worktrees.mts
  - tests/unit/orchestration-worktree-merge.test.ts
  - tests/unit/versegit-host-apply.test.ts
  - tests/e2e/coding-worktree-merge-integrity.spec.ts
  - harness/specs/fixtures/coding-fixes/TF-0769/**
  - docs/modules/workspace-and-coding.md
expectedUserBehavior:
  - worker删除或重命名的文件正确回流到parent，merged回执可由磁盘结果验证。
  - parent在分叉后被用户修改时明确拒绝冲突，保留用户的staged与unstaged内容。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/orchestration-worktree-merge.test.ts tests/unit/versegit-host-apply.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/worktree-service.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node node_modules/@playwright/test/cli.js test tests/e2e/coding-worktree-merge-integrity.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/coding-worktree-merge-integrity.md
acceptance:
  - inprocess与Git原删除遗漏、主目录并发覆盖四例不再假merged，正常回流有实际文件读回。
  - add/modify/delete/rename、双删、删改冲突、部分失败、重复merge、旧base与staged/unstaged用户改动均有磁盘oracle。
  - candidate到apply期间目标变化拒绝，成功目标tree/hash与receipt一致，不抹去用户并发内容。
  - worker真实工作目录与parent合并根分别由既有工作树owner解析，完成回调不能把child目录误当parent根。
  - 复用已有journal/approval/candidate owner，不新增第二合并或恢复权威，不翻产品锁或默认值。
  - clean候选、执行命令exit/count/skip、正反效果、摘要与凭据扫描均读回成立，agent模拟如实标注。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 修复既有worktree回流语义；README产品范围与默认值保持现行合同。
---

TF-0758/S5，A4。沿用工作树注册、文件边界、写入journal、受控候选和现有许可路径。
本规格先固定原始反例，不代表实现或验收完成。所有运行driven_by=agent，realHumanEvidence=false。
