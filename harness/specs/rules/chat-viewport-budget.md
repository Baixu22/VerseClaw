---
id: chat-viewport-budget
title: Measured chat viewport and recoverable cache eviction
type: ai-coding-rule
severity: error
---

Measure mounted message heights and preserve the first visible message and its
offset when earlier content changes. Scroll-to-message must mount cold viewport
rows before alignment. Keep current sticky-bottom and user scroll escape behavior.

Count retained payload bytes across chat caches using one budget. Update accounting
on replacement, eviction, expiry and deletion; never admit an oversized entry.
Eviction releases cached bodies, preserves execution identity and durable references,
and reads the original content through existing history/media owners when needed.
Cache measurement is distinct from actual renderer heap and RSS evidence.
