# CODING C5 COMPLETE (C5-H)

**Date**: 2026-07-15
**Completion class**: **`done (hard)`** — C5-H multi-process WAL hardened (opt-in mode)
**Defaults**: symbolLease.enabled **false**, mode **memory**, patchFlow.default **false**

## Hardening landed

- Exclusive WAL lock with PID+timestamp stale recovery
- Durable append + best-effort fsync
- Compact under lock
- Multi-holder contention + rehydrate recovery tests

## Red lines

- Do **not** set symbolLease.enabled=true by default
- Do **not** set symbolLease.mode=wal by default
- Do **not** set patchFlow.default=true without product approval

## Evidence

- `artifacts/coding-c5/acceptance.json`
- `openclaw_runtime/src/context-engine/factstore/symbol-lease.test.ts`