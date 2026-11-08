---
id: resource-mixed-measurement
title: Frozen mixed-work resource comparisons
type: ai-coding-rule
severity: error
---

Keep before/after source revisions, build provenance, fixture bytes, worker counts,
window counts and work quantity explicit. Use the same measurement driver and
ABBA order for each comparison. Report all attempts and raw samples, including
errors and timeouts. A retry is a new attempt and cannot overwrite a first failure.

Measure real work through existing owners, verify each receipt and wait for child
exit. Label scripted workers, local remote-service surrogates and fixed pressure
inputs as agent-driven. Keep source-build identity separate from the driver overlay.

Recompute throughput, queue/service/end-to-end P50/P95, renderer input/scroll and
resource results from raw data. Treat unavailable counters as unknown. A faster
average cannot compensate for missing output, bad ownership or leaked processes.
State the accepted or rejected operating point together with its tail latency.
