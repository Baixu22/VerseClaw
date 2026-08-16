---
id: verseshell-p1-mcp-compatibility
title: VerseShell P1-03 MCP 默认拒绝与兼容层收紧
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将 VerseShell MCP 限定为可安装、可启动、可审计的外部兼容 adapter，并阻止宽权限、任意 eval、shell 字符串和版本漂移绕过 typed ACI。
touchedAreas:
  - harness/specs/tasks/verseshell-p1-mcp-compatibility.md
  - harness/specs/rules/verseshell-mcp-compatibility-boundary.md
  - resources/verseshell-mcp/package.json
  - resources/verseshell-mcp/src/index.js
  - resources/verseshell-mcp/src/identity.js
  - resources/verseshell-mcp/src/policy.js
  - resources/verseshell-mcp/test/policy.test.mjs
  - resources/verseshell-mcp/test/start-smoke.test.mjs
  - resources/verseshell-mcp/test/runtime-capability-smoke.test.mjs
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - package.json
  - docs/dev/verseshell-foundation/STATUS.md
  - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
  - docs/dev/verseshell-foundation/P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - 产品 profile 默认不授予任何 VerseShell capability，tools/list 只返回无副作用 health 检查。
  - 显式 capability 只解锁对应工具；`cap all`、`*`、未知 capability、profile 漂移和依赖缺失在启动或调用边界 fail-closed。
  - 产品 profile 不注册任意 eval 或 shell 字符串工具；开发 profile 的兼容 shell 工具只接受显式 argv，并拒绝 shell 元字符和不完整引号。
  - MCP health 返回 package/runtime/protocol/catalog identity，但不回传 workspace、executable path、approval token 或原始命令。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - release-artifact-attestation-integrity
  - verseshell-foundation-p0-boundary
  - verseshell-process-lifecycle-boundary
  - verseshell-mcp-compatibility-boundary
forbiddenPatterns:
  - 默认 `cap all`、`*` 或未知 capability grant
  - 产品 profile 暴露 `verseshell_eval`、shell 字符串解释或新的 model-visible VerseShell operation
  - 用环境中另一个 MCP/runtime 版本掩盖仓库 package、manifest、protocol 或 catalog drift
  - MCP 失败后转移到 native shell、legacy eval、未受治理进程或隐式 fallback
  - 将 workspace、命令文本、approval token、credential 或完整 stderr 写入 health/diagnostic payload
featureFlags:
  - MCP compatibility remains explicit opt-in and separate from verifiedRuntime/typedAci/facade/governedExec ownership.
  - Development-only compatibility profile is never selected by product defaults.
rollback:
  - Remove MCP compatibility from the external client catalog and preserve the typed facade/governed owner.
  - If package, runtime, protocol, catalog, argv or dependency validation fails, keep the adapter unavailable and do not alter rollout locks.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p1-mcp-compatibility.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p1-mcp-compatibility.md
  - pnpm --dir resources/verseshell-mcp install --frozen-lockfile --ignore-scripts
  - pnpm --dir resources/verseshell-mcp test
  - pnpm run verseshell:mcp:test
  - pnpm run typecheck:node
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The MCP package is a tracked workspace package with a frozen lockfile and a real SDK dependency; clean install and startup smoke pass.
  - Product profile is deny-by-default, wildcard/unknown grants fail before server startup, and tools/list is capability-filtered.
  - Eval and shell-string compatibility are development-only; explicit argv is validated and converted to the same shell.exec operation boundary.
  - Package and runtime identity are read from package.json and resources/verseshell/manifest.json; health exposes bounded identity only.
  - Focused policy and MCP JSON-RPC startup tests pass, with no new internal model tool, MCP dependency, write path, native fallback, canary or rollout unlock.
  - Harness, install, focused tests, typecheck and comms gates pass; repository-wide residuals are recorded without being reclassified as release evidence.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md
    - docs/dev/verseshell-foundation/P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P1-03 MCP 默认拒绝与兼容层收紧

本工作包只处理外部 MCP 兼容边界。它不把 MCP 变成 ClawX 内部主通道，不扩展模型工具面，
不实现写入事务，也不改变 `default-off`、`liveReady`、`productApproved` 或 `defaultOn`。
