---
id: prompt-cache-tool-mask-auto-20261012
title: Keep large tool catalogs on a stable on-demand prompt prefix (issue #166)
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Add an explicit opt-in Tool Search auto mode that folds large tool catalogs behind a fixed control-tool surface based on tool count or schema size, so adding or removing hidden tools does not change the provider tools prefix.
expectedUserBehavior:
  - With tools.toolSearch.auto=true, a tool set at or above the configured count or schema-size threshold exposes only the fixed Tool Search control tools.
  - Adding or disabling a hidden tool changes the catalog contents, not the provider-visible tools array or its cache shape hash.
  - Below threshold, or with enabled=false, the original tool array is preserved and control tools are not leaked.
  - A tool removed by policy is absent from the catalog and cannot be silently executed through the Tool Search call surface.
touchedAreas:
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/code-mode.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/zod-schema.agent-runtime.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - tests/unit/tool-mask-auto-catalog.test.ts
  - harness/specs/tasks/prompt-cache-tool-mask-auto-20261012.md
  - docs/dev/prompt-cache-tool-mask-auto-20261012.md
requiredRules:
  - prompt-cache-observation-boundary
  - active-config-guards
  - comms-regression
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/tool-mask-auto-catalog.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.core.json
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/prompt-cache-tool-mask-auto-20261012.md
acceptance:
  - Auto activation is based on effective tool count or serialized schema bytes and is disabled by default.
  - A set at or above threshold exposes only fixed control tools; count changes among hidden members preserve toolsHash and prefixShapeHash.
  - Below-threshold sets and explicit enabled=false preserve the original tool array and do not expose controls.
  - Removed tools are absent from the catalog; no test or implementation claims that they remain executable.
  - The change is reversible, does not alter provider cache-control, and does not claim a hit-rate or cost improvement.
docs:
  required: true
  paths:
    - docs/dev/prompt-cache-tool-mask-auto-20261012.md
---

# Scope

This is an execution-side prompt-cache shape repair. It reuses the existing
OpenClaw Tool Search catalog and its structured/control-tool surfaces rather
than adding a second masking engine.

`tools.toolSearch.auto` is opt-in and default false. Existing explicit
`enabled` behavior remains authoritative, including `enabled:false` overriding
auto. When auto activates, only the already-defined control tools are visible
to the provider; hidden catalog entries can change without changing the
provider-visible tools prefix.
