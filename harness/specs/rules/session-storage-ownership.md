---
id: session-storage-ownership
title: Session storage and checkout ownership
type: rule
pathPatterns:
  - electron/services/session-storage-api.ts
  - src/pages/Settings/sections/StorageSection.tsx
  - src/components/chat/SessionWorkspacePicker.tsx
requiredTests:
  - tests/unit/session-storage-api.test.ts
  - tests/e2e/session-worktree-storage.spec.ts
---

Storage is a read model over existing resource owners. Release must select both workspaceId and sessionKey and stop only owned resources. Observed ports never grant cleanup authority.

Git worktree removal must re-read registered workspaces, Git locks and local changes before execution. Preserve primary, active, associated or unreadable checkouts, use the existing permission approval, never force removal, and retain branches. Linked directories and shared Git metadata are excluded from disk-size traversal. Partial scans and unavailable memory measurements must remain explicit.

New worktree workspaces receive fresh conversation keys. Switching back restores the existing workspace's conversation and draft. Both /storage and Settings use the same page and typed host API.
