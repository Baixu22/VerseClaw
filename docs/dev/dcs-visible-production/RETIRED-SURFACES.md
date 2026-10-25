# Retired / non-product surfaces (TASK-P0-06)

> Living list of **do-not-sell / do-not-recommend** surfaces so agents and docs do not present them as live product features.

| Surface | Product status | User path | Replacement / rollback |
|---------|----------------|-----------|-------------------------|
| **CodeGraph plugin** (`openclaw_runtime/extensions/codegraph`) | **Retired and removed** · loadable plugin gone | No Settings feature; no bundled plugin or tools | Frozen CodeGraph impact-parity fixture; DCS Fact view tools |
| **VToken assembly and bridge** (`runtime.vtoken.assembly.enabled`, `VERSE_VTOKEN_BRIDGE_ENABLED`) | **Retired by TF-0496** after real provider usage missed the 10% materiality bar | No renderer toggle, no product panel, no provider injection, and the sidecar never starts | Kept inert for compatibility; rollback requires a new frozen A/B and materiality pass, never a silent enable |
| **Dreams page** (`/dreams`) | **Retired by TF-0500** · legacy route redirects, page is not mounted | No product navigation button | Dreaming-derived data remains internal maintenance state only |
| **Image Generation** | **Developer/test-only**, not product navigation | No sidebar product entry; direct route remains gated by the shared developer/test access policy | Re-enable a product entry only through a new owning-node decision |
| **UI v2 showcase** (`/ui-v2-showcase`) | **Developer/test-only showcase**, not a product capability | No product navigation | Shared dev/test access policy |
| **Symbol lease** | **Retired by TF-0510** · code retained, unreachable | None | Isolated worktrees plus the merge queue |
| **Patch flow** | **Retired by TF-0510** · code retained, unreachable | None | Ordinary governed tool writes plus the write journal |
| **Context provider-registry pilot** | **Removed**; registry helpers remain for non-pilot providers | None | DCS Assembler handlers / FactStore tools |
| **runtime.coding.factViews.enabled** | **Removed as a live gate** | None | Automatic context view tools with an env rollback/override |
| **“context_* 未注册 / task_phase_change 零 producer”** | **Stale claim** | Memory/docs only if undated | Verify the current tool catalog and TaskLoop producer before citing |
## Agent rules

1. Do not recommend enabling VToken, CodeGraph, Dreams, symbol lease or patch flow; these paths are retired or inert.
2. Do not treat a developer/test-only route as a shipped product surface.
3. Do not cite old "unregistered context tools" claims without re-verifying the current catalog.
4. Use Settings > General for the single Workspace Context switch and the Memory page for accepted/candidate review.
5. Historical design maps remain architecture archaeology, not product enablement evidence.

## Current evidence

- VToken retirement and rollback: `docs/dev/vtoken-retirement-decision.md`, `tests/unit/fixtures/vtoken-tf0496/verification.json`.
- Dreams retirement and surface cleanup: `tests/unit/fixtures/surface-cleanup-tf0505/verification.json`.
- Coding control retirement: `openclaw_runtime/src/agents/coding-control-dispositions.ts` and its acceptance evidence.
- Context view tools: `tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/verification.json`.
## Removal verified 2026-10-17

- Plugin directory, E2E, metrics gate, and effectiveness self-test lane removed.
- Frozen 13-query impact parity baseline retained under `harness/specs/fixtures/codegraph-retirement/`.
- Historical `openclaw_runtime/src/context-engine/block.ts` `"codegraph"` source id remains for stored-block compatibility only.

## Verified 2026-07-22

- Plugin JSON + README retired banner  
- MEMORY index hooks updated  
- Gap program STATUS: TASK-P0-06  
