---
id: remote-forge-controlled-preview
title: Remote Forge controlled preview
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add one Main-owned GitHub Remote Forge path for bounded PR reads, structured diff evidence, action-bound review mutations, and fail-closed sandbox merge while preserving the existing local Git service and Coding write journal authorities, then close the controlled-preview DCS turn-injection attribution residual without adding a second context or budget authority.
touchedAreas:
  - artifacts/first-product-preview/FP-P2-06/**
  - artifacts/first-product-preview/FP-P1-08/forbidden-claims-scan.json
  - artifacts/first-product-preview/FP-P2-07/**
  - artifacts/first-product-preview/FP-P2-08/**
  - artifacts/first-product-preview/FP-P2-09/**
  - artifacts/first-product-preview/FP-P2-10/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/dev/NEXT-GOAL.md
  - docs/dev/default-config-matrix.md
  - docs/dev/first-product-controlled-preview/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/handoffs/NEXT-GOAL.md
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
  - shared/host-api/contract.ts
  - shared/types/code-review.ts
  - shared/types/git.ts
  - shared/types/remote-forge.ts
  - shared/remote-forge/**
  - electron/services/git-api.ts
  - electron/services/code-review-api.ts
  - electron/services/remote-forge-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - src/lib/generated-files.ts
  - src/pages/CodeReview/**
  - src/pages/Chat/index.tsx
  - src/components/file-preview/WorkspaceGitPanel.tsx
  - src/components/tool-ui/code-diff/**
  - src/components/tool-ui/run-surfaces.ts
  - src/components/tool-ui/RunMutationDiffs.tsx
  - harness/specs/rules/coding-runtime-workspace-dcs-producer-boundary.md
  - harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/agent-tools.auto-verify.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit-diff.ts
  - openclaw_runtime/src/agents/sessions/tools/tool-contracts.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.working-memory.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/tools/write-journal.test.ts
  - openclaw_runtime/src/agents/test-runner-detect.ts
  - openclaw_runtime/src/agents/test-runner-detect.test.ts
  - openclaw_runtime/src/agents/write-side-effects.ts
  - openclaw_runtime/src/agents/write-side-effects.verify-tests.test.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/assembler.test.ts
  - openclaw_runtime/src/context-engine/injection-budget.ts
  - openclaw_runtime/src/context-engine/coding-runtime-flags.ts
  - openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts
  - openclaw_runtime/src/context-engine/runtime-flag-ack.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.test.ts
  - openclaw_runtime/src/gateway/chat-display-projection.ts
  - openclaw_runtime/src/gateway/chat-display-projection.test.ts
  - openclaw_runtime/tsconfig.json
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/fixtures/remote-forge-unified-diff-corpus.ts
  - tests/fixtures/launch-contract-matrix.ts
  - tests/e2e/code-review-center.spec.ts
  - tests/e2e/coding-loop-fp-p1-04.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/remote-forge-controlled-preview.spec.ts
  - vite.config.ts
  - harness/specs/tasks/remote-forge-controlled-preview.md
expectedUserBehavior:
  - DCS edit and full-file write results show one structured code diff with a copyable text fallback, completeness state, and the same request and journal lineage as the underlying mutation.
  - Users can inspect GitHub pull request details, commits, bounded file content, diffs, checks, reviews, and readiness through a typed host-api-backed surface without renderer-owned GitHub transport.
  - Pagination, truncation, missing head SHA, stale head, stale readiness, stale approval, and unknown branch-protection state remain visible and fail closed.
  - Review comments and metadata mutations require an action-bound one-time approval tied to provider, repository, pull request, head SHA, action, and payload digest.
  - Merge remains disabled by default and can only run for the charter-named sandbox repository after Main re-reads head and readiness immediately before the approved action.
  - Users and MCP callers can request but never self-grant a merge approval, and stale head, readiness, strategy, payload, or sandbox policy always requires a fresh request.
  - A real DCS-enabled coding turn exposes independently measured knowledge, working-memory, and tool-registry prompt growth against the same per-turn injection ledger, including explicit truncation or drop evidence when the fixed budget is exceeded.
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
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/assembler.test.ts src/context-engine/turn-injection-budget.test.ts src/agents/embedded-agent-runner/extensions.knowledge.test.ts src/agents/embedded-agent-runner/extensions.working-memory.test.ts
  - pnpm run test:e2e:run -- tests/e2e/coding-loop-fp-p1-04.spec.ts --workers=1
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
  - Knowledge, working_memory, and tool_registry each charge the existing per-turn injection ledger at their real assembler projection point. Disabled, killed, or empty projections do not create synthetic channel entries.
  - The fixed 6000-character turn budget is not enlarged. When the three DCS projections are enabled, the existing 2000-character DCS capacity is reserved in the same ledger before the earlier CVK charge; the reservation creates neither a charge nor a byChannel entry, and CVK truncation remains explicit evidence.
  - DCS allocation order remains knowledge, working_memory, then tool_registry. Focused over-budget tests prove applied, truncated, and dropped outcomes in that order, while the real Electron turn independently measures provider-visible characters and matches each channel's applied ledger count.
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
    - docs/dev/first-product-controlled-preview/tasks/FP-P2-06.md
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
5. `FP-P2-06`: close the DCS injection-budget attribution residual in the existing turn ledger, preserve the fixed budget and precedence, and record provider-measured truncation evidence.

Each task closes its own evidence and program ledger before the next task starts. This shared spec is updated in place; no parallel Remote Forge task spec or scenario-id list is created.

## FP-P2-08 read contract

- Main owns one GitHub REST adapter. Renderer payloads contain only `provider=github`, repository owner/name, PR number, ref, and repository-relative paths; API origin, token, headers, pagination, timeout, and transport remain Main-owned.
- The pull-request read result types detail, commits, files, full diff artifacts, checks, reviews, branch protection, capability state, aggregate completeness, and readiness. Each paginated collection is deduplicated by its stable provider id/SHA/path and carries `complete/incomplete/truncated/unavailable`, stable reasons, and optional `truncatedAt`.
- Adapter ceilings are fixed for preview evidence: 100 items per provider page, at most 5 pages and 500 deduplicated items per collection, 1 MiB per response body, 5 seconds per request, at most 16 content paths per call, 4 concurrent content reads, and 512 KiB decoded content per file. Producer limits may be stricter and may never be upgraded by a consumer.
- Full diff is read separately from file metadata and projected only through `adaptUnifiedDiffToGitPatchArtifacts`. Missing/oversize/malformed diff, file/diff path drift, pagination failure, or a GitHub file without a trustworthy patch remains explicit incomplete evidence; it is never represented as an empty complete diff.
- File content distinguishes UTF-8 text, binary bytes represented as bounded base64, provider-base64 payload, truncated, and unavailable. Absolute paths and caller-provided origins are rejected before transport.
- Readiness states are `ready/blocked/pending/unknown`. Missing head SHA, unknown mergeability or protection, incomplete checks/reviews/files/diff, request failure, pagination failure, or truncated evidence forces `unknown`; draft/conflict/behind/failed checks/insufficient approvals are stable veto reasons. `unknown` never enables a remote action.
- Request traces contain only request id, provider operation, method, bounded route template, status, duration, and completeness. Credential/header/query values, response bodies, repository content, private hosts, and absolute paths are excluded.
- Built-in Remote Forge MCP reads call the same Main service instance used by typed host-api. They do not shell out to `gh`/`git`, construct provider HTTP independently, or expose mutation tools.
- Automated unit, fixture integration, and Electron E2E use a loopback fake HTTP provider with fake authorization only. The production origin remains `https://api.github.com`; an alternate origin is accepted only while `VERSE_CLAW_E2E=1` or through an injected test dependency.

## FP-P2-09 mutation contract

- Review submission, line-comment creation/edit, thread reply, and allowlisted PR metadata updates run only in the existing Main Remote Forge service through typed host-api. The implementation reuses `permissions-api` for durable approval, expiry, decision, and single-use consumption; it does not add a second approval store or execution plane.
- Every normalized mutation binds provider, owner/repository, PR number, expected head SHA, action, and a SHA-256 digest of the bounded canonical payload. Metadata also binds `expectedUpdatedAt`; line comments bind repository-relative path, side, line, body digest, and a bounded optional diff hunk. Full repository content is never retained as a comment snapshot.
- A first call validates and immediately reads current PR head/version, then returns an approval request without a remote write. An approved retry consumes that exact binding once before immediately re-reading head/version. Missing, denied, expired, already-consumed, action-drifted, payload-drifted, stale-head, or stale-version approval fails closed and requires a new request.
- Agent-created text remains a draft by default. Only an explicit approval decision followed by the exact approved retry may publish. Automated tests use only an injected or `VERSE_CLAW_E2E=1` loopback fake provider; no engineering gate posts to a real GitHub repository.
- Primary review/comment/metadata effects and follow-up label/reviewer/refresh effects are reported separately as `not_attempted/succeeded/failed/unknown`. A primary success plus follow-up failure is `partial`, not failed. A timeout/network ambiguity after a write attempt is `unknown` and requires manual refresh/reconciliation; retry never silently assumes the primary effect was absent.
- Mutation responses and request traces retain only bounded ids, action, safe state, stable route templates, duration, status, payload/body digests, and minimal comment lineage. Tokens, Authorization/header values, raw response bodies, private hosts, absolute paths, full source files, and review/comment body text are excluded.
- Unit and fake-provider integration cover approval request/consume/replay, head and version drift, action and payload drift, create/edit/reply, permission/rate-limit errors, metadata partial success, ambiguous network failure, and safe reconciliation. Electron E2E covers the visible draft -> approve -> exact retry flow plus stale and partial states with en/zh/ja/ru copy.

## FP-P2-10 controlled merge contract

- Merge runs only in the existing Main Remote Forge service. Main reads the current PR, computes readiness, and evaluates every hard veto before creating an approval request, then repeats the same read/evaluation immediately after consuming an exact approval and before sending the merge request. Renderer and MCP callers cannot supply or override readiness.
- Readiness remains `ready/blocked/pending/unknown` with stable reasons. Missing head, incomplete/truncated/unavailable evidence, pagination failure, unknown branch protection or mergeability, draft, conflict, behind state, pending/failed checks, insufficient reviews, unresolved permission, or any read failure prevents merge.
- A merge binding includes provider, owner/repository, PR number, expected head SHA, strategy, readiness digest, canonical payload digest, and the fixed sandbox policy identity. Approval is time-bounded and single-use through `permissions-api`; head, strategy, readiness, payload, workspace, or allowlist drift requires a new request.
- Production merge is disabled unless the target exactly matches a Main-owned sandbox allowlist. Agent-initiated merge remains default-off even for an allowlisted target. Tests may inject an allowlist only with an injected dependency or `VERSE_CLAW_E2E=1` fake provider and never write to a real repository.
- The provider merge request carries the expected head SHA. Conflict/stale-head responses map to stable refresh-required semantics. A successful primary merge followed by refresh or audit failure is `partial` with reconciliation, never a retryable failed merge; an ambiguous primary write is `unknown` and requires manual provider reconciliation.
- The typed host API and built-in MCP merge tool call the same Main service. The MCP tool may request approval and retry with an external approval id, but cannot decide or manufacture approval. The four-locale UI remains preview-first, labels Agent merge as off, and exposes veto, approval, stale, partial, unknown, and reconciliation states.
- Unit, fake-provider integration, and Electron E2E cover ready success, CI pending/failed, draft, conflict, behind, unknown/incomplete/truncated evidence, permission failure, sandbox denial, approval replay, head/readiness/strategy/payload drift, provider conflict, partial refresh/audit failure, and ambiguous merge response.

## FP-P2-06 turn-injection attribution contract

- `knowledge`, `working_memory`, and `tool_registry` are projected by the existing DCS context assembler and charge the same turn ledger identified by the real coding attempt. The context hook receives the attempt turn id and all enabled DCS projection flags; it does not create another orchestrator, producer, or budget owner.
- DCS projections allocate in the frozen order `knowledge -> working_memory -> tool_registry`. Empty blocks, disabled flags, and killed turns append nothing and create no false `byChannel` evidence. Calls without a turn id retain the legacy local 2000-character assembler budget.
- The global turn budget remains 6000 characters. A DCS-enabled attempt reserves the existing 2000-character DCS capacity in the same ledger before CVK is charged so earlier execution timing cannot invert the frozen channel ownership. Reservations do not increment counters or appear in `byChannel`.
- Truncation is an accepted, explicit controlled-preview outcome rather than a reason to enlarge the budget. Real Electron evidence must show CVK bounded to the unreserved capacity, all three DCS channels with non-zero provider-visible content, per-channel measured characters equal to ledger `applied`, and the total identity `applied + dropped + truncated = requested`.
- Focused tests independently derive appended prompt growth from the output messages, exercise applied/truncated/dropped DCS outcomes under a small budget, and prove that a prior low-priority CVK charge cannot consume reserved higher-priority DCS capacity.

## Out of scope

- GitLab, Gitee, PR dependency DAG, Merge Queue, or Merge Train implementation.
- Replacing `electron/services/git-api.ts` or shelling out from Renderer.
- A second patch schema, local Git service, mutation journal, or context authority.
- Production repository writes, real credentials, or unsupervised remote side effects during engineering automation.
- Any claim that pre-canary engineering changes `liveReady`, `productApproved`, `defaultOn`, or FP-P1 acceptance.

## Completion rule

Synthetic and Electron evidence may prove the contract and fail-closed implementation, but it cannot satisfy the FP-P2 human gate. Real remote effects remain blocked until the named roles, fixed source SHA, Provider/Model, sandbox repository, credential scope, stop conditions, and rollback policy are approved in `FP-P2-01`.

