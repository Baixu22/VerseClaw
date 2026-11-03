---
lifecycleStatus: active
id: autonomy-session-task-scope
title: A4 把强任务范围接入会话与协调器的真实 owner
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 复用 Task Ledger sessionLinks 与 coordinator binding，给每个执行会话一个可读、可拒绝的任务作用域；discussion 允许为空，但不从标题或他人链接推断任务，也不复制完成权威。
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
  - harness/specs/tasks/autonomy-session-task-scope.md
  - harness/specs/rules/autonomy-session-task-scope-boundary.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/fixtures/autonomy-session-task-scope/**
  - shared/session-task-scope.ts
  - shared/types/task-ledger.ts
  - shared/host-api/contract.ts
  - electron/services/task-ledger-api.ts
  - tests/unit/session-task-scope.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - tests/unit/long-session-coordinator-binding.test.ts
  - docs/modules/multi-agent-and-tasks.md
expectedUserBehavior:
  - 讨论会话没有任务时保持 empty；只有显式 session link 才可解析任务作用域。
  - 错 workspace、旧 generation、缺失 coordinator/taskRef 或无同会话 link 时拒绝副作用。
  - Fork 可读取被链接任务，但不会继承写 claim；Handoff 不得复用旧 writer 作用域。
  - external task ref 不能冒充 Task Ledger 完成权威。
requiredTests:
  - pnpm exec vitest run tests/unit/session-task-scope.test.ts tests/unit/long-session-delegation-admission.test.ts tests/unit/long-session-coordinator-binding.test.ts
  - pnpm harness validate --spec harness/specs/tasks/autonomy-session-task-scope.md --no-diff
  - pnpm harness run --spec harness/specs/tasks/autonomy-session-task-scope.md --no-diff --dry-run
  - node scripts/typecheck-agent-dev.mjs --cache
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - 新会话、讨论转执行、已有任务进入、派发、handoff、fork均有可追溯任务绑定。
  - Fork不会继承有效写claim/lease；Handoff换代后旧执行者不能继续写；工作组移动不改任务归属。
  - 任务引用缺失/跨项目/已失效时副作用被拒；UI可读取空/不可用/陈旧状态。
  - 负例覆盖无任务副作用、同任务双执行者、externalRef冒充Ledger完成、标题推断任务身份。
  - 连续10轮普通讨论不创建业务task；明确执行意图只建立一个幂等主任务及必要checks；绑定已有任务不改完成状态。
  - 证据包含 driven_by:agent、actor、source/candidate/input/config 版本、命令/exit/count、artifact hash、负例与未测范围。
docs:
  required: true
  files:
    - harness/specs/guides/autonomous-project-system-plan.md
---

# A4 session task scope

## Scope

The scope resolver reads only explicit coordinator and Task Ledger session links.

The resolver's generation-bearing link is an optional field on the existing session link
model. It does not add a second task list; it only rejects a link from an older session
generation when the caller supplies that generation. It is a
precondition projection for side effects, not a task writer and not a completion authority.
A discussion container may remain empty. A fork may read a linked task but receives no write
claim. A handoff must be re-bound to the current generation; it cannot reuse the old writer's
scope. When a session link carries `sessionGeneration`, it must equal the current generation.

## Negative controls

- Missing coordinator, binding, task reference, task node, same-session link, or stale generation rejects.
- Cross-workspace task references reject.
- A title or another session's link never supplies task identity.
- An external reference cannot stand in for Task Ledger completion evidence.

## Evidence

Curated evidence lives under `harness/specs/fixtures/autonomy-session-task-scope/` with a
SHA256SUMS manifest, command exits/counts, negative cases, and unmeasured boundaries. All
artifacts are agent-driven; no real-human evidence is claimed.
