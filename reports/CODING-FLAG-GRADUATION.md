# CODING Flag Graduation Matrix

**Updated**: 2026-07-15  
**Rule**: No production default flip without loop evidence + owner sign-off.

| Flag / path | Default | Class needed to flip | Owner gate | Kill switch | Notes |
|---|---|---|---|---|---|
| `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / Settings context-view-tools | **false** | done (loop) + live C1 A/B + product | product | unset env / Settings off | **TASK-P0-02**: sole gate for Fact view tools; `runtime.coding.factViews` removed/ignored |
| `runtime.coding.factViews.enabled` | **REMOVED** | n/a | n/a | n/a | Dead default-true leaf; do not reintroduce |
| `runtime.coding.parseOnTouch.enabled` | **true** | done (loop) | already on main | set false | C0 |
| `runtime.coding.staleWriteGuard.enabled` | **false** | done (loop) + false-block budget | product | leave false | shadow on main |
| `runtime.coding.writeJournal.enabled` | **true** | done (loop) | already on main | set false | C2-8 |
| `runtime.contextBlock.tool-registry.enabled` | **false** | done (loop) after **live** C1 A/B | product | leave false | C1 sim only today |
| `runtime.contextBlock.working-memory.enabled` | **false** | done (loop) after live C1 | product | leave false | C1 |
| `runtime.coding.worktree.backend` | **inprocess** | done (loop) multi-worker field | product | set inprocess | C4-H git opt-in |
| `runtime.coding.symbolLease.mode` | **memory** | done (loop) multi-process | product | set memory | C5-H wal opt-in |
| `runtime.coding.patchFlow.default` | **false** | done (loop) lead serial path | product | leave false | recommend API only |
| `runtime.coding.sekb.experienceShadow` | **false** | done (loop) stable window | product | leave false | cutover never auto |
| Assembler production flip | **off** | live chat corpus + flip gates | product | N/A | C6-H evidence only |

## Graduation decision this round

**No flips.** Closeout lands capability + evidence only.