---
id: memory-self-edit-provenance-boundary
title: Agent memory edits retain agent provenance
type: ai-coding-rule
severity: error
---

Model-callable memory edits must use `agent_self_edit` source/episode provenance,
`agent_approved` status and `promotedBy: agent`. Here `agent_approved` means an
agent accepted its own edit, not independent verification or human approval.
Generated evidence is a tool reference with `driven_by: agent` and an actor.

Keep historical source references unchanged and append the current agent action;
approval of old content must never become approval of its replacement. Reject
human rejection reasons supplied to the forgetting tool before any write.
Strengthening changes usage only, never verification or source identity.

The memory schema must reject agent self-edit facts/invalidation records that
claim human approval. Existing historical human records remain readable. This
additive schema change does not migrate or relabel stored records and does not
restore `runtime.memory.persist` or register the retired tools.
