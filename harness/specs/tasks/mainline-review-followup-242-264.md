---
lifecycleStatus: active
id: mainline-review-followup-242-264
title: Repair follow-up review findings in configuration, tasks and knowledge
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Address issues 242 through 256, 258 through 264 and the file-level scan follow-up on 237 using the existing owners and persistent contracts.
diffBase: 505d3c328d564f4ae74498e5147251bb373c4fbb
touchedAreas:
  - AGENTS.md
  - electron/**
  - src/**
  - shared/**
  - scripts/contract-check.mjs
  - artifacts/agent-dev-workbench/evidence.json
  - openclaw_runtime/extensions/memory-wiki/**
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/plugin-sdk/**
  - tests/**
  - README*.md
  - docs/**
  - harness/specs/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - local-data-fail-closed-config
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/remote-tasks-api.test.ts tests/unit/channel-config.test.ts tests/unit/mcp-api.test.ts tests/unit/providers-api.test.ts tests/unit/model-options.test.ts tests/unit/runtime-approval-prompt.test.tsx tests/unit/knowledge-api.test.ts tests/unit/knowledge-source-sync.test.ts
  - pnpm run typecheck
  - pnpm exec playwright test tests/e2e/mainline-review-followup.spec.ts tests/e2e/chat-model-picker.spec.ts
  - pnpm run build:runtime
  - pnpm run agent-dev:fast
expectedUserBehavior:
  - Routine edits retain Cron delivery, channel credentials and MCP exposure settings.
  - Failed refreshes retain the last known list and show the error; failed saves remain retryable.
  - Concurrent mutations preserve each accepted change, and running remote tasks cannot execute twice.
  - Explicit skill removal survives restart, and expired approvals release the composer.
  - Imported source identity prevents same-title overwrites; reviewed creates reject collisions.
  - Wiki mutations serialize revision checks with writes and recover committed operations without replaying their effects.
  - Lifecycle governance reads authorized metadata for archived pages without exposing archived bodies.
acceptance:
  - Issues 242, 243 and 249 retain delivery across unrelated edits and never mutate routing on a list read or project an RPC error as an empty queue.
  - Issues 244 and 248 preserve existing non-default channel accounts and unchanged masked secrets while rejecting duplicate bot credentials without exposing them.
  - Issues 245 and 246 serialize MCP configuration plus vault mutation and preserve validated JSON fields including headers, exposure and sslVerify.
  - Issue 247 persists deliberate preinstalled-skill removals and permits explicit reinstall.
  - Issues 250, 251 and 255 share runtime identity rules, resolve the account authentication route and retry incomplete runtime synchronization.
  - Issues 252 and 253 atomically claim task execution and reject corrupt/unreadable persisted task data without overwriting it.
  - Issue 254 reconciles approval expiry, fresh snapshots and late responses while preserving the composer draft.
  - Issue 256 aligns active catalogs and scenarios with typed Renderer-to-Main IPC and Main-owned Gateway WebSocket.
  - Issues 258 through 262 preserve independent source pages and manual notes, reject create collisions, serialize mutation revisions and resume partial governance commits using owner evidence.
  - Issues 263 and 264 apply egress checks only at a real remote rerank boundary and never label an intent as a committed receipt.
  - Issue 237 isolates invalid files within a source while retaining their previous cursor and preventing deletion inference from incomplete scans.
docs:
  required: true
  note: Update affected module contracts and README variants for user-visible changes; retain agent-driven validation results with this task.
---

Continuation of the owner's mainline issue repair request. This work extends PR
257; the earlier eight repairs and their evidence remain intact. Each issue stays
open until its corresponding verified repair reaches main.

## Verified repair mapping — 2026-11-23

| Issues | Behavioral verification |
|---|---|
| 242, 243, 249 | Untouched webhook delivery survives UI rename; list reads do not write routing; offline refresh retains the last renderer snapshot and reports failure. |
| 244, 248 | Repeated non-default channel saves retain one account; masked secrets preserve original values, explicit changes/clears persist, duplicate errors omit credentials. |
| 245, 246 | Concurrent MCP creates and disables both persist; failed rollback preserves another accepted update; JSON headers/exposure/TLS fields and masked-header edits round-trip. |
| 247 | Preinstalled removal survives service restart; explicit verified reinstall clears the removal preference. |
| 250, 251, 255 | Imported custom/ollama identity is stable through model selection; OAuth fallbacks use account routing; identical retry re-applies failed runtime synchronization. |
| 252, 253 | Task execution is claimed once; running task retries are rejected; malformed stores remain intact and missing primaries recover a valid backup. |
| 254 | Natural approval expiry releases the composer draft; late list responses cannot revive resolved approvals; failed decisions reconcile the owner list. |
| 256 | Active registry, catalogs and contract checker use typed IPC plus Main-owned Gateway WebSocket; the old synthetic fallback scenario is replaced. |
| 258, 259, 260 | Same-title sources retain separate pages and notes; create collisions preserve accepted content; concurrent same-revision writers admit one result; other mutation paths advance revisions. |
| 261, 262, 264 | Faults after Wiki, draft and proposal persistence recover without replaying the mutation; archived/revoked lifecycle metadata provides actual revision without content; intent has no committed receipt and failed receipts have no commit timestamp. |
| 263, 237 follow-up | Local/exact/unavailable rerank paths retain local results; invalid source files do not block healthy siblings or cause false withdrawals. |

Code candidate: `f48ee62c2895b72f27c3bdd5e43a93abc330b7b2`; initial follow-up
implementation: `447c0505005fc36a0de05a8e71c6d173da9590fb`. Evidence is
`driven_by: agent`.

- 28 focused Vitest files: 384 passed. The file list and JSON report are retained in `D:/tmp/mainline-more-issue-fixes-20261123/delivery-unit.json`.
- Existing Runtime lifecycle suite: 6 passed. The Runtime test shard first failed package-alias resolution; the same six tests ran with the application's Runtime alias plugin and retained their behavioral assertions, including denied archived-body reads.
- Four Electron journeys passed against rebuilt application bytes: webhook rename, real Host MCP registration/edit, approval expiry and imported-account model selection. Report: `delivery-electron-r2.json`.
- `build:runtime` completed with authenticated Gateway readiness smoke; `build:vite`, uncached Node/Web/test typecheck, Host contract, targeted ESLint, comms replay/compare, catalogs check and Harness validate/dry-run passed.
- `agent-dev:fast`: contract, i18n, Workbench evidence and 190 tests passed. The refreshed Workbench preserves its recorded performance status; this run does not replace deep performance acceptance.

Earlier failures and final source/report SHA-256 bindings are retained with the
local evidence. Concurrent dependency reinstall temporarily removed test entry
points; final checks ran after restoration. Electron uses the byte-identical
staged runtime recorded by the preceding repair task. No external model call is
part of the regression fixtures.
