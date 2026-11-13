---
id: chat-stream-publication
title: Frame-bound chat publication with immediate controls
type: ai-coding-rule
severity: error
---

Keep the existing chat store as the state owner. Ordinary assistant and thinking
deltas may coalesce subscriber publication, but reads and event processing must
observe the latest state. Approval, errors, cancellation and terminal changes
publish immediately with all prior accepted deltas included.

Deduplicate sequence identities before changing text. Late deltas cannot reopen
terminal runs. Repeated unsequenced incremental chunks are valid text, while
repeated cumulative snapshots may be ignored. Session/run boundaries remain
explicit and pending frame work is cancelled when its last observer leaves.

After an acknowledged cancellation, discard all legacy frames for that aborted
owner before adopting a run, changing messages or refreshing history. Delayed
tool and text finals must leave the next turn's state and ownership intact.

Reuse completed message projections only while their actual inputs match. History,
workspace, labels, transcripts and execution evidence changes invalidate affected
entries. Compare native rendering on the same workload and preserve failed runs.
