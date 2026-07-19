---
id: vtoken-foundation-bridge
title: Verse Token Working Context assembly (production)
type: ai-coding-task
requiredProfiles:
  - fast
requiredRules:
  - vtoken-foundation-boundary
  - backend-communication-boundary
  - contract-first-boundary
---

# Verse Token → ClawX Working Context assembly

## Goal

Use `packages/vtoken` as the Working Context assembly layer under existing ClawX structure:

- **Sources**: workspace bootstrap markdown, optional tool schemas / memory outputs (md/jsonl stay on disk).
- **Path**: ingest* → UnifiedStore → assemble(task_hint, budget) → `## Working Context` on `extraSystemPrompt`.
- **Not a flat replace** of md storage, BlockStore, compaction, or business memory.

## Key paths

- packages/vtoken/src/vtoken/**
- packages/vtoken/src/vtoken/host_rpc.py
- openclaw_runtime/src/context-engine/vtoken-rpc-client.ts
- openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts
- openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts (production injection seam)
- electron/services/vtoken-bridge.ts (diagnostics host-api)
- electron/services/vtoken-api.ts
- electron/gateway/config-sync.ts (VERSE_VTOKEN_PACKAGE_ROOT)
- shared/vtoken/types.ts
- src/components/settings/VtokenBridgePanel.tsx

## Expected behavior

- Product default **ON** for assembly and host-api bridge.
- Kill-switch: `VERSE_VTOKEN_ASSEMBLY_ENABLED=0` / `runtime.vtoken.assembly.enabled=false` / `VERSE_VTOKEN_BRIDGE_ENABLED=0`.
- Embedded agent attempts append budgeted Working Context after the runtime has
  resolved hook-adjusted bootstrap files and effective tools; failures never block the turn.
- Enabled DCS working-memory / compass / role-memory Blocks may be projected
  through the existing BlockStore into VT memory inputs. VT must honor the
  corresponding DCS feature flags and must not query a parallel store.
- Renderer never spawns Python; only `hostApi.vtoken.*` for diagnostics.

## Required tests

- pnpm vtoken:test
- pnpm exec vitest run tests/unit/vtoken-bridge.test.ts tests/unit/vtoken-bridge-panel.test.tsx --reporter=dot
- openclaw_runtime unit: chat-turn-vtoken-injection.test.ts
- pnpm contract:check
