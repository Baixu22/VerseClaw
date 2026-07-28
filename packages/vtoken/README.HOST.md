# Verse Token Host Integration

## Role

VT (`packages/vtoken`) is the **Working Context Assembly** foundation for ClawX / DCS:

```
Host data (md / tools / memory outputs)
        → ingest*
   UnifiedStore
        → assemble(task_hint, budget)
   prompt + audit fields
        → ## Working Context on agent turns (extraSystemPrompt)
```

**Does not** replace markdown/jsonl storage, `ContextBlock`, BlockStore, compaction, or business memory stores.
Markdown files remain authoritative on disk; VT packs a budgeted, task-relevant Working Context section.

## Production path (default OFF - opt-in / canary)

- Embedded runner injects on attempts via computeVtokenExtraSystemPrompt
  after bootstrap hooks and effective tool policy have resolved
  (openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts).
- Sources: hook-adjusted workspace bootstrap files, effective post-policy tool
  schemas, and enabled DCS BlockStore projections for working-memory /
  compass / role-memory.
- Enable canary:
untime.vtoken.assembly.enabled=true or VERSE_VTOKEN_ASSEMBLY_ENABLED=1.
- Kill-switch: env VERSE_VTOKEN_ASSEMBLY_ENABLED=0, config
untime.vtoken.assembly.enabled=false,
  or VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH=1.

## Diagnostics host-api (default OFF - opt-in)

- Long-lived Python worker: python -m vtoken.host_rpc
- Transport: line-delimited JSON-RPC 2.0 over stdio
- Electron Main bridge: electron/services/vtoken-bridge.ts
- Renderer must call hostApi.vtoken.* only (never spawn Python)
- Enable: VERSE_VTOKEN_BRIDGE_ENABLED=1 or hostApi.vtoken.setEnabled({ enabled: true })
- Kill-switch: VERSE_VTOKEN_BRIDGE_ENABLED=0 or hostApi.vtoken.setEnabled({ enabled: false })

When disabled, APIs return { success: false, disabled: true } and **do not** start Python.

## Methods

| host-api | RPC |
|----------|-----|
| `vtoken.ping` | `vt.ping` |
| `vtoken.open` | `vt.open` |
| `vtoken.ingestPath` | `vt.ingest_path` |
| `vtoken.ingestMarkdown` | `vt.ingest_markdown` |
| `vtoken.ingestTools` | `vt.ingest_tools` |
| `vtoken.ingestMemory` | `vt.ingest_memory` |
| `vtoken.assemble` | `vt.assemble` |
| `vtoken.stats` | `vt.stats` |
| `vtoken.close` | `vt.close` |
| `vtoken.getStatus` | (bridge-local) |
| `vtoken.setEnabled` | (bridge-local) |
| `vtoken.ensureStarted` | starts worker if enabled |

## Local commands

```bash
pnpm vtoken:test      # pytest in packages/vtoken
pnpm vtoken:worker    # manual stdio RPC (dev)
```

## Packaged layout

`packages/vtoken/src` is copied to `extraResources/vtoken/src`. Bridge/gateway set `PYTHONPATH` / `VERSE_VTOKEN_PACKAGE_ROOT` accordingly.

## Developer UI

Settings > Developer (dev mode unlocked) exposes **Verse Token Bridge**:
- enable/disable process-local flag
- status (enabled / running / pid / version / last assemble)
- Start worker / Smoke assemble

Test id root: `settings-vtoken-bridge`.
