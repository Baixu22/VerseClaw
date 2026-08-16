---
id: verseshell-p2-readonly-facade
title: VerseShell P2-01 只读 File/Search/Result Facade Adapter
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将 read_file、search_content、result_query 连接到共享 VerseShell facade 和既有 ACI owner，验证真实 workspace 读取、搜索和 artifact 查询边界，不新增写入或第二执行 owner。
touchedAreas:
  - harness/specs/tasks/verseshell-p2-readonly-facade.md
  - harness/specs/rules/verseshell-readonly-facade-boundary.md
  - shared/verseshell/facade.ts
  - openclaw_runtime/src/agents/verseshell/readonly-facade.ts
  - openclaw_runtime/src/agents/verseshell/readonly-facade.test.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/verseshell/policy-profile.ts
  - tests/unit/verseshell-readonly-facade.test.ts
  - docs/dev/verseshell-foundation/P2-READONLY-FACADE-EVIDENCE-2026-08-14.md
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - facade flag 默认关闭时，model tool surface 不出现 read_file、search_content、result_query。
  - 显式启用且 runtime/policy/ACI contract ready 时，三个只读工具只接受 workspace-relative 参数并返回 bounded observation。
  - workspace 外路径、绝对路径、NUL、过大 query、越界行窗口和 malformed result handle fail-closed。
  - adapter 只调用 VerseShellAciClient 或既有 governed result query，不直接 spawn、fetch、MCP 或 native fallback。
  - search/read 结果使用 workspace/revision/args/policy 组成的缓存身份；缓存命中不能越过 owner 或 revision 边界。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - renderer-main-boundary
  - verseshell-foundation-p0-boundary
  - verseshell-process-lifecycle-boundary
  - verseshell-readonly-facade-boundary
forbiddenPatterns:
  - 默认开启 facade 或修改 liveReady/productApproved/defaultOn
  - 新增 VerseShell 内部 operation 到模型工具目录
  - adapter 内 spawn、child_process、MCP client、Gateway HTTP 或 native fallback
  - workspace 外读取、无限制 glob/search、raw output 或未经 artifact 的大结果返回
  - 只按 path 缓存而忽略 workspace/revision/args/policy
  - 将 read-only retry 用于 write/effectful operation
featureFlags:
  - facade remains explicit opt-in and independently fail-closed with verifiedRuntime, typedAci, and kill switch.
rollback:
  - Keep the facade tools absent when any readiness or policy contract is unavailable.
  - Disable the facade flag and retain existing native/read tools; do not add fallback inside the adapter.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p2-readonly-facade.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p2-readonly-facade.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/verseshell-readonly-facade.test.ts --maxWorkers=1
  - pnpm run typecheck:node
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The shared four-operation facade order remains unchanged; P2 exposes only read_file, search_content, and result_query behind explicit rollout readiness.
  - Real client calls use file.view, repo.search, and result.query with bounded schemas and no direct process or network access in the adapter.
  - Workspace/revision/policy-aware cache keys and owner-aware artifact validation prevent cross-workspace or stale reuse.
  - Focused unit/runtime tests cover valid reads/searches, bounds, traversal, cache identity, malformed observations, artifact ownership, kill switch, and default-off tool construction.
  - Evidence and all three README files record engineering-only status; no write adapter, canary, default-on, GA, or product approval is authorized.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/P2-READONLY-FACADE-EVIDENCE-2026-08-14.md
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P2-01 只读 File/Search/Result Facade Adapter

本包只接入共享 facade 的低风险读取路径。`read_file`、`search_content`、`result_query` 是稳定的
模型表面，但只有在 `verifiedRuntime`、`typedAci`、`facade`、`governedExec` 和 artifact contract
均 ready 时才物化。adapter 不拥有进程、workspace、approval、MCP 或缓存真源；它只编排已有的
`VerseShellAciClient`、验证器和 bounded observation。
