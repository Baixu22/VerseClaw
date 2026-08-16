# Workflow Viz B2-02 Handoff (2026-08-15)

## Stop State

- The previous agent must stop here. Do not apply the pending task-forest proposal or implement code until the user explicitly confirms it.
- Worktree: `C:\Users\27933\Desktop\clawx\ClawX-wv-b0`
- Branch: `codex/wv-b1-02-03`
- Current `HEAD`: `9be4f9f06307b46480eca70db68f36c1220e82c2` (`feat(trajectory): add deterministic assembler core`)
- Merge base with local `main`: `1ee0368a652718dcce04e323f7f9998e6c70241e`
- No rebase, merge, push, or `main` modification has occurred.

The only pre-existing uncommitted change is the pending proposal below. This handoff and the `LATEST.md` pointer are intentionally uncommitted continuity documents. Do not discard, reset, checkout, or overwrite them.

```text
.agent-workbench/task-forest/proposals/TFP-workflow-viz-b2-02-bridge-and-store-20260815.json
SHA-256: F0E50D90FC29524BFEC549692DC70B4D12CA0F66C09F6BB96D1601BB4008E798
```

## Completed Workflow Viz Work

The WV root is `TF-0056` (`Workflow Viz 事实源与可恢复投影重建`). The following cards are done:

| Task | Commit | Result |
| --- | --- | --- |
| WV-B1-01 / TF-0057 | `c9d48b580` | v2 lifecycle schema, validation/replay, and explicit v1 read compatibility |
| WV-B1-02 / TF-0058 | `4451f2704` | ordinary embedded-session v2 producer |
| WV-B1-03 / TF-0059 | `71d7268a0` | Gateway `readFrom`/subscribe/unsubscribe and gap repair |
| WV-B1-04 / TF-0060 | `429fd39f1` | Main-owned trajectory hydration/subscription projected into existing Observability traces |
| WV-B2-01 / TF-0061 | `9be4f9f06` | fixture-first deterministic renderer assembler (`replace`/`prepend`/`append`, pending contexts, O(D) append, publication throttling) |

The B2-01 implementation and its task-forest closure were tested in the main worktree and a clean detached worktree. The code commit is already complete; do not alter it merely to start the next card.

## Critical Architecture Finding

`src/lib/trajectory-assembler/types.ts` accepts only `TrajectoryEventV2`. It must not receive reverse-engineered trace/span data.

The current renderer does **not** receive raw v2 trajectory events:

- `shared/types/observability.ts` defines `ObservabilityRuntimeEvent` as `trace.*`, `span.*`, and `event.recorded` payloads.
- `electron/services/observability-api.ts` calls `ctx.onRuntimeEvent({ type, trace })` after Main has already projected accepted trajectory rows into `ObservabilityTrace`.
- `electron/main/ipc-handlers.ts` forwards that payload on the existing `observability:runtime-event` channel.
- `src/stores/observability.ts` reacts by waiting 150 ms then pulling dashboard/graph snapshots again.
- `src/stores/session-activity.ts` receives eight older event channels and applies handwritten reducers using wall-clock last-wins and `Date.now()` fallbacks.

Do not solve that by:

- reconstructing `TrajectoryEventV2` from `ObservabilityTrace`, spans, or graph rows;
- guessing a missing stable ID from the most recent context;
- reading JSONL files in the renderer;
- calling Gateway HTTP/WebSocket or IPC directly from a renderer page/store;
- defining a parallel trajectory event format or event authority.

`session-activity` also contains Git, terminal, queue, mission, task-loop, and subagent data which B1 v2 does not model. Those independent domains retain their existing explicit owners. Only the v2-covered run/turn/step/tool lifecycle must move to assembler output.

## Pending Proposal: Do Not Apply Without Confirmation

Proposal: `TFP-workflow-viz-b2-02-bridge-and-store-20260815`

It intentionally creates two sequential cards under `TF-0056`:

1. `WV-B2-02A Renderer v2 轨迹供数桥接` is the sole proposed ready card.
   - Main owns a recoverable v2 history query and realtime delivery through the existing host-api/host-events boundaries.
   - It must carry validated raw `TrajectoryEventV2` records in seq order. v1 must remain explicit legacy data and must never be adapted into v2.
   - It may reuse B1-03's existing Main-owned `observability.readFrom` and subscription machinery, but must add no Gateway RPC or subscription protocol.
   - It must make cold history and realtime delivery use an explicit `asOfSeq`/dedupe handoff so no record is lost or double-appended.
   - It does not migrate stores or implement B3.

2. `WV-B2-02 现有 store 并轨` remains proposed and depends on B2-02A, B2-01, and B1-04.
   - `src/stores/session-activity.ts` and `src/stores/observability.ts` will consume B2-01 node snapshots for v2 lifecycle state.
   - It removes lifecycle-specific handwritten reducers, `Date.now()` fallbacks, and wall-clock last-wins only after raw v2 delivery exists.
   - Existing mock scenarios must become deterministic assembler fixtures.

The proposal was saved and prevalidated through `task_forest.py proposal-save`; it has not been applied, validated, exported, staged, or committed. Current task graph has not changed.

## Exact Resume Procedure

First obtain an explicit user message confirming this exact proposal ID. A generic request to continue development is not enough because the user mandated `proposal -> confirmation -> apply`.

After confirmation, run from the current worktree:

```powershell
python C:\Users\27933\.codex\skills\task-forest\scripts\task_forest.py proposal-apply TFP-workflow-viz-b2-02-bridge-and-store-20260815 --yes
python C:\Users\27933\.codex\skills\task-forest\scripts\task_forest.py validate
python C:\Users\27933\.codex\skills\task-forest\scripts\task_forest.py export
```

Inspect the exported `task-forest.html`, then start **only** B2-02A. Do not start B2-02 or B3 in the same card.

## B2-02A Implementation Contract

Create a focused task spec, suggested path:

```text
harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
```

The spec must use scenario `gateway-backend-communication`, include at least these required rules:

```text
renderer-main-boundary
backend-communication-boundary
comms-regression
```

Run before implementation:

```powershell
pnpm harness context --spec harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
```

Likely owned implementation surfaces, to be confirmed by the spec/context:

```text
electron/main/ipc-handlers.ts
electron/services/observability-api.ts
electron/services/observability-trajectory-index.ts
shared/types/observability.ts
shared/host-events/contract.ts
shared/host-api/contract.ts
src/lib/host-api.ts
tests/unit/observability-trajectory-*.test.ts
harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
.agent-workbench/task-forest/**
```

Use `apply_patch` for all manual file edits. Do not modify files listed by `pnpm run lint:dcs`; do not change B1 schema/producers/Gateway protocol, B2 stores, B3, TF-0021, or Runtime Authority during B2-02A.

The current `ObservabilityTrajectoryProjector` already retains accepted rows in per-session state and rejects invalid/duplicate/gapped seq. Prefer exposing only the exact validated v2 subset of that same state, plus Main-owned cold recovery using the existing B1 path. Do not use `electron/services/observability-trajectory.ts` to feed renderer assembly: it scans local files permissively and sorts by timestamps, not the B1 seq contract.

## Required B2-02A Tests and Gates

At minimum cover:

- Main rejects an invalid or v1 row at the raw-v2 renderer boundary.
- Stable IDs and full `state` values survive JSON serialization and the host boundary unchanged.
- History plus realtime events produces the same ordered v2 sequence as full Main replay.
- Duplicates and late/older events have a defined, deterministic dedupe/rejection behavior.
- A v1 legacy fallback is explicitly reported and never enters the v2 assembler input.
- No renderer code adds direct IPC, Gateway HTTP, or WebSocket use.

Run the task spec's required commands, plus the established WV gates:

```powershell
pnpm harness validate --spec <b2-02a-task-spec>
pnpm harness run --spec <b2-02a-task-spec> --dry-run
pnpm run typecheck:node
pnpm run typecheck:web
pnpm run build:runtime
pnpm run comms:replay
pnpm run comms:compare
pnpm run lint:bom
```

Run ESLint for every changed file and repeat focused tests/build in a clean detached worktree. Preserve the existing clean-worktree bootstrap used by B2-01:

```powershell
pnpm install --offline --ignore-scripts --frozen-lockfile
pnpm --dir openclaw_runtime install --offline --ignore-scripts --frozen-lockfile
pnpm run ext:bridge
```

Finish B2-02A with its own close proposal, user confirmation, validation/export, explicit file staging, and one commit. Do not use `git add .`, `git add -A`, `git checkout <path>`, or `git reset --hard`.

## References to Read First

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `docs/dev/workflow-viz-rebuild/WORKFLOW-VIZ-ORCHESTRATION-PLAN.zh-CN.md`
4. This handoff and `docs/dev/handoffs/LATEST.md`
5. `.agent-workbench/task-forest/proposals/TFP-workflow-viz-b2-02-bridge-and-store-20260815.json`
6. `harness/specs/tasks/workflow-viz-b1-04-electron-trajectory-supply.md`
7. `src/lib/trajectory-assembler/types.ts` and `assembler.ts`
8. `electron/services/observability-api.ts` and `observability-trajectory-index.ts`
9. `shared/types/observability.ts`, `shared/host-events/contract.ts`, and `src/lib/host-events.ts`
10. `src/stores/session-activity.ts` and `src/stores/observability.ts`

## Handoff Integrity

- No code was changed in this handoff turn.
- Do not claim B2-02A or B2-02 is complete; neither has begun.
- The active user goal was marked `blocked` solely because proposal confirmation was required and did not arrive. Once the user confirms, resume it as a fresh goal turn.
