---
id: coding-runtime-workspace-dcs-producer-vertical-slice
title: Coding Runtime P0 workspace authority and DCS producer vertical slice
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove one real ClawX coding vertical slice: trusted Chat workspace identity becomes the sole runtime workspace authority, production mutation tools explicitly emit working-memory facts, and accepted facts appear exactly once in the next LLM context through the accepted DCS Stage 1 path.
touchedAreas:
  - harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md
  - harness/specs/rules/coding-runtime-workspace-dcs-producer-boundary.md
  - team/dcs/dcs-v1.6-spec.md
  - team/dcs/dcs-v1.6-review.md
  - src/stores/chat.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/**
  - openclaw_runtime/src/auto-reply/reply/get-reply.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/**/workspace*.ts
  - openclaw_runtime/src/**/sandbox*.ts
  - tests/unit/**
  - tests/e2e/**
  - artifacts/**
  - team/dcs/README.md
expectedUserBehavior:
  - A normal Chat turn selecting workspace A runs file tools, shell, sandbox, and DCS against the trusted root for A, and cannot access workspace B through an inherited cwd or stale scope.
  - Changing a session's selected workspace creates a fresh authoritative scope or invalidates the old one; working-memory Blocks from the old workspace are not read.
  - Successful production edit, write, and apply_patch results emit an explicit producer-owned working-memory envelope. Read, search, CodeGraph, and generic exec/process results do not.
  - With working memory enabled, the next LLM call shows exactly one transient `## Recent Actions` block derived from accepted persisted actions; repeated LLM calls do not accumulate it and transcripts do not contain it.
  - With the flag disabled or an absent envelope, the run remains a no-op for DCS working memory and preserves existing output identity.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - docs-sync
  - active-config-guards
  - coding-runtime-workspace-dcs-producer-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md
  - pnpm harness validate --spec harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md
  - pnpm run typecheck
  - pnpm run lint
  - pnpm test
  - pnpm run test:dcs
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run harness:ci
  - pnpm harness run --spec harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm --dir openclaw_runtime build
  - pnpm run build:vite
  - pnpm run test:e2e
  - git diff --check
acceptance:
  - Before production edits, verify DCS Stage 1 final COMPLETE, every Stage 1 gate exit code 0, independent review Critical 0 / Important 0, and an honest report of production producer coverage. A partially complete Stage 1 or clean-copy-only build result blocks this task.
  - Preflight traces the canonical Chat workspace identity source, trusted Main root resolver, Gateway/runtime request boundary, runtime workspace/cwd/sandbox construction, session persistence/binding, and mutation tool producers. If a second authority exists, stop and amend this manifest before code.
  - RED tests first prove missing trusted workspace propagation, stale workspace-scope leakage, absent producer envelope emission, forbidden envelope emission from read/search/exec, absent exactly-once transient injection, and flag-off/no-envelope no-op behavior.
  - Renderer sends only identity. Main resolves the trusted root and runtime receives one authority for workspaceDir, cwd, file boundaries, and sandbox root. The test matrix proves A cannot access B.
  - Session-workspace binding uses a trusted root fingerprint. A workspace switch either creates a new session or invalidates the previous DCS working-memory scope before the next read; display names alone are not authorization.
  - Only edit/write/apply_patch producers emit explicit envelopes. Hook layers do not infer them. Missing, malformed, low, or unowned metadata causes no handler/sink/store/injection behavior.
  - The next LLM call after an accepted mutation has exactly one temporary Recent Actions block. It is absent from transcript persistence and non-accumulating across repeated calls. COMPASS remains untouched.
  - Flag-off and no-envelope paths prove zero BlockStore construction/query/write and exact existing-output identity. No producer metadata dependency leaks into those paths.
  - Generate machine-readable matched off/on replay evidence for workspace/cwd consistency, producer coverage, next-call visibility, duplicate-injection count, verification pass rate, task pass rate, tokens, latency, repeated tool calls, and wrong-workspace access. Do not claim positive uplift without the matched comparison.
  - No DCS Stage 2 task_state/handoff, AgentMap, AST, SEKB, COMPASS, LSP, CodeGraph algorithm, new event bus/store, always-on promotion, or Renderer direct transport is introduced.
  - Final report lists path-map evidence, RED/GREEN evidence, all gates and exit codes, off/on evidence, ownership/prohibition scans, untracked-file results, and independent review Critical 0 / Important 0.
docs:
  required: true
  files:
    - team/dcs/README.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Coding Runtime P0 Implementation Gate

## Design Authority

This task consumes accepted DCS Stage 1 behavior; it does not redefine DCS.
Use the Stage 1 final report and `team/dcs/dcs-v1.6-spec.md` as authority for
working-memory persistence, transient visibility, and default-off behavior.

## Start Gate

Run Harness context and validation first. Then record the actual source-to-run
path map. If the Stage 1 final report, its full gates, the real-worktree Runtime
build, the trusted root resolver, or the canonical mutation producers are
unavailable, report BLOCKED. Do not bypass the missing dependency with a new
transport, an inferred cwd, or a synthetic producer.

## Scope Sequence

1. Establish one trusted workspace authority and session binding.
2. Prove workspace A isolation from B across cwd, files, and sandbox.
3. Add explicit mutation producer envelopes only.
4. Prove the accepted Stage 1 path has next-call, exactly-once transient
   visibility and flag-off identity.
5. Run matched off/on replays and report effects without overstating benefit.

## Completion Rule

Only update DCS documentation after all production, Electron E2E, contract,
comms, Runtime build, and independent-review gates are green. The following DCS
Stage 2 task may begin only after this task has its own COMPLETE report.
