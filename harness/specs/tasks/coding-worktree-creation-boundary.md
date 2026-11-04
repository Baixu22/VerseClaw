---
lifecycleStatus: active
id: coding-worktree-creation-boundary
title: TF-0767 工作树创建与清理的路径和归属边界
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 44dbaee41daa4d8a8a6c3793a7465714990256e1
intent: 拒绝保留ID与归属冲突，复用fs-safe的managed路径检查，阻止创建先删目录与锁超时后无锁执行。
touchedAreas:
  - harness/specs/tasks/coding-worktree-creation-boundary.md
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-service.test.ts
  - tests/unit/orchestration-worktree-merge.test.ts
  - harness/specs/fixtures/coding-fixes/TF-0767/**
  - docs/modules/workspace-and-coding.md
expectedUserBehavior:
  - 保留名、名称碰撞、已有非本次目录或被替换路径在任何创建/删除前拒绝，保留用户内容。
  - 锁超时明确失败；活跃旧锁不能因为年龄超过阈值被抢走。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/coding-worktree-creation-boundary.md
  - pnpm --dir openclaw_runtime exec vitest run src/agents/worktree-service.test.ts src/agents/worktree-pnpm-install.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/orchestration-worktree-merge.test.ts tests/unit/versegit-cleanup-barrier.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - 点/双点/设备名/空ID、规范化及截断碰撞、重复ID/旧owner不能删除已有用户或控制目录。
  - managed根或目标被换成junction、硬链接/符号链接seed文件、未知目录和缺少VG barrier时拒绝，外部标记与证据保留。
  - 已有活跃进程的锁保持且超时不执行临界区；错误I/O不吞成成功。
  - 两个独立合法worktree创建/使用/按owner清理的原正向测试通过，默认值保持。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 落实既有managed工作树承诺，README功能范围和默认值不变。
---

创建不承担清理或丢弃已有工作目录的权限。复用fs-safe安全段编码和路径校验；预检全部seed路径后再创建目录。清理仍由原worktree owner和已有VG barrier裁决。合并内容的保真与冲突在TF-0769单独完成。
