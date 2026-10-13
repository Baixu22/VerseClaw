---
lifecycleStatus: completed
id: harness-gap-browser-effect-boundary
title: 浏览器来源、会话归属与副作用边界台账（S04）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S04 核验 agent_browser 的来源与会话归属边界：external/unknown 来源不得选择外部连接模式；click/type 额外要求 Main-owned managed 会话；逐 action 记录覆盖与残余，不弱化 SSRF/private-network/kill switch，不新建第三套策略。
touchedAreas:
  - docs/dev/harness-gap-closure/s04-browser-effect-boundary.md
  - tests/unit/browser-effect-boundary-ledger.test.ts
  - harness/specs/tasks/harness-gap-browser-effect-boundary.md
  - docs/dev/harness-gap-closure/s04-acceptance.json
  - docs/dev/harness-gap-closure/S04-SHA256SUMS
ownedPaths:
  - docs/dev/harness-gap-closure/s04-browser-effect-boundary.md
  - tests/unit/browser-effect-boundary-ledger.test.ts
  - harness/specs/tasks/harness-gap-browser-effect-boundary.md
  - docs/dev/harness-gap-closure/s04-acceptance.json
  - docs/dev/harness-gap-closure/S04-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.test.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.provenance.test.ts
  - openclaw_runtime/src/agents/agent-browser-provenance-wiring.test.ts
  - tests/unit/browser-effect-boundary-ledger.test.ts
acceptance:
  - external/derived-untrusted/missing/invalid 来源不得选择 auto-connect / cdp / external-profile；managed 放行；trusted system/direct operator 不受该闸门限制。
  - click / type 在 external/unknown 来源下必须要求 Main-owned managed 会话，否则拒绝。
  - 逐 action 记录覆盖：navigate/status/waitForSelector/screenshot/getConsoleMessages 只过连接模式闸门，click/type 另加会话归属闸门。
  - evaluate / command / close 属副作用型但**未**接入会话归属闸门，显式记为 residual，不冒充已覆盖。
  - 不弱化 SSRF / private-network / kill switch；不新建第三套策略。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 外部/未知来源内容无法把 browser 工具切到外部连接，也无法在未验证归属的会话里 click/type。
  - 维护者能从台账看清每个 action 实际接线到哪一步、哪些仍是残余。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s04-browser-effect-boundary.md
---

# S04 冻结实施边界

S04 核验既有两条浏览器 provenance 策略，不新增策略。`agent-browser-tool.ts` 对每个 action 跑 `resolveAgentBrowserExternalAccessPolicy`（连接模式），并对 click/type 追加 `resolveAgentBrowserSessionEffectPolicy`（会话归属）。evaluate/command/close 只受前者约束，记为 residual。SSRF/private-network/kill switch 独立，未改动。
