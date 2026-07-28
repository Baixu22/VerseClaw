---
id: remote-forge-controlled-preview
title: Remote Forge controlled preview
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add one Main-owned GitHub Remote Forge path for bounded PR reads, structured diff evidence, action-bound review mutations, and fail-closed sandbox merge while preserving the existing local Git service and Coding write journal authorities.
touchedAreas:
  - artifacts/first-product-preview/FP-P2-07/**
  - docs/dev/first-product-controlled-preview/**
  - shared/host-api/contract.ts
  - shared/types/code-review.ts
  - shared/types/git.ts
  - shared/types/remote-forge.ts
  - electron/services/git-api.ts
  - electron/services/code-review-api.ts
  - electron/services/remote-forge-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - src/pages/CodeReview/**
  - src/components/tool-ui/code-diff/**
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/remote-forge-controlled-preview.spec.ts
  - harness/specs/tasks/remote-forge-controlled-preview.md
expectedUserBehavior:
  - DCS edit and full-file write results show one structured code diff with a copyable text fallback, completeness state, and the same request and journal lineage as the underlying mutation.
  - Users can inspect GitHub pull request details, commits, bounded file content, diffs, checks, reviews, and readiness through a typed host-api-backed surface without renderer-owned GitHub transport.
  - Pagination, truncation, missing head SHA, stale head, stale readiness, stale approval, and unknown branch-protection state remain visible and fail closed.
  - Review comments and metadata mutations require an action-bound one-time approval tied to provider, repository, pull request, head SHA, action, and payload digest.
  - Merge remains disabled by default and can only run for the charter-named sandbox repository after Main re-reads head and readiness immediately before the approved action.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - contract-first-boundary
  - coding-runtime-workspace-dcs-producer-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/remote-forge-controlled-preview.md
  - pnpm harness validate --spec harness/specs/tasks/remote-forge-controlled-preview.md
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run lint:check
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e:run -- tests/e2e/remote-forge-controlled-preview.spec.ts
  - git diff --check
acceptance:
  - The source manifest records HTTPS upstream, observed refs, local snapshot inventory hash, version drift, Apache-2.0 obligations, and NOTICE state. An unresolved exact commit blocks implementation copying but does not block clean-room Verse Claw contract design.
  - GitPatchArtifact/v1 is the only shared patch observation contract. It represents file status, old/new paths, content kind, hunks, old/new line mapping, message, and completeness for CRLF, add, delete, rename, binary, metadata-only, bare hunk, malformed, and truncated inputs.
  - RemoteForgeError/v1 is the stable remote error envelope and carries code, retryable, requestId, optional HTTP status, and safe message without credential, response-body, repository-content, or private-host leakage.
  - Local repository status, diff, stage, commit, branch, stash, worktree, fetch, pull, and push remain owned by electron/services/git-api.ts. No second local Git service is introduced.
  - File mutation, snapshots, recovery, and undo remain owned by the Coding write journal. Structured diff projection never becomes a mutation authority.
  - Renderer calls Remote Forge only through src/lib/host-api.ts or src/lib/api-client.ts. Renderer code does not call GitHub directly, execute git or gh, or choose WS, HTTP, or IPC fallback.
  - The GitHub read adapter runs in Main and provides bounded, deduplicated, paginated PR detail, commits, files/diff, checks, reviews, file content, and readiness with explicit complete, incomplete, truncated, and unavailable states.
  - Unknown, incomplete, truncated, pagination failure, missing head SHA, or stale head/readiness/approval cannot be interpreted as empty, complete, ready, or approved.
  - Every remote side effect binds provider, repository, pull request, head SHA, action, and payload digest. Approval is consumed once and invalidated by head, readiness, action, or payload drift.
  - Review, comment, and metadata partial success separates the primary effect from follow-up failures and returns a safe reconciliation state; retries cannot silently duplicate the primary effect.
  - Main enforces read, evaluate, approve, immediate re-read, and expected-head merge ordering. Branch protection and check state are not replaced by a local approvals-ready approximation.
  - Agent merge is off by default. Automated tests use isolated local fixtures or a fake HTTP provider and never write to a real remote repository.
  - Real review, metadata, and merge effects are deferred to FP-P2-02 under the FP-P2-01 charter and only against its named sandbox or disposable repository.
  - User-visible copy uses en, zh, ja, and ru i18n keys and the Electron E2E covers rich diff, text fallback, incomplete/readiness states, approval invalidation, and merge veto behavior.
  - README.md, README.zh-CN.md, and README.ja-JP.md are reviewed after each functional slice; behavior or interface changes update all required docs in the same change set.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/first-product-controlled-preview/tasks/FP-P2-07.md
    - docs/dev/first-product-controlled-preview/tasks/FP-P2-08.md
    - docs/dev/first-product-controlled-preview/tasks/FP-P2-09.md
    - docs/dev/first-product-controlled-preview/tasks/FP-P2-10.md
---

# Remote Forge Controlled Preview Gate

## Start gate

Run Harness context before implementation. Confirm the source manifest, existing local Git owner, Coding write journal owner, typed host API boundary, current patch consumers, and relevant tests. If any source copy is proposed while the exact upstream commit remains unresolved, stop that copy and continue only with clean-room contract work.

## Scope sequence

1. `FP-P2-07`: freeze source/license evidence; define the shared patch/error contracts; migrate Git, Code Review, and DCS edit/write diff consumers.
2. `FP-P2-08`: add the Main-owned GitHub read adapter and bounded completeness-aware host/UI surface.
3. `FP-P2-09`: add review/comment/metadata mutations with OCC, one-time action-bound approval, safe partial success, and redaction.
4. `FP-P2-10`: add Main-enforced readiness veto, approval invalidation, expected-head sandbox merge, and default-off Agent merge policy.

Each task closes its own evidence and program ledger before the next task starts. This shared spec is updated in place; no parallel Remote Forge task spec or scenario-id list is created.

## Out of scope

- GitLab, Gitee, PR dependency DAG, Merge Queue, or Merge Train implementation.
- Replacing `electron/services/git-api.ts` or shelling out from Renderer.
- A second patch schema, local Git service, mutation journal, or context authority.
- Production repository writes, real credentials, or unsupervised remote side effects during engineering automation.
- Any claim that pre-canary engineering changes `liveReady`, `productApproved`, `defaultOn`, or FP-P1 acceptance.

## Completion rule

Synthetic and Electron evidence may prove the contract and fail-closed implementation, but it cannot satisfy the FP-P2 human gate. Real remote effects remain blocked until the named roles, fixed source SHA, Provider/Model, sandbox repository, credential scope, stop conditions, and rollback policy are approved in `FP-P2-01`.

