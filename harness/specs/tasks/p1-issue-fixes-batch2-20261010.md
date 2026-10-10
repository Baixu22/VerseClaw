---
id: p1-issue-fixes-batch2-20261010
title: P1 issue batch 2 - telemetry, environment, MCP and renderer security boundaries
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close open P1 issues #86, #87, #107, #108, #126, #127, #128 and #129 with narrow security boundaries and synthetic/agent-driven verification.
expectedUserBehavior:
  - Telemetry is opt-in at the client lifecycle level; disabling it stops and clears the PostHog client, and no analytics credentials are shipped in source.
  - OfficeCLI installers are pinned to a commit and verified by SHA-256 before execution.
  - Role filesystem=read/network=none policy removes dynamic MCP tools unless the server was explicitly configured read-only; network=none removes dynamic MCP tools entirely.
  - secret_adjacent Role Memory is redacted with the mandatory tools-mode redactor before any context-pack bucket is rendered.
  - Host exec child/PTY environments drop provider, custom-provider and gateway credentials while preserving required OS/runtime variables.
  - Remote images in untrusted chat/transcript content are not auto-fetched; renderer CSP no longer grants network image loads.
  - MCP networkPolicy=disabled and remote localOnly endpoints are rejected before a live transport can initialize.
touchedAreas:
  - electron/services/office-tools-api.ts
  - electron/services/settings-api.ts
  - electron/utils/telemetry.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-materialize.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/effective-tool-policy.ts
  - openclaw_runtime/src/agents/mcp-transport-config.ts
  - openclaw_runtime/src/agents/mcp-transport.ts
  - openclaw_runtime/src/agents/role-permissions-policy.ts
  - openclaw_runtime/src/infra/host-env-security.ts
  - openclaw_runtime/src/memory/context-pack.ts
  - openclaw_runtime/src/plugins/tools.ts
  - src/pages/Chat/message-utils.ts
  - index.html
  - tests/unit/chat-assistant-media-display.test.ts
  - tests/unit/host-env-security.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/mcp-network-policy-transport.test.ts
  - tests/unit/mcp-p4-003-runtime-surface.test.ts
  - tests/unit/office-tools-api.test.ts
  - tests/unit/renderer-image-csp.test.ts
  - tests/unit/role-mcp-capability-policy.test.ts
  - tests/unit/role-memory-eval-pack.test.ts
  - tests/unit/telemetry.test.ts
  - harness/specs/tasks/p1-issue-fixes-batch2-20261010.md
  - docs/dev/p1-issue-fixes-batch2-20261010.md
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - system-maturity-security-regression
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/role-memory-eval-pack.test.ts tests/unit/telemetry.test.ts tests/unit/host-env-security.test.ts tests/unit/mcp-network-policy-transport.test.ts tests/unit/mcp-p4-003-runtime-surface.test.ts tests/unit/chat-assistant-media-display.test.ts tests/unit/host-services.test.ts tests/unit/role-mcp-capability-policy.test.ts tests/unit/office-tools-api.test.ts tests/unit/renderer-image-csp.test.ts tests/unit/role-memory-context-provider.test.ts tests/unit/mcp-api.test.ts --maxWorkers=1
  - pnpm run typecheck
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch2-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Issue #108 - secret_adjacent cards are passed through the mandatory tools-mode redactor before context assembly; synthetic Bearer values do not survive into a bucket or role prompt.
  - Issue #126 - provider/custom-provider/gateway credential keys are classified as inherited secrets and are absent from a real child process environment while PATH/SystemRoot/PATHEXT remain available.
  - Issue #128 - disabled and non-local localOnly HTTP MCP servers return no live transport and produce zero initialize requests against a loopback fixture.
  - Issue #129 - disabling telemetry at runtime shuts down the initialized client and blocks later capture calls without requiring a restart.
  - Issue #107 - role filesystem=read/network=none sentinels remove dynamic MCP tools at the final policy boundary unless the server is explicitly configured readOnly; trusted read-only tools remain available for filesystem=read, and network=none remains conservative.
  - Issue #127 - remote HTTP(S) image targets are treated as unresolvable in the renderer and renderer CSP img-src no longer grants http/https.
  - Issue #87 - OfficeCLI installer URLs are pinned to a commit and both PowerShell and shell paths verify SHA-256 before execution.
  - Issue #86 - no PostHog project key is hardcoded; key/host are read from deployment configuration and absence of the key disables the outbound client.
  - Verification is synthetic/agent-driven only; no real provider key, paid call or human action is used.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch2-20261010.md
---

# P1 issue batch 2

This batch closes independent security boundaries that were intentionally kept
out of batch 1: telemetry lifecycle/ownership, host environment credentials,
MCP transport policy, dynamic MCP tool role constraints, memory redaction,
remote image loading, and OfficeCLI installer supply-chain verification.
