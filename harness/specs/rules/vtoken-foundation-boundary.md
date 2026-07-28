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

Production path (**default OFF — opt-in / canary**):

- Embedded agent attempts call `computeVtokenExtraSystemPrompt` after resolving
  hook-adjusted bootstrap files and effective runtime tools
  (`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`).
- Gateway-owned stdio worker: `openclaw_runtime/src/context-engine/vtoken-rpc-client.ts`.
- Enable canary: `runtime.vtoken.assembly.enabled=true` **or**
  `VERSE_VTOKEN_ASSEMBLY_ENABLED=1`.
- Kill-switch (instant): `VERSE_VTOKEN_ASSEMBLY_ENABLED=0`,
  `runtime.vtoken.assembly.enabled=false`, or the master enhancement kill switch
  (`VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH=1` /
  `runtime.contextEnhancement.killSwitch=true`).

Integration rules:

- Reuse the attempt's resolved bootstrap content; do not re-read a divergent file list.
- Reuse the effective post-policy tool catalog; do not expose tools hidden by runtime policy.
- DCS memory inputs must come from the existing BlockStore and remain gated by
  their canonical `runtime.contextBlock.*.enabled` flags (all default false).
- A VT outage is best-effort and must not block the agent attempt.
- Do not claim product default-on while evidence is insufficient; see
  `docs/dev/default-config-matrix.md`.

Diagnostics path (host-api, **default OFF — opt-in**):

- Electron Main bridge: `electron/services/vtoken-bridge.ts` via `hostApi.vtoken.*`.
- Renderer must not spawn Python or call `host_rpc` directly.
- Enable: `VERSE_VTOKEN_BRIDGE_ENABLED=1` or `hostApi.vtoken.setEnabled({ enabled: true })`.
- Kill-switch: `VERSE_VTOKEN_BRIDGE_ENABLED=0`, assembly env kill, or enhancement kill switch.

Settings > Developer may expose VtokenBridgePanel for status/toggle/smoke only.
