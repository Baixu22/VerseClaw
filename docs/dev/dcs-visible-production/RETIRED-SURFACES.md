# Retired / non-product surfaces (TASK-P0-06)

> Living list of **do-not-sell / do-not-recommend** surfaces so agents and docs do not present them as live product features.

| Surface | Product status | User path | Replacement |
|---------|----------------|-----------|-------------|
| **CodeGraph plugin** (`openclaw_runtime/extensions/codegraph`) | **RETIRED and removed** · loadable plugin gone | No Settings feature; no bundled plugin or tools | Frozen CodeGraph 1.0.1 impact parity fixture (`harness/specs/fixtures/codegraph-retirement/`) + DCS Fact view tools (opt-in Settings → Developer → DCS Production Flags) |
| **Context provider-registry pilot** (`createContextProviderRegistryPilot` / production pilot path) | **Removed (T1)**; registry helpers remain for non-pilot providers | None | DCS Assembler handlers / FactStore tools |
| **runtime.coding.factViews.enabled** | **Removed as live gate** (TASK-P0-02) | None | `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / Settings `context-view-tools` |
| **“context_* 未注册 / task_phase_change 零 producer”** | **Stale claims** (cleared W1–W5 / prod-repair) | Memory/docs only if undated | Current: tools registered; phase producer on TaskLoop path |

## Agent rules

1. Do not recommend enabling CodeGraph for normal coding; the loadable plugin no longer exists.
2. Do not cite 2026-07-13 convergence “fatal unregistered tools” without re-verifying code.
3. Prefer Settings DCS control plane + Context layers explainer for user-facing truth.
4. Historical design maps under `team/codegraph-role-architecture.md` are architecture archaeology, not product enablement.

## Removal verified 2026-10-17

- Plugin directory, E2E, metrics gate, and effectiveness self-test lane removed.
- Frozen 13-query impact parity baseline retained under `harness/specs/fixtures/codegraph-retirement/`.
- Historical `openclaw_runtime/src/context-engine/block.ts` `"codegraph"` source id remains for stored-block compatibility only.

## Verified 2026-07-22

- Plugin JSON + README retired banner  
- MEMORY index hooks updated  
- Gap program STATUS: TASK-P0-06  
