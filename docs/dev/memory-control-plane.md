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

- Role cards use review/governance transitions owned by `role-memory-card-governance`.
- Runtime facts/timelines/episodes use the Runtime Memory owner's acceptance and invalidation paths.
- Embeddings and Dreaming consume accepted inputs and may be rebuilt; they cannot accept memory or inject prompt context.
- SEKB remains a Knowledge Runtime Lessons source and does not own a memory store.
- The model-safe product description is exposed by the manifest for later context/profile consumers; it must not describe Role/Runtime/Dreaming/Embedding as separate user memories.
