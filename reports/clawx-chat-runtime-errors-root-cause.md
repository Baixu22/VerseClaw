# ClawX Chat Runtime Errors Root Cause Report

Date: 2026-06-12

## Scope

This report investigates the two real Chat page failures reported from ClawX:

1. `OpenAI/Azure OpenAI transport is not available in the ClawX pruned source runtime`
2. `Agent failed before reply: Sandbox image not found: openclaw-sandbox:bookworm-slim...`

The goal is root-cause confirmation and a safe follow-up plan, not immediate broad changes.

## Executive Summary

The two errors are separate layers exposed in sequence.

- The OpenAI/Azure transport error is a source-runtime pruning defect. The active source runtime contains a stubbed `openai-transport-stream.ts` that always throws for OpenAI, Azure OpenAI, and OpenAI-compatible completions/responses transports. DeepSeek is configured as `api: "openai-completions"`, so it also hits this missing transport.
- The sandbox image error came from an earlier source-runtime session where Docker sandboxing was still effectively enabled. The current isolated source-runtime config now has `sandbox.mode: "off"`, so the current persistent failure is no longer the Docker image check; it has advanced to the missing OpenAI-compatible transport.
- ClawX source-runtime isolation and channel pruning are mostly working: the Gateway launches with `runtime=source` and `channels=skipped(source runtime isolated config)`. The failure is inside the agent/model transport layer, not the channel startup layer.

## Evidence

### Runtime Mode

ClawX log confirms the Gateway is launched in source mode:

```text
Starting Gateway process (mode=dev, runtime=source, ... cwd="...\openclaw_runtime", ... channels=skipped(source runtime isolated config))
```

This means the Chat request is not primarily using the npm-installed runtime path for the latest failure.

### Active Model

The source runtime session transcript shows the second test message selected:

```json
{
  "provider": "deepseek",
  "modelApi": "openai-completions",
  "modelId": "deepseek-v4-pro"
}
```

The user config and isolated source config both contain only the `deepseek` provider. DeepSeek is OpenAI-compatible, so it routes through OpenAI completions transport.

### OpenAI Transport Is Stubbed

File: `openclaw_runtime/src/agents/openai-transport-stream.ts`

The file defines:

```ts
const PRUNED_PROVIDER_ERROR =
  "OpenAI/Azure OpenAI transport is not available in the ClawX pruned source runtime";
```

and all relevant exported factories return a stream function that throws this error:

- `createOpenAIResponsesTransportStreamFn`
- `createOpenAICompletionsTransportStreamFn`
- `createAzureOpenAIResponsesTransportStreamFn`
- `buildOpenAICompletionsParams`

The factories are used by:

- `openclaw_runtime/src/agents/provider-transport-stream.ts`
- `openclaw_runtime/src/llm/providers/stream-wrappers/openai.ts`

Therefore the failure is not an API key issue, proxy issue, model typo, or Gateway connectivity issue. The implementation is missing by construction.

Additional clue: `openclaw_runtime/src/gateway/openai-http.ts` comments reference high line numbers in `openai-transport-stream.ts`, but the current file is only a short stub. This strongly suggests the original implementation existed before pruning.

### Sandbox Error Is Older But Real

The source runtime transcript at:

`C:\Users\27933\AppData\Roaming\clawx\openclaw-source-state\agents\main\sessions\9c9b30b5-2945-440a-ab77-064d549a1287.jsonl`

contains two relevant events:

- `2026-06-12T10:56:23.521Z`: first test failed with `Sandbox image not found: openclaw-sandbox:bookworm-slim`
- `2026-06-12T15:14:00.378Z`: later test failed with `OpenAI/Azure OpenAI transport is not available...`

This shows the sandbox error happened first, then after sandbox fallback/config cleanup the run advanced far enough to fail at model transport.

### Current Isolated Sandbox Config

Current isolated source runtime config:

`C:\Users\27933\AppData\Roaming\clawx\openclaw-source-state\openclaw.json`

has:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "off",
        "backend": "docker",
        "scope": "session",
        "workspaceAccess": "ro",
        "docker": {
          "network": "none"
        }
      }
    },
    "list": [
      {
        "id": "main",
        "sandbox": {
          "mode": "off"
        }
      }
    ]
  }
}
```

User global config:

`C:\Users\27933\.openclaw\openclaw.json`

still has:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "backend": "docker",
        "scope": "session",
        "workspaceAccess": "ro",
        "docker": {
          "network": "none"
        }
      }
    }
  }
}
```

The source runtime isolation code sets:

- `OPENCLAW_STATE_DIR`
- `OPENCLAW_CONFIG_PATH`
- `OPENCLAW_HOME`
- `OPENCLAW_SKIP_LEGACY_STATE_MIGRATION=1`
- `OPENCLAW_NO_AUTO_UPDATE=1`
- `OPENCLAW_DEFER_STARTUP_SIDECARS=1`

for the Gateway process.

The earlier sandbox error was likely from a stale/older effective config or process snapshot before the current schema-safe fallback fully took effect. There was also an older isolated config backup containing `autoDisabledReason`, which caused repeated "Invalid config" startup failures until removed from the written config.

## Conflict Assessment

### Channels

The reported Chat failures are not caused by channel startup conflict. Logs show:

```text
channels=skipped(source runtime isolated config)
```

So ClawX's decision to use its own channel design and skip source runtime channels is consistent with the current error path.

Potential channel conflict remains a separate pruning concern, but it is not the cause of these two Chat failures.

### Runtime Pruning

The pruning boundary is currently too aggressive for model providers. OpenAI-family transport must not be pruned if ClawX supports:

- OpenAI
- Azure OpenAI
- OpenAI-compatible providers such as DeepSeek
- Any provider configured with `api: "openai-completions"` or `api: "openai-responses"`

Anthropic and Google transport availability should also be audited, but the live failure is OpenAI-family transport.

### Sandbox Fallback

ClawX should not mutate the user's global `~/.openclaw/openclaw.json` just to make source runtime safe. The current direction, an isolated source-runtime config under ClawX userData, is correct.

However, the fallback should be hardened so that when the Docker image is missing:

- no source-runtime agent path can re-enable Docker sandboxing from user/global config
- invalid metadata fields such as `autoDisabledReason` are never written into `openclaw.json`
- Gateway restart/reload clears stale pinned config snapshots
- user-facing status makes clear that sandbox was auto-disabled for ClawX source runtime only

## Recommended Fix Plan

### Phase 1: Restore Mandatory OpenAI-Compatible Transport

Goal: make `deepseek/deepseek-v4-pro` work in source runtime.

Recommended safe options, in order:

1. Restore the original full implementation of `openclaw_runtime/src/agents/openai-transport-stream.ts` from the unpruned OpenClaw source, preserving current exports.
2. If full restore is too large, restore at minimum:
   - OpenAI completions transport
   - OpenAI responses transport
   - Azure OpenAI responses transport
   - `buildOpenAICompletionsParams`
   - credential/env injection behavior expected by provider config
3. Add a runtime capability check that fails early at Gateway readiness if a configured model requires an OpenAI-family transport that is stubbed/missing.

Avoid replacing this with a quick generic fetch unless it preserves the existing runtime's streaming event contract, tool-call shaping, usage accounting, cancellation, and auth-profile semantics.

### Phase 2: Harden Source Runtime Sandbox Isolation

Goal: prevent Docker image errors when ClawX source runtime auto-disables sandbox.

Recommended checks:

1. Add/keep tests around `applySourceRuntimeSandboxAutoFallback()`:
   - defaults sandbox becomes `mode: "off"`
   - every agent list entry sandbox becomes `mode: "off"`
   - no non-schema fields are written
2. Confirm runtime reload path uses the isolated config after Gateway restart and does not retain an older pinned config snapshot.
3. Consider an explicit source-runtime env override such as `CLAWX_SOURCE_RUNTIME_FORCE_SANDBOX_OFF=1`, read only by ClawX integration code, if config-only fallback remains leaky.
4. Do not modify the user's global sandbox setting automatically.

### Phase 3: Keep Channel Pruning Separate

Goal: avoid conflating channel pruning with model transport.

Keep source runtime channels skipped unless ClawX explicitly needs runtime-owned channel methods. Current Chat failure does not require enabling runtime channel startup.

Maintain/verify required Gateway RPC methods independently:

- `chat.send`
- `chat.history`
- `chat.abort`
- `models.*`
- `agents.*`
- `channels.status/start/stop/logout` only as ClawX UI compatibility shims, not as runtime channel daemons

## Suggested Validation

After transport restoration or sandbox hardening:

```powershell
rtk pnpm run build:runtime
rtk pnpm run typecheck:node
rtk pnpm run typecheck:web
rtk pnpm run comms:replay
rtk pnpm run comms:compare
```

For focused regression tests, prefer:

- `tests/unit/config-sync-source-runtime.test.ts`
- Gateway source runtime readiness tests
- provider transport tests for `openai-completions` and `openai-responses`
- a Chat send smoke test using DeepSeek/OpenAI-compatible config with sandbox image absent

## Current Status

No code behavior was changed by this report.

The most important next fix is restoring the real OpenAI/OpenAI-compatible transport in the pruned source runtime. Once that is fixed, re-test Chat. If the Docker sandbox error returns in a fresh session after Gateway restart, treat it as an active isolation bug; otherwise it was a stale earlier config/process issue already superseded by the current sandbox fallback.
