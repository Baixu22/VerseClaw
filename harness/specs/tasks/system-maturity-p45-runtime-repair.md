---
id: system-maturity-p45-runtime-repair
title: Repair Phase 4 and Phase 5 runtime maturity claims
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 336443bbbf4761b41ac14116c5f22a204e23fa81
intent: Replace unsupported Phase 4 and Phase 5 completion claims with production-wired channel admission, chat resource limits, cross-layer runtime validation, and reproducible evidence integrity checks.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/system-maturity-p45-runtime-repair.md
  - plans/system-maturity/phase4-runtime-surfaces/**
  - plans/system-maturity/phase5-reliability-abuse/**
  - plans/system-maturity/INDEX.md
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P4-*/**
  - artifacts/system-maturity/P5-*/**
  - artifacts/system-maturity/P4P5-EVIDENCE/**
  - scripts/**evidence**
  - scripts/audit-baseline-check.mjs
  - scripts/p0-full-acceptance.mjs
  - shared/channels/**
  - electron/**channel**
  - openclaw_runtime/src/channels/**
  - openclaw_runtime/src/plugin-sdk/**
  - openclaw_runtime/package.json
  - openclaw_runtime/scripts/lib/plugin-sdk-entrypoints.json
  - openclaw_runtime/src/auto-reply/reply/dispatch-from-config.ts
  - openclaw_runtime/src/auto-reply/reply/dispatch-from-config.inbound-trust.test.ts
  - openclaw_runtime/src/agents/sessions/**
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.test.ts
  - openclaw_runtime/src/agents/role-permissions-policy.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/context-engine/dcs-corpus-synthetic.ts
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/memory/memory-dual-gate.ts
  - openclaw_runtime/extensions/webhooks/**
  - shared/agent-resource-limits.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - shared/sensitive-content-boundary.ts
  - shared/types/mcp.ts
  - electron/services/chat-api.ts
  - src/stores/chat.ts
  - src/pages/Chat/**
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - shared/i18n/locales/**
  - shared/agent-browser/**
  - electron/services/agent-browser**
  - shared/mcp/**
  - electron/services/mcp-api.ts
  - electron/services/gateway-api.ts
  - openclaw_runtime/src/gateway/**
  - tests/unit/**p4**
  - tests/unit/**p5**
  - tests/unit/agent-browser-*.test.ts
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/chat-*.test.tsx
  - tests/unit/dev-slice.test.ts
  - tests/unit/gateway-permissions-api.test.ts
  - tests/unit/locomo-report-comparator.test.ts
  - tests/unit/memory-dual-gate-p3-003.test.ts
  - tests/unit/observability-index.test.ts
  - tests/unit/path-broker-resolved.test.ts
  - tests/unit/role-*.test.ts
  - tests/unit/runtime-spine-gate-engine-p2-005.test.ts
  - tests/unit/sandbox-high-risk-gate-p2-004.test.ts
  - tests/unit/sekb-*.test.ts
  - tests/unit/sensitive-content-boundary.test.ts
  - tests/unit/terminal-api.test.ts
  - tests/unit/webview-security-p2-004.test.ts
  - tests/unit/workspace-browser-body.test.tsx
  - tests/e2e/**
expectedUserBehavior:
  - Unauthorized, unsigned, stale, or replayed channel messages are rejected before any agent turn or prompt assembly.
  - Inbound channel content admitted to an agent is fenced as untrusted content without exposing channel credentials to Renderer.
  - Chat token or cost budget exhaustion is visibly rejected before a Gateway or runtime request starts.
  - Oversized tool results are bounded before long-term persistence and DOM projection.
  - Timeout and cancel terminate the underlying run and leave the session able to start a subsequent turn.
  - Browser tabs/profiles, Gateway responses, and MCP reload/tool schemas remain bound to their real runtime identities and permissions.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint
  - pnpm run typecheck
  - pnpm test
  - pnpm run build:vite
  - pnpm run test:e2e tests/e2e/system-maturity-p45.spec.ts
acceptance:
  - Every reopened task remains non-done until each original acceptance item and required test has fresh evidence.
  - Channel admission helpers have production call sites for every supported inbound channel type and fail closed by default.
  - Replay protection has service lifetime rather than request lifetime.
  - Budget evaluation uses persisted session usage in Main/runtime before send and never relies only on Renderer memory.
  - Tool-result caps apply before durable storage and renderer projection.
  - Gateway, Browser, and MCP acceptance is demonstrated through cross-layer tests, including Browser multi-tab isolation E2E.
  - Evidence indexes contain non-self-referential artifact hashes and fail validation on missing or mismatched files.
  - Findings registry, task delivery files, and phase status match the final verified state.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Use this task spec only for the bounded Phase 4 and Phase 5 maturity repair. It does not authorize Phase 6 work.
