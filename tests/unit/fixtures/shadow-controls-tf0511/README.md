# TF-0511 scope conflict

- Task: `TF-0511` — inventory and dispose the remaining COMPASS, Routing Memo, AgentMap and control-plane shadow leaves
- Actor: `codex` | Evidence driver: `agent`
- Status: **blocked-by-scope**; no node activation is performed

## Why the node is not closed

The worktree guard allows only:

- `openclaw_runtime/src/config/runtime-feature-leaves.ts`
- `openclaw_runtime/src/context-engine/`
- `openclaw_runtime/src/agents/`
- `docs/dev/`
- `tests/unit/`

The single-source component disposition catalog still records four relevant families as `experiment`:

- `component.compass-context`
- `component.routing-memo-observation`
- `feature.agent-map`
- `feature.runtime-shadow-governance`

Their final `internal`/`retired` decision must be written to
`shared/dcs/component-disposition-catalog.ts` (and, for any retirement, the corresponding
config and UI surfaces). `shared/` and `src/` are outside the TF-0511 guard, so this node
must not change their statuses or pretend the catalog is already graduated.

A separate runtime-side ledger would violate the node's own instruction to merge with the
component-disposition source rather than create a second list. It was therefore removed.

## Evidence on disk

- `scope-guard.json` — the live TF-0511 guard and allowed paths.
- `feature-leaf-consumer.json` — the current `feature-leaf-consumers` result: exit 1 on
  `coding.patchFlow.enabled`, a TF-0510 retirement residual.
- `compass-retirement-focused.txt` — 3 files / 54 tests passed after aligning the legacy
  COMPASS orchestrator test with the TF-0500 retirement semantics.
- `diff-check.txt` — no whitespace errors.
- `scope-conflict.json` — machine-readable catalog entries, required authority and stop rule.

## Recommended non-destructive decision

Once scope authority is granted for the catalog and relevant surface files:

- keep `compass-context` internal and DCS-only;
- keep `routing-memo-observation` internal diagnostic / scorecard-gated, or explicitly retire
  its dashboard in the surface-cleanup node;
- keep `agent-map` and runtime shadow/governance internal diagnostics;
- keep the local control plane internal;
- keep Observability `advanced` with its explicit `/observability` entry.

This recommendation does not flip a product default, does not authorize public release, GA,
liveReady or productApproved, and does not claim human evidence.
