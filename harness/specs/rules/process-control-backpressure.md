---
id: process-control-backpressure
title: Bounded process controls, shared lifetime and output
type: ai-coding-rule
severity: error
---

Control requests share the existing executor but precede queued polls. Polls leave
control capacity available without increasing the configured active or queue cap.
Absolute deadlines and cancellation remain effective; every settled request removes
its timer and abort listener. Stdin transport backpressure stops further dispatch.

Each managed lifecycle holds an executor reference. Terminal completion releases
only that reference; idle collection cannot stop active references and unknown
process capacity is not counted as an observed exit. Shutdown owners retain their
existing force-stop authority.

Bound output by UTF-8 bytes across streams and oversized chunks. Preserve original
artifacts/cursors and report omitted bytes; spill writes cannot build an unbounded
in-memory stream queue. Compare actual native work before adding a persistent helper.
