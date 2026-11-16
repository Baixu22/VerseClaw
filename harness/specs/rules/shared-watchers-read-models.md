---
id: shared-watchers-read-models
title: Shared watchers retain subscription semantics and invalidation
type: ai-coding-rule
severity: error
---

Count subscriptions by distinct handles, not callback identity. Close is idempotent
and cannot affect a later generation. An ancestor recursive watcher may cover a
child only when its routing preserves depth, relative paths, filters and persistence.
Release native callbacks and recovery monitors on the last subscription.

Read-only invalidation fences pending loads before a replacement begins. A late
completion may finish its original caller but cannot repopulate the current cache.
Repository root identity changes require a fresh status; never cache permission
decisions or mutations. Knowledge captures retain their existing durable cursor.

Secondary read observers are registered only by Main, using the same application
entry, preload and session as the primary window. Their action allowlist contains
only git.status and efficiency.getState. Navigation and window destruction revoke
effective access; a renderer cannot register itself or invoke mutations through this path.
