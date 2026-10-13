---
id: trace-cost-sampling-boundary
title: Request cost and sampling remain observable bounded evidence
type: ai-coding-rule
severity: error
---

- Use the existing trusted diagnostic producer and diagnostics-otel export owner; no second exporter, usage service or persistent store.
- Opt in with the existing diagnostic flag surface; leave absent/disabled behavior, billing and frozen defaults unchanged.
- Join host request and attempt identities; hash identifying strings with a domain. Link tools via existing tool-call identity and effects via native trace parentage, never fabricate a receipt.
- Consume terminal structured usage once; missing/invalid/aborted data and unknown prices are not healthy zero. Version the rate snapshot and identify currency and units.
- Count the population before sampling; distinguish duplicates, missing links, unknown cost, sampled-out records, expiry and capacity/export loss.
- Error/blocked/recovery records bypass probabilistic drops, not finite resource limits. Keep all queues/maps bounded and report unavoidable retention loss.
- Sanitize by a fixed projection; no raw prompt, tool bodies, credentials or identifying strings in new exports.
- Observer failure never changes stream/tool outcome, retry/approval or product locks.
