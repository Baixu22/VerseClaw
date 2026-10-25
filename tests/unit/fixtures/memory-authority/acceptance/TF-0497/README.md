# TF-0497 acceptance evidence

- Task: `TF-0497` — one product Memory control plane with per-data authority
- Actor: `codex-long-session-r2`
- Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded
- Release boundary: public release, GA, liveReady and productApproved remain unclaimed

## Delivered contract

- `MemoryAuthorityManifest/v1` derives every memory authority from `ComponentAuthorityManifest/v1` and adds scope, retention, delete, invalidation, retrieval and migration semantics.
- Role Memory is the user-visible accepted-card governance control plane.
- Runtime Memory owns accepted fact/timeline/episode data; embeddings are rebuildable retrieval infrastructure and cannot accept memory.
- Candidate creation may persist in Role/Runtime stores, but a candidate is neither retrieved nor injected as accepted memory until the owning review/approval path accepts it.
- Dreaming output is imported as proposals/candidates only; SEKB owns no memory store and cannot auto-write accepted memory.
- Multiple databases remain legal. The migration map is map-only, preserves every source, and requires approval before accepted memory is created.
- `MemoryProductProfile/v1` describes one memory concept with a fail-closed approval boundary and no internal sub-system names.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| authority manifest assigns one accepting/update authority per memory data type+scope | `raw-evidence.json#authority`; `memory-authority-contract.test.ts` |
| Role/Runtime/Dreaming/Embedding scope, retention, delete, invalidation and retrieval semantics align | `raw-evidence.json#domains`; `memory-authority-contract.test.ts` |
| migration/compatibility preserves data and does not force one database | `raw-evidence.json#migration`; `memory-authority-contract.test.ts` |
| model profile has exactly one memory concept and approval boundary | `raw-evidence.json#profile`; `MemoryProductProfile/v1` |

## Evidence lifecycle

`generate-acceptance.mts` writes the authority contract evidence with `diskReadback.status=pending-external-verification`. `run-verification.ps1` records every gate, verifies every entry in `SHA256SUMS`, and writes the independent proof to `12-sha256sums-check.txt` and `verification.json`. The generated contract and its graduation report remain byte-stable; the external readback is not inferred inside the evidence generator.

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/memory-authority/acceptance/TF-0497/run-verification.ps1'
```

## Unverified boundary

This contract proves authority separation, candidate isolation, migration preservation and model positioning. It does not deliver the later user-visible review/delete/export surfaces, does not merge DataStores, and does not enable automatic memory writeback.
