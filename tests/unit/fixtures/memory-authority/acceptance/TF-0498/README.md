# TF-0498 acceptance evidence

- Task: `TF-0498` — one Memory user surface for candidates, review, approval, delete and export
- Actor: `codex`
- Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded
- Release boundary: public release, GA, liveReady and productApproved remain unclaimed

## Delivered surface

- `MemoryProductSurface/v1` defines one product concept (`memory`) and one action set: view, review, approve, delete, export, remember.
- The existing Agent-page Role Memory panel is the single management surface. The runtime fact candidate queue moved inside this panel; no second route or parallel Memory UI was added.
- Candidate capture persists in the existing queues but is not retrievable or injectable before approval.
- `MemoryExport/v1` exports accepted memory, candidate queue, proposal history, injection history and the current product semantics as a local JSON download.
- The visible Delete action uses the existing tombstone transition, removes the card from retrieval/injection and preserves audit history instead of claiming an immediate hard delete.
- The master switch semantics are explicit: off retains managed cards on disk, blocks read/write/injection, and leaves native OpenClaw memory separate and unchanged.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| user can view, approve, delete and export from one Memory panel | `memory-surface.spec.ts`; `raw-evidence.json#surface`; `raw-evidence.json#acceptanceCriteria[0]` |
| unapproved candidates are not retrievable/injected and the queue persists | `raw-evidence.json#candidateIsolation`; `memory-surface-contract.test.ts`; `propose-facts-confirm-queue.test.tsx`; `role-memory-v2.test.ts` |
| close semantics match production consumers and legacy behavior is explicit | `raw-evidence.json#masterSwitch`; `role-orchestration-methods.test.ts` disabled read/write case; `role-memory-context-provider.test.ts` |
| model sees approved memory only and candidate/accepted are explained correctly | `raw-evidence.json#modelVisibility`; Agent panel copy; `MemoryProductSurface/v1` contract |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/memory-authority/acceptance/TF-0498/run-verification.ps1'
```

## Unverified boundary

This node proves the single user-facing Memory control plane and its candidate/approval/delete/export semantics. It does not change the underlying extraction algorithm, merge the Role/Runtime/Knowledge stores, flip a product default, or claim public release, GA, liveReady or productApproved.
