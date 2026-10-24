# TF-0511 shadow/control dispositions

- Task: `TF-0511` — inventory and dispose the remaining COMPASS, Routing Memo, AgentMap and control-plane shadow leaves
- Actor: `codex` | Evidence driver: `agent`
- Status: **complete**
- Release boundary: no public release, GA, liveReady or productApproved claim
- Default boundary: no product default or product lock is changed by this node

## Decision summary

| Component | Disposition | Implementation state | Product entry | Gap |
|---|---|---|---|---|
| `component.compass-context` | internal | implemented-opt-in / DCS-only | none | none |
| `component.routing-memo-observation` | internal | implemented-diagnostic-only | none | none |
| `feature.agent-map` | internal | implemented-diagnostic-only | none | none |
| `feature.runtime-shadow-governance` | internal | implemented-diagnostic-only | none | none |
| `feature.local-control-plane` | internal | implemented-diagnostic-only | none | none |
| `surface.observability` | advanced | implemented-opt-in | `/observability` | none |

The single source of truth is
`shared/dcs/component-disposition-catalog.ts`. The entries above are selected by
`implementationNodeId === "TF-0511"`; this pack does not define a second disposition
manifest.

## Important boundaries

- COMPASS is a bounded, default-off DCS candidate source. Its old direct pre-reply
  prompt injection was retired by TF-0500 and the orchestrator tests now assert that
  retired behavior.
- Routing Memo remains scorecard-gated. It is an internal observation/diagnostic
  boundary; active routing still requires same-session, server-resolved Task Loop
  quality authority.
- AgentMap remains readonly. All prompt-candidate gates default off and require
  explicit invocation plus a valid caller-owned result.
- Runtime shadow/governance leaves and local control-plane reports are internal,
  observe-only diagnostics and cannot authorize prompts, tools, provider ordering,
  transport, completion or memory effects.
- Observability remains an explicit advanced page; it records evidence but does not
  grant execution or approval authority.
- No additional family is retired by this node. The TF-0500 COMPASS pre-reply
  injection retirement is preserved.

## Evidence

- `catalog-readback.json` — current six-entry projection from the single-source catalog,
  artifact hashes and zero-gap/completion checks.
- `acceptance.json` — the five TF-0511 acceptance criteria with agent attribution.
- `feature-leaf-consumer.json` — 112 leaves, zero unpinned zero-consumer leaves.
  `coding.patchFlow.enabled` is explicitly pinned as a TF-0510 retirement residual.
- `compass-retirement-focused.txt` — 3 files / 54 tests passed.
- `scope-guard.json` — the expanded TF-0511 guard used for this closeout.
- `diff-check.txt` — clean diff check.
- `task-forest-proposal.json` — the final closeout proposal input.

## Unverified boundary

- This is data/contract disposition evidence, not a new live-provider or Electron E2E
  run. The existing focused runtime suites and static checks are the evidence grade.
- The Routing Memo dashboard remains user-visible; any physical surface removal is
  future surface-cleanup work, not a claim made here.
- No product default was flipped. No VerseGit node, worktree or file was touched.
- Agent-driven only; no human evidence is claimed.
