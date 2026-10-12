# Automatic Tool Search masking for prompt prefix stability (#166)

## Problem

Tool Search already compacts large OpenClaw/MCP/client inventories behind
control tools, but it only activated when an operator explicitly configured
Tool Search. A large catalog could therefore change its visible `tools` array
when a skill or MCP member was enabled, disabled, or reloaded.

## Change

`tools.toolSearch.auto` is a new opt-in switch, default `false`. It activates
Tool Search when either the effective tool count or serialized schema size
reaches the configured thresholds:

```yaml
tools:
  toolSearch:
    auto: true
    mode: tools
    autoMinTools: 20
    autoMinSchemaBytes: 16000
```

Explicit `enabled: false` still wins over auto. Explicit `enabled: true` still
always enables Tool Search. Auto mode counts the effective non-control tools;
control tools themselves do not push a small catalog over the threshold.

When active, the provider sees only the fixed Tool Search control tools. The
catalog remains the source of truth for hidden tools, so adding or removing a
hidden member changes catalog contents but not the provider-visible tools
array. A removed tool does not remain callable through the catalog.

## Verification

- `pnpm exec vitest run tests/unit/tool-mask-auto-catalog.test.ts`
- `pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.core.json`
- `pnpm run typecheck`
- `pnpm run comms:replay` and `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/prompt-cache-tool-mask-auto-20261012.md`

The focused test compares `summarizeProviderPayloadCacheShape(...).toolsHash`
and `.prefixShapeHash` for hidden-member add/remove cases and confirms
below-threshold/disabled behavior.

## Boundaries

- This is not a new scheduler, mask executor, permission bypass, keepalive,
  TTL refresh, or provider cache-control rewrite.
- It does not modify the observed-hit-rate baseline or claim a cache-hit,
  throughput, or cost improvement.
- Auto mode is explicit opt-in; default tool exposure remains unchanged.
