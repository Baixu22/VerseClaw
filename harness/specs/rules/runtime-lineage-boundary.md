---
id: runtime-lineage-boundary
title: Runtime lineage correlation boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# Runtime lineage correlation boundary

- Reuse the existing `missionId`, `tick`, `loopRunId`, `traceId`,
  `taskLedgerRootId`, and SEKB trajectory/principle identifiers.
- A new runtime artifact may carry a normalized lineage object, but lineage is
  correlation metadata only. TaskFlow/TaskRegistry, Task Ledger, BlockStore,
  and KnowledgeStore keep their existing ownership.
- New writes must include a real session/run identity when one is available;
  never infer a mission or tick from `sessionKey` alone.
- Legacy records with missing fields remain readable. Consumers omit missing
  fields or mark the correlation incomplete; they do not synthesize IDs.
- DCS task-state writes remain system-managed BlockStore writes, and SEKB
  principle writes remain explicit confirm-only writes.
- Lineage metadata is bounded and passed through existing typed boundaries. It
  must not contain prompts, raw tool payloads, credentials, or transcript text.
- Product locks and default-off behavior are unchanged.
