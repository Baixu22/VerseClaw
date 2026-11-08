---
id: adaptive-resource-pressure
title: Phase-aware admission and fresh pressure
type: ai-coding-rule
severity: error
---

Queue length indicates demand and must never be added to a concurrency limit.
Contract on sustained latency degradation before considering backlog. Grow in
bounded steps after repeated healthy observations. Keep a separate latency
baseline for each finite execution category; remote waiting must not tune local
execution capacity. Preserve account ownership, QoS, deadlines and total capacity.

Feed pressure from the existing efficiency observer. Validate signal timestamps,
finite counters and identity-calibrated event-loop samples. Physical availability
and Windows system commit are separate signals; process private bytes are not
system commit headroom. Missing, stale or repeated samples cannot establish
recovery. Record pressure causes, thresholds and unavailable signals in diagnostics.

Contract admission without interrupting an active lease. Recover after fresh
low-pressure observations spanning the dwell period, then normal healthy-demand
sampling. Reclaim only empty accounts idle beyond the retention interval. Never
evict an active or queued owner. Stop observation clears its pressure gate.

Retain negative controls, fixed-input pressure traces and paired actual-work
measurements on the same candidate. Report throughput and tail latency together;
keep rejected configurations and first failures in the evidence record.
