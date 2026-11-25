---
lifecycleStatus: active
id: committed-branch-integration-20261109
title: Integrate committed work while preserving current owners and local edits
taskType: runtime-bridge
scenario: gateway-backend-communication
diffBase: dee28c8a2ea24e1c4abf1260bbd5dee156bec4a4
intent: Merge current committed branches in an independent checkout, reconcile overlapping recovery and worktree contracts, and push the verified integration to the existing private main branch.
touchedAreas:
  - .gitignore
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/stepfun-basic-live-evidence-20261008/INTEGRITY.json
  - artifacts/windows-alpha-closeout-20261008/INTEGRITY.json
  - README*.md
  - package.json
  - pnpm-lock.yaml
  - vite.config.ts
  - packages/versebrowser/package.json
  - resources/verseshell-mcp/package.json
  - docs/**
  - electron/**
  - harness/specs/**
  - openclaw_runtime/**
  - playwright.resource-governance.config.ts
  - vitest.terminal-resources*.config.ts
  - scripts/**
  - shared/**
  - src/**
  - tests/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - runtime-lifecycle-governance-boundary
  - repository-artifact-retention
  - comms-regression
  - docs-sync
  - disk-temp-policy
expectedUserBehavior:
  - Current committed Skill, MCP, context, recovery and resource changes coexist with the durable task and checkout owners.
  - Worktree merges preserve generation fences, concurrent user edits, journal receipts and unknown outcomes across restart.
  - Historical backup and superseded experimental branches remain available without restoring obsolete product behavior.
requiredTests:
  - tests/unit/worktree-registry-restart.test.ts
  - tests/unit/orchestration-worktree-merge.test.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/gateway-supervisor.test.ts
  - tests/unit/recovery-authority-contract.test.ts
  - tests/unit/recovery-contract-eval.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Incoming code cannot restore retired patch-flow execution or weaken current recovery evidence checks.
  - The registry persists merge baselines and the latest receipt through its existing SQLite owner; no second store is introduced.
  - Shared root locking covers asynchronous journal application; duplicate completions read verified receipts and uncertain effects prevent replay.
  - Tests cover merge deletion, binary content, stale generations, parent edits, restart, process termination and retained historical effects.
  - Original working directories and indexes retain their uncommitted work; only integration commits are pushed.
  - Remote main resolves to the pushed candidate after a normal fast-forward push.
docs:
  required: true
  files:
    - harness/specs/guides/execution-domain-registry.md
---

The owner chose current valid changes and retention of historical backup branches
on 2026-11-09. Existing evidence keeps its original candidate and verdict. The
integration record stores new command results separately from those source packs.
