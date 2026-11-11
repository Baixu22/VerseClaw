---
id: execution-domain-registry-design
title: Durable checkout registration and local task authority
type: guide
appliesTo:
  - execution-domain-registry
---

**WorktreeService persists managed checkout ownership in the shared Runtime SQLite database.** A fresh process reads the same generation, owner and pending merge records. Physical existence and readiness are inspected separately from registration.

The shared state owner creates `managed_worktree_scopes` and `execution_domain_registrations` through its existing schema lifecycle. Kysely query helpers perform metadata reads and writes. A short revision-checked transaction publishes each scope update; Git and dependency setup run outside the shared database transaction, under the existing per-root mutex.

Creation records progress through `intent → allocated → created → registered → ready`. The caller can supply an operation ID. Identical retries after ready return the original record; conflicting input is rejected. A persisted `registered` step can finalize readiness after identity revalidation. Earlier interruptions remain visible as incomplete or missing and do not automatically repeat setup or spawn. Unknown directories remain unowned and are retained.

Checkout identity records the filesystem directory instance, creation generation, Git private directory identity and its back-pointer. Mutable content and directory mtime are not incarnation signals. Replacing a directory at the same path invalidates prior execution and cleanup checks. Path aliases resolve to the same scope. A replaced base root rejects the old scope instead of adopting its records.

The existing `listOwned` consumers now recover ownership after restart. `inventory()` additionally reports ready, incomplete, missing, replaced, unknown, cleaned and unowned resources. Runtime resource inventory reports unknown when owned registration is not ready. Candidate freezing requires the existing native isolation inspection to succeed.

Merge intent is durable. The existing registry retains the parent and worker file hashes captured at creation. Merge rechecks the checkout generation, parent revision and both file sets, then applies changes through Coding's existing journal. The asynchronous merge holds the same incarnation-aware root mutex until the journal returns. Before applying files, the queue records an unknown outcome. If the process exits before the final receipt, recovery preserves that state and refuses automatic replay or cleanup. Each checkout retains its latest successful merge receipt so duplicate completion callbacks can read the same result after verifying the recorded file hashes. Cleanup persists its intent before removal; a retry can finish a known removal, while a replacement path remains protected.

**Explicit local authority registration is metadata, not a new task store.** Same-common-dir Git worktrees keep their existing TaskSystemStore identity. Independent roots return independent until a trusted owner calls `registerTaskAuthority` with an existing authority root, actor, operation ID, expected registration revision and project revision. Registration checks the existing task schema read-only, saves root/database instances, rejects chains and records the selected authority. `taskAuthority` revalidates these facts and returns unavailable on missing or replaced storage; it never silently creates a fallback task database.

The current coordinator binding remains Main-owned and continues using its existing write path. This slice exposes explicit authority resolution on WorktreeService; existing task execution does not automatically switch databases. Joint admission and environment migration must consume the resolved authority, task credentials and checkout incarnation together before activating cross-clone execution. This preserves the concurrent session-scope implementation's single writer and keeps enrollment from granting execution.

There is no owner information to migrate from the former process-local Map after a restart. Previously created directories without a durable record remain unowned. No automatic directory-name adoption or destructive migration is performed. A deliberate adoption/recovery workflow belongs to the existing resource owner and must verify the native checkout and retained artifacts.

The per-root snapshot is stored inside SQLite and includes registered worktrees and their file-hash baselines. Its serialization cost grows with both checkout count and captured file count. Indexed child rows remain a possible storage optimization if measurements justify it; the revision contract and owner API stay the same.

Validation uses real temporary Git repositories, separate Node processes, actual SQLite reopen, creation-phase interruptions, path replacement, alias normalization, idempotency conflicts, clone authority failures and existing worktree/resource regressions. Native tests use temporary state roots and agent-driven fixtures.
