---
id: knowledge-continuous-source-sync
title: Source synchronization keeps review and durable progress distinct
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - electron/services/knowledge-source-sync.ts
requiredTests:
  - tests/unit/knowledge-source-sync.test.ts
---

Filesystem events request reconciliation; their type is not a source of truth.
Serial reconciliation compares bounded current snapshots with persisted cursors.
Only successful, idempotent review-candidate capture advances a cursor. Failed or
incomplete scans cannot imply deletion. Symlinks are outside the supported source
surface. Changes, permission loss and deletion do not directly mutate approved
knowledge. Shutdown releases watchers, timers and pending work.
