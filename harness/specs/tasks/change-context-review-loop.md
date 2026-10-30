---
lifecycleStatus: active
id: change-context-review-loop
title: Evidence-backed Change Context and Review Loop
type: task
intent: Add a read-only Change Context projection, digest-anchored review comments, explicit comparison modes and a controlled review verdict/Pull Changes loop over existing ClawX owners without introducing a second version-control, task, execution or approval authority.
scenario: gateway-backend-communication
taskType: runtime-bridge
requiredRules:
  - contract-first-boundary
  - renderer-main-boundary
  - i18n-locale-coverage
  - coding-mutation-consistency-boundary
  - versegit-validation-layer-extension-boundary
  - task-review-outcome-boundary
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
touchedAreas:
  - harness/specs/guides/delta-informed-change-context-review-loop-options.md
  - harness/specs/tasks/change-context-review-loop.md
  - shared/types/change-context.ts
  - shared/types/code-review.ts
  - shared/types/workspace.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/changeContext.json
  - shared/i18n/locales/en/codeReview.json
  - shared/i18n/locales/zh/codeReview.json
  - shared/i18n/locales/ja/codeReview.json
  - shared/i18n/locales/ru/codeReview.json
  - shared/i18n/locales/zh/changeContext.json
  - shared/i18n/locales/ja/changeContext.json
  - shared/i18n/locales/ru/changeContext.json
  - src/lib/host-api.ts
  - electron/services/change-context-api.ts
  - electron/services/change-context-projection.ts
  - electron/services/change-context-anchor.ts
  - electron/services/change-context-anchor-workspace.ts
  - electron/services/change-context-review-store.ts
  - electron/services/change-context-review.ts
  - openclaw_runtime/src/plugin-sdk/journaled-git-apply.ts
  - shared/types/git.ts
  - vite.config.ts
  - src/pages/CodeReview/ChangeContextPanel.tsx
  - electron/main/ipc-handlers.ts
  - electron/services/code-review-api.ts
  - electron/services/git-api.ts
  - electron/services/sessions-api.ts
  - electron/services/versegit-observation.ts
  - electron/services/versegit-receipt-bridge.ts
  - src/components/file-preview/WorkspaceReviewPanel.tsx
  - src/components/file-preview/WorkspaceGitPanel.tsx
  - src/components/file-preview/FilePreviewBody.tsx
  - src/pages/CodeReview/index.tsx
  - tests/unit/change-context-projection.test.ts
  - tests/unit/change-context-review-anchors.test.ts
  - tests/unit/change-context-review-verdict.test.ts
  - tests/unit/change-context-contract.test.ts
  - tests/e2e/change-context-review-loop.spec.ts
  - docs/modules/workspace-and-coding.md
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - A user can open one change context and see the request, current comparison, changed files, review comments and available verification evidence together.
  - A user can compare merge base, last commit, last turn and checkpoint without changing any product default or execution authority.
  - A review comment remains visibly anchored or becomes stale/removed/unavailable; it never silently jumps to a changed range.
  - Request changes may create or link one Task Ledger node; approve does not complete the task or merge code.
  - Pull Changes is explicit, digest-bound and approval-governed; stale or conflicted patches fail closed through the existing apply path.
  - VG evidence remains read-only, opt-in and advisory, preserving unmeasured, partial and stale states.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/change-context-projection.test.ts tests/unit/change-context-review-anchors.test.ts tests/unit/change-context-review-verdict.test.ts --maxWorkers=1
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/change-context-review-loop.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/change-context-review-loop.md
  - pnpm harness run --spec harness/specs/tasks/change-context-review-loop.md --dry-run
  - git diff --check
acceptance:
  - The selected design is recorded in the VerseSearch decision guide and the implementation uses only existing Session, Workspace, Git, Code Review, Observability, Task Ledger and VG ownership.
  - The Change Context API returns explicit unavailable, partial, truncated and stale states and never converts a missing source into an empty successful diff.
  - Last-turn bounds are derived from transcript/runtime turn identity rather than mutable UI state; merge-base, last-commit and checkpoint comparisons are immutable for a loaded context.
  - Every review comment anchor stores path, range, file digest, range digest and base/candidate identity; digest changes render stale, removed or unavailable without silent movement.
  - Review verdict transitions are explicit; approve cannot complete a Task Ledger node, request changes may link a node, and comment-only remains local review evidence.
  - Pull Changes requires a digest-bound patch and existing approval/apply authority; stale or conflicted application is rejected with zero destination mutation.
  - VG stale-read and receipt evidence remains advisory, host_verdict remains unchanged, default-off behavior produces no VG call, and no land/admit or M4 path is exposed.
  - Unit, contract, typecheck, build, Electron E2E, negative controls, Harness validation and Task Forest validate/export all pass on one candidate with retained evidence.
docs:
  required: true
  files:
    - harness/specs/guides/delta-informed-change-context-review-loop-options.md
    - docs/modules/workspace-and-coding.md
    - docs/modules/sessions.md
---

# Evidence-backed Change Context and Review Loop

## Objective

Make one code change legible as a single reviewable object without creating a second authority.

The user-visible workflow is:

    request and turn context
      -> explicit comparison mode
      -> changed files and diff
      -> anchored review comments
      -> verification and VG evidence
      -> review verdict
      -> explicit Task Ledger or Pull Changes next action

The underlying state remains owned by existing Session, Workspace, Git, Code Review, Task Ledger, approval, write journal and VG providers.

## Non-goals

- Do not introduce DeltaDB, a CRDT, a remote sync service or real-time multi-user collaboration.
- Do not replace Git, Git worktree, the write journal or VerseShell.
- Do not create a new task graph, approval plane, executor, mutation journal or landing authority.
- Do not enable VG by default or expose vg land/admit.
- Do not change product locks, release status, liveReady, productApproved, defaultOn or M4 authority.
- Do not require a human verifier; review and acceptance steps may be agent-driven and must be labelled driven_by=agent.

## Required rules

- harness/specs/rules/contract-first-boundary.md
- harness/specs/rules/renderer-main-boundary.md
- harness/specs/rules/i18n-locale-coverage.md
- harness/specs/rules/coding-mutation-consistency-boundary.md
- harness/specs/rules/versegit-validation-layer-extension-boundary.md
- harness/specs/rules/task-review-outcome-boundary.md
- harness/specs/rules/repository-artifact-retention.md
- harness/specs/rules/disk-temp-policy.md
- harness/specs/rules/docs-sync.md

## Work breakdown

### A. Research and decision freeze

Deliver a source-backed decision guide with candidate options, rejected alternatives, selected option, authority matrix, test plan and explicit non-goals.

Acceptance:

- The VerseSearch route is recorded.
- Primary official sources are listed.
- No unresolved P0 design choice remains.
- No repository content is sent to external search providers.

### B. Contract and ownership

Define:

- ChangeContext identity and projection types.
- Comparison mode union.
- Review comment anchor and anchor-state types.
- Verdict and Pull Changes request/result types.
- Host API methods and error envelopes.
- Review comment store ownership, retention and deletion.
- Task Ledger linkage semantics.

Acceptance:

- Shared contract and service implementation names match.
- The review comment store is bounded and contains no session, task, execution or approval authority.
- Contract and renderer facade checks pass.

### C. Comparison and projection

Implement a Main-owned read-only projection over existing sources.

Acceptance:

- Merge base, last commit, last turn and checkpoint selections are deterministic.
- Turn identity and transcript bounds come from Session/runtime facts, not renderer-only state.
- Missing, truncated, partial and unavailable sources stay explicit.
- No new persistent owner is introduced for derived projection data.

### D. Anchored review comments

Implement create, list, resolve, re-anchor and delete operations.

Acceptance:

- Digest match produces live.
- Digest mismatch produces stale or removed.
- Missing digest or unavailable revision produces unavailable.
- No silent movement or silent deletion.
- Four-locale UI coverage.

### E. Review verdict and Pull Changes

Implement approve, request changes, comment-only and controlled Pull Changes.

Acceptance:

- Request changes may create or link one Task Ledger node through the existing API.
- Approve does not complete a node.
- Pull Changes requires an available digest-bound patch and existing approval.
- Stale or conflicted apply produces zero destination mutation.
- Pull Changes never bypasses the write journal or approval owner.

The loaded Main read model is bounded to 100 entries with a 15-minute TTL.
Verdicts require its exact digest and revalidate source facts; review decisions
are returned as local view evidence. Task Ledger links are durable references
through its existing event API, with one deterministic review-node identity.
The review store remains the sole comment owner, including deletion tombstones.

Pull Changes reuses Git preflight, digest/head/context-bound permission approval,
and Coding's existing journal and per-file leases through a public SDK seam.
Structured patch transport restores its final LF before computing the effective
patch digest. Unknown apply/rollback results remain `recovery_required` with
`destinationMutated=unknown`; they must never masquerade as a zero-write rejection
or be retried automatically. This additive error variant records a discovered
contract gap without changing any product lock or default.

### F. VG evidence projection

Expose existing VG facts as read-only evidence.

Acceptance:

- No VG call when the existing opt-in gate is off.
- stale-read finding is advisory.
- missing host-authoritative receipt remains partial or unmeasured.
- host verdict is unchanged.
- no land/admit or M4 UI.

### G. Electron E2E and acceptance

Deliver an Electron E2E spec and curated evidence.

Acceptance:

- All comparison modes are exercised on a deterministic fixture.
- A comment changes from live to stale after a digest change.
- Request changes creates or links a Task Ledger node.
- Approve leaves the node incomplete.
- Stale or conflicted Pull Changes fails closed.
- Screenshots/final-state evidence and SHA256 manifest are retained.

### H. Rollout gate

Enable the feature only behind an explicit advanced/opt-in entry until acceptance evidence is complete.

Acceptance:

- Default behavior is unchanged.
- Kill switch or feature gate is documented.
- Rollback path is documented and exercised.
- Residual gaps are explicit.

## Evidence rules

- Raw evidence goes to D:/tmp or an ignored repository run directory.
- Curated evidence is listed exactly in scripts/repository-artifacts.json before it is tracked.
- Every evidence bundle records candidate commit/tree, commands, exit codes, counts, actor, limitations and SHA256.
- Command stdout alone is not acceptance evidence; files are re-read from disk.
- Historical reports remain historical and are not promoted to current-candidate gates.

## Closure sequence

1. Execute one ready leaf at a time.
2. Run the focused tests for that leaf and retain raw evidence.
3. Curate only reviewed artifacts and update the manifest.
4. Read the artifacts back from disk and bind them to the same candidate.
5. Apply Task Forest status changes only after all acceptance criteria are satisfied.
6. Run Task Forest validate and export.
7. Keep product locks and release decisions unchanged.
