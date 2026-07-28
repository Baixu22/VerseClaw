# Context Orchestrator (TF-0002)

> Status: Active
> Date: 2026-07-19
> Single production entry for memory/context enhancement on agent turns.

## Entry

```ts
import {
  computeContextExtraSystemPrompt,
  getLastContextOrchestratorLineage,
} from "./context-orchestrator.js";
```

- **Module**: `openclaw_runtime/src/context-engine/context-orchestrator.ts`
- **Production call site**: `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` only
- **Gateway** (`server-methods/agent.ts`): passes base `extraSystemPrompt` through; does **not** inject memory/VToken

## Stages (stable order)

1. `memory` — chat-turn inject pilot (`runtime.memory.injectPilot`, default off)
2. `vtoken` — Working Context assembly (`runtime.vtoken.assembly`, default off / opt-in)

Both honor `VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH` / `runtime.contextEnhancement.killSwitch` (fail-closed).

## Lineage diagnostics

After each turn orchestration:

- `getLastContextOrchestratorLineage()` → sessionId / runId / requestId / workspace / sources / budget / chars
- `dcsObservability.snapshot()` counters: `contextOrchestratorCalls`, `contextOrchestratorKillSwitchHits`, `contextOrchestratorCharsAdded`

## Acceptance map

| Criterion | Evidence |
|---|---|
| Production path only 1 orchestrator entry | `tests/unit/context-orchestrator-entry-scan.test.ts` |
| Flag off = zero injection | `context-orchestrator.test.ts` flag-off matrix |
| Combination matrix | memory-only / vtoken-only / both / kill switch |
| Diagnostics sources+token | lineage + dcs observability |

## Non-goals

- Does not enable default-on memory/VToken (see `docs/dev/default-config-matrix.md`)
- Does not replace BlockStore / SEKB writeback / TF-0004 E2E
- Does not unify all historical DCS dual-injection CVK paths (Assembler remains separate, still flag-gated)
