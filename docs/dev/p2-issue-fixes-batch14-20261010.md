# P2 issue fix: deprecated zero-call exports

Scope: issue #90. This record is agent-authored and does not claim downstream
consumer interviews.

## Change

The repository's own deprecated-API guard proved these runtime-internal exports
had zero call sites. They were removed:

- `classifyCiaoUnhandledRejection` (extensions/bonjour)
- `validateIPv4AddressInput` (packages/net-policy)
- `getOAuthProviderInfoList`, `refreshOAuthToken` (src/llm/utils/oauth)
- `deliverFinalizableDraftPreview` (src/channels/draft-preview-finalizer)
- `buildExecApprovalInteractiveReply` (src/infra/exec-approval-reply)
- `BARE_SESSION_RESET_PROMPT` (src/auto-reply/reply/session-reset-prompt)
- `formatAcpLifecycleError` (src/agents/command/attempt-execution)
- `resolveAgentModelPrimary` (src/agents/agent-scope)
- `hasGuildPermissionDiscord` (extensions/discord)

Each removal was checked so its private helpers remain referenced by live code;
the deprecated draft-preview facade keeps its two legacy type aliases because
they are still referenced from the channel outbound surface.

These public compatibility exports are intentionally retained because they are
still inside their deprecation window:

- `buildChannelTurnContext`, `filterChannelTurnSupplementalContext`
- `resolveChannelIngressAccess`
- `queueAgentHarnessMessage`
- `PersistedThreadBindingsPayload`

## New guard

`openclaw_runtime/scripts/check-deprecated-zero-call.mjs` reads a curated list in
`scripts/lib/deprecated-zero-call-usage.mjs` and fails when:

- a removed export reappears as an exported declaration;
- a deprecated-public export disappears without a recorded removal decision; or
- a deprecated-public export gains a call-site reference.

A generic unused-export scan is deliberately not used here: the runtime has
thousands of dynamic `import()` sites, so that class of scan is not
authoritative.

## Verification

```text
pnpm --dir openclaw_runtime run check:deprecated-api-usage
pnpm --dir openclaw_runtime run check:deprecated-zero-call
node scripts/run-tsgo.mjs -p tsconfig.core.json --noEmit
node scripts/run-tsgo.mjs -p tsconfig.extensions.json --noEmit
```

The guard is wired into the runtime `check:architecture` chain and the
repository `runtime:source:check` entry point.