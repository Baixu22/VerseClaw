---
id: vtoken-foundation-boundary
title: Verse Token Foundation Boundary
type: ai-coding-rule
appliesTo:
  - vtoken-foundation-bridge
  - gateway-backend-communication
requiredProfiles:
  - fast
---

Verse Token (`packages/vtoken`) is the Working Context assembly foundation.

It must not replace DCS `ContextBlock`, BlockStore, compaction, or business memory stores.
It must not flat-replace markdown/jsonl storage: those remain sources of truth on disk.

Correct product use:

```
Host sources (workspace md / tool schemas / memory outputs)
        → ingest*
   UnifiedStore
        → assemble(task_hint, budget)
   ## Working Context (extraSystemPrompt)
```

Production path (default ON):

- Embedded agent attempts call `computeVtokenExtraSystemPrompt` after resolving
  hook-adjusted bootstrap files and effective runtime tools
  (`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`).
- Gateway-owned stdio worker: `openclaw_runtime/src/context-engine/vtoken-rpc-client.ts`.
- Kill-switch: `VERSE_VTOKEN_ASSEMBLY_ENABLED=0` or `runtime.vtoken.assembly.enabled=false`.

Integration rules:

- Reuse the attempt's resolved bootstrap content; do not re-read a divergent file list.
- Reuse the effective post-policy tool catalog; do not expose tools hidden by runtime policy.
- DCS memory inputs must come from the existing BlockStore and remain gated by
  their canonical `runtime.contextBlock.*.enabled` flags.
- A VT outage is best-effort and must not block the agent attempt.

Diagnostics path (host-api, default ON):

- Electron Main bridge: `electron/services/vtoken-bridge.ts` via `hostApi.vtoken.*`.
- Renderer must not spawn Python or call `host_rpc` directly.
- Kill-switch: `VERSE_VTOKEN_BRIDGE_ENABLED=0`.

Settings > Developer may expose VtokenBridgePanel for status/toggle/smoke only.
