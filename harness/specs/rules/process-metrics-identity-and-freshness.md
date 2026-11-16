---
id: process-metrics-identity-and-freshness
title: Process metrics retain identity, units and freshness
type: ai-coding-rule
severity: error
---

Count physical processes by PID plus creation token, across all overlapping owners.
Prefer the newest observation of a PID and never join CPU deltas across reused PIDs.
An initial, expired or missing baseline is unknown, not an observed zero rate.
Samples expire after 30 seconds. CPU baseline intervals allow at most 60 seconds
to cover Main's existing 30-second polling cadence and bounded process probing.

Keep producer epoch and sampling time with each process-tree measurement. An expired,
future, malformed or older-generation snapshot cannot influence current occupancy.
Reserializing or merging a snapshot must not refresh its measurement timestamp.

Logical active/waiting leases remain additive. Physical RSS/working set, private
committed bytes and machine available physical memory have separate units and fields.
Do not add process aggregates that lack identities to already measured process trees.

The existing background gate consumes the aggregate process-tree sample. Main's own
CPU percentage cannot substitute for the runtime and tool processes. Unavailable
measurements must preserve an existing pressure hold until fresh recovery evidence.
