---
id: resource-budget-integration
title: Integrate existing owner budgets with bounded waiting
type: ai-coding-rule
severity: error
---

Reserve all bounded dimensions atomically at the existing owner before granting
execution. Host usage includes all workspaces and tenants. Selection preserves QoS,
FIFO aging and progress for each waiting tenant; accounting alone is not scheduling.

The owner retains reservations for running or unknown execution until its observed
terminal state. Expiration fences an old writer before reuse. Unknown costs remain
separate liabilities, not zero or unlimited capacity. Projection/cache deletion
does not release capacity; rebuild effective caps and usage from owner state.

Integrating older owner code must preserve queue bounds, cancellation and absolute
deadlines, confirmed effect receipts and per-process identity/freshness measurements.
Keep historical candidate reports intact and validate the integrated source anew.
