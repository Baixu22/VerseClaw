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
  - pnpm exec playwright test tests/e2e/mainline-review-followup.spec.ts
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
