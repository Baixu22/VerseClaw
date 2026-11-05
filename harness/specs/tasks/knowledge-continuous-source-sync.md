---
lifecycleStatus: active
id: knowledge-continuous-source-sync
title: Reconcile watched knowledge sources without lost file events
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reconcile bounded local source snapshots on events, startup and periodic scans; preserve pending review, deduplicate versions and capture deletion as a withdrawal candidate.
diffBase: 3c72a9a262d704da7edcb6889bc1bf77bcc3f987
touchedAreas:
  - electron/services/knowledge-api.ts
  - electron/services/knowledge-source-sync.ts
  - electron/main/index.ts
  - shared/host-api/contract.ts
  - tests/unit/knowledge-source-sync.test.ts
  - tests/unit/knowledge-api.test.ts
  - README*.md
  - docs/modules/knowledge-base.md
  - harness/specs/tasks/knowledge-continuous-source-sync.md
  - harness/specs/rules/knowledge-continuous-source-sync.md
  - harness/specs/fixtures/knowledge-continuous-source-sync/**
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-source-sync.test.ts
  - tests/unit/knowledge-api.test.ts
expectedUserBehavior:
  - Watched source additions, edits and withdrawals create pending review candidates, including changes missed during shutdown.
  - Synchronization errors are visible and accepted Wiki content remains governed by review and apply.
acceptance:
  - Twenty simultaneous native file creations, changes, deletion and restart gaps reconcile exactly once per source version.
  - Source changes and withdrawals create agent-driven pending review candidates, never direct Wiki writes.
  - Failed capture does not advance the durable source cursor; startup and periodic full scans repair missing events.
  - Symlinks, traversal, binary and oversized files cannot escape the watched root or bypass limits.
  - Stop/restart disposes timers and watchers; incomplete scans never infer deletion.
docs:
  required: true
---

TF-0797 follows the completed Source Set admission delivery. Reuse the existing
Inbox and GovernanceStore; source snapshots are synchronization cursors, never a
second knowledge authority. Capture keys bind configuration, path, revision and
transition. Removed files produce withdrawal candidates without deleting accepted
knowledge. Persisted configuration is review-gated. No product defaults or locks
are promoted. Evidence actors are agents.
