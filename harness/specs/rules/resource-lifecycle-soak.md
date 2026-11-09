---
id: resource-lifecycle-soak
title: Repeated resource lifecycle and idle evidence
type: ai-coding-rule
severity: error
---

Use one frozen source/build candidate for lifecycle and integrated gates. Execute
at least50 actual owner lifecycles. Record every creation, cancellation, terminal
receipt and PID identity check. Preserve failed attempts and unknown observations.

Measure idle and longer observation using wall-clock intervals, without shortening
production TTLs or replacing them with injected time. Keep the five-minute idle
segments and30-minute observation distinct. Periodic probes must demonstrate the
same owners remain usable after idle collection.

Compare logical ownership, native handles, private/committed memory and renderer
heap across warmup, repeated cycles, idle recovery and observation. A successful
close call alone cannot establish resource recovery. Independently recompute the
final report and bind every retained artifact with hashes.
