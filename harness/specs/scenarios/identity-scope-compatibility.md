---
id: identity-scope-compatibility
title: Shared Identity Scope Compatibility
type: shared-contract
ownedPaths:
  - shared/types/identity-scope.ts
  - shared/product-semantics.ts
requiredProfiles:
  - fast
requiredRules:
  - identity-scope-boundary
  - docs-sync
---

A boundary owner supplies an already resolved workspace identity. The shared
compatibility module can project its transitional ProjectId and normalize a run
reference with explicit workspace scope. Session metadata alone cannot establish
that scope. Multiple execution attempts may share a conversation; neither ancestry
nor completion is derived from that conversation's key.

Task references name their owner: Task Ledger node, runtime task, browser task,
cron run or install task. A bare legacy `taskId` must be resolved by the old
endpoint's documented owner before entering the new boundary.

Normalization is an in-memory adapter. Existing host-api payloads, filesystem
formats and runtime stores keep their current keys. Task Ledger remains the only
source of user-visible task facts. The adapter grants no filesystem permission
and performs no registry lookup, persistence or scheduling.
