---
id: rc08a-mcp-host-native-tool-convergence
title: RC-08A MCP And Host-Native Tool Convergence
taskType: engineering-acceptance
# Pinned to the commit RC-08AR starts from; the shared branch diverged from
# origin/main long ago.
diffBase: RC08A_BASE
# The candidate touches electron/services/mcp-api.ts, which triggers the UI e2e
# profile. The change is Main-process status labelling covered by
# tests/unit/mcp-api.test.ts; the full UI regression suite is owned by TF-0041.
deferredProfiles:
  e2e: "TF-0041 :: Full Electron UI regression suite is owned by TF-0041 final engineering acceptance; RC-08A changes only Main-process MCP status labels and transport validation, proven by tests/unit/mcp-api.test.ts."
intent: Keep the MCP SDK runtime as the external protocol authority; make Work Provider a catalog/projection; label Git, storage, terminal, and browser as host-native unless backed by a real MCP server. Correct health so it requires a real MCP handshake; configuration presence or HTTP GET is not connected; unsupported WebSocket choices are removed or rejected; Streamable HTTP naming is accurate.
ownedPaths:
  - openclaw_runtime/src/agents/tool-convergence.ts
  - openclaw_runtime/src/agents/tool-convergence.test.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts
  - openclaw_runtime/src/agents/mcp-transport.ts
  - openclaw_runtime/src/agents/mcp-transport-config.ts
  - openclaw_runtime/src/config/types.mcp.ts
  - shared/types/work-provider.ts
  - electron/services/work-providers-api.ts
  - electron/services/mcp-api.ts
  - tests/unit/mcp-api.test.ts
  - tests/unit/work-provider.test.ts
  - tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts
  - harness/specs/tasks/rc08a-mcp-host-native-tool-convergence.md
  - artifacts/runtime-authority-convergence/rc-08a/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
touchedAreas:
  - openclaw_runtime/src/mcp/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/config/**
  - shared/types/**
  - electron/services/**
  - tests/unit/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-08a/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - The MCP SDK runtime remains the external protocol authority; the runtime does not define its own MCP schema.
  - Work Provider is a catalog/projection; Git, storage, terminal, and browser are labelled host-native unless backed by a real MCP server.
  - Health requires a real MCP handshake; configuration presence or HTTP GET is not connected.
  - Unsupported WebSocket choices are removed or rejected; Streamable HTTP naming is accurate.
  - MCP conformance/Inspector-compatible tests pass; catalog and runtime support match; no fake-connected state.
  - Approvals, SecretRef, network policy, and hot reload remain intact.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - defining a parallel MCP schema outside the @modelcontextprotocol/sdk
  - labelling a host-native tool as MCP without a real MCP server path
  - reporting connected from configuration presence or HTTP GET alone
  - a fake-connected state
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - None. Reporting host-native tools and unhandshaken servers as connected was a defect, not a behavior to keep behind a flag; the correction changes status labels only and no tool, call, or approval path.
rollback:
  - Revert the RC-08A commit to restore the previous status labels.
  - No migration rollback is required because no data migration occurs.
requiredTests:
  - pnpm exec vitest run tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts tests/unit/mcp-api.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/tool-convergence.test.ts
  - pnpm exec vitest run tests/unit/work-provider.test.ts tests/unit/work-providers-api.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc08a-mcp-host-native-tool-convergence.md
acceptance:
  - The MCP SDK runtime (@modelcontextprotocol/sdk) is the external protocol authority; the runtime defines no parallel MCP schema.
  - Work Provider is a catalog/projection; Git, storage, terminal, and browser are labelled host-native unless backed by a real MCP server.
  - Health requires a real MCP handshake (SDK initialize); configuration presence or HTTP GET is not connected; no fake-connected state.
  - Unsupported WebSocket choices are removed or rejected; Streamable HTTP naming is accurate.
  - MCP conformance/Inspector-compatible tests pass; catalog and runtime support match.
  - Approvals, SecretRef, network policy, and hot reload remain intact.
  - Product locks remain false; an RC-08A independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-08A MCP And Host-Native Tool Convergence

RC-08A keeps the MCP SDK runtime as the external protocol authority, makes Work Provider a
catalog/projection, and labels Git, storage, terminal, and browser tools as host-native unless
backed by a real MCP server. Health requires a real MCP handshake; configuration presence or HTTP
GET is never treated as connected. Unsupported WebSocket choices are removed or rejected and
Streamable HTTP naming is accurate. MCP conformance/Inspector-compatible tests pass, catalog and
runtime support match, and no fake-connected state exists.
