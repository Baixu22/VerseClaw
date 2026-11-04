# Memory Control Plane

Status: active internal engineering boundary (TF-0497)
Schema: `MemoryControlPlaneManifest/v1`
Source: `shared/memory/control-plane.ts`

## Product concept

**Memory** is one reviewable product concept: accepted facts or cards with explicit provenance, scope and lifecycle state. Role Memory, Runtime Memory, embeddings, native retrieval and Dreaming are data domains or derived infrastructure, not separate product memories. Only accepted memory may enter retrieval or prompt context.

Candidates may persist, but `memory-candidate` has `retrieval=none` and `injectable=false`. A candidate can become accepted only through its owning governance/runtime acceptance path.

## Authority matrix

| Data domain | Owner | Scope | Boundary | Retrieval / injection | Retention / delete | Invalidation | Migration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| role-memory-card | role-memory-card-governance | workspace | review-required | accepted-only / accepted-only | owner lifecycle; delete/tombstone removes retrievability | review, evidence, scope or version invalidation | role-memory SQLite stays in place |
| runtime-fact | runtime-memory-store | session, run | owner-accepted | accepted-only / accepted-only | Runtime Memory TTL and eviction; dependent embeddings invalidated | contradiction, stale evidence or scope mismatch | existing Runtime Memory store remains |
| runtime-timeline | runtime-memory-store | session, run | owner-accepted | accepted-only / accepted-only | follows session/run lifecycle | replaced generation or invalid episode | additive schema only |
| runtime-episode | runtime-memory-store | session, run | owner-accepted | accepted-only / accepted-only | Runtime Memory owns deletion and index cleanup | lost execution context or contradiction | existing episode store remains |
| memory-candidate | memory-candidate-queue | workspace, session | review-required | none / never | queue retention; reject/delete or audit tombstone | rejected, superseded or stale candidate never promoted | persisted with accepted-target identity |
| embedding-index | memory-embedding-provider | workspace | derived-only | internal-derived / never | source/provider lifetime; source delete rebuilds | source digest, model or delete invalidation | rebuildable derived data, never sole copy |
| native-file-query | native-file-memory-retrieval | workspace | transient | transient / never | request-bounded | changed source file | native files stay read-only sources |
| dreaming-derived-cache | dreaming-derived-cache | workspace | derived-only | internal-derived / never | phase/cache policy; reset/repair only removes derived artifacts | input change, duplicate repair or reset | rebuildable cache; not migrated as accepted memory |

## Approval and consumption

Memory self-edit operations use `source/kind: agent_self_edit`,
`verificationStatus: agent_approved` and `promotedBy: agent`. This status means
agent acceptance of its own edit, not independent verification or human approval.
Each update/forget appends agent action lineage and tool evidence carrying
`driven_by: agent` / `actor: memory_self_edit`; historical evidence remains intact.
The forgetting tool accepts only `retracted`. Strengthening records usage without
changing fact provenance or verification. Schema guards reject contradictory
self-edit approval records before storage. These values are additive; historical
records are not rewritten and no SQLite migration is run. The TF-0500 persistence
retirement and empty adapter tool list remain unchanged.

- Role cards use review/governance transitions owned by `role-memory-card-governance`.
- Runtime facts/timelines/episodes use the Runtime Memory owner's acceptance and invalidation paths.
- Embeddings and Dreaming consume accepted inputs and may be rebuilt; they cannot accept memory or inject prompt context.
- SEKB remains a Knowledge Runtime Lessons source and does not own a memory store.
- The model-safe product description is exposed by the manifest and the Memory surface; it must not describe Role/Runtime/Dreaming/Embedding as separate user memories.

## User surface and close semantics

TF-0498 adds the single product destination `/memory`. It is a projection and command surface, not another store or accepting authority.

- **Accepted** lists active/cold Role cards and accepted Runtime facts with scope, source, timestamps, sensitivity, evidence count and current model visibility.
- **Candidates** lists persisted Role proposals and Runtime fact candidates. Every candidate has `retrievable=false`, `injectable=false` and `modelVisible=false`.
- **Approve** delegates to Role Memory review or `memory.proposeFacts.confirm`; it does not write a card/fact directly.
- **Delete** dispatches by owner: role cards are tombstoned; Runtime facts are invalidated with reason `retracted`.
- **Export** reads the same surface projection and writes an owner-neutral JSON snapshot under Electron `userData/exports/memory`. Secret/secret-adjacent content is redacted and the returned SHA-256 covers the exact bytes written.
- **Remember this** calls the existing `memory.propose` gatekeeper/policy/evidence/conflict path with source `user`. It may be accepted or become a persisted review candidate; the UI does not bypass review.

Role Memory off closes Role read/write gates and stops Role prompt retrieval, but does not delete the on-disk cards. Runtime capture, persistence, provider and injection-pilot flags are reported separately. Native OpenClaw memory sources have separate read-only owners; the Memory UI states that disabling this surface's Role/Runtime gates does not claim to disable those sources.

The model-facing projection contains accepted keys whose owner gate and injection-pilot configuration make them currently model-visible. Candidate keys are returned only as an explicit exclusion set for diagnostics/tests and never enter accepted/model-visible data.
