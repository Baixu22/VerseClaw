# Pinned PNPM Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-owned verification entry point that always runs commands through the pnpm version pinned by `package.json`.

**Architecture:** A Node CLI resolves the pinned `pnpm@10.33.4` from `package.json`, checks available pnpm candidates, and runs the requested pnpm command only through a matching candidate. Package scripts expose stable verification commands so Codex PATH ordering cannot silently select pnpm 11 for role-first verification.

**Tech Stack:** Node.js ESM scripts, TypeScript/Vitest test suite, pnpm package scripts.

## Global Constraints

- Do not rely on bare `pnpm` when the Codex runtime pnpm can appear first on PATH.
- The pinned package manager version is read from `package.json` `packageManager`.
- The gateway harness command must use `harness/specs/scenarios/gateway-backend-communication.md`, because the old `harness/specs/tasks/gateway-backend-communication.yaml` path does not exist.
- The runner must not install dependencies or mutate `node_modules`.
- Tests must be written before implementation.

---

### Task 1: Pinned PNPM Runner

**Files:**
- Create: `scripts/run-with-pinned-pnpm.mjs`
- Create: `tests/unit/pinned-pnpm-runner.test.ts`

**Interfaces:**
- Produces `parsePackageManagerSpec(spec: string): { name: string; version: string }`.
- Produces `resolvePinnedPnpm(options): { ok: true; command: string; argsPrefix: string[]; version: string; label: string } | { ok: false; expectedVersion: string; attempts: PnpmResolutionAttempt[] }`.
- Produces CLI usage: `node scripts/run-with-pinned-pnpm.mjs <pnpm args...>`.

- [x] **Step 1: Write failing tests**

Create tests that assert exact package manager parsing, wrong PATH pnpm fallback to `corepack pnpm`, user shim fallback, and failure messaging when no candidate matches.

- [x] **Step 2: Run tests to verify RED**

Run: `.\node_modules\.bin\vitest.cmd run tests/unit/pinned-pnpm-runner.test.ts`

Expected: fail because `scripts/run-with-pinned-pnpm.mjs` does not exist.

- [x] **Step 3: Implement runner**

Implement ESM exports and CLI behavior. The CLI resolves a matching pnpm candidate, prints the selected candidate, then forwards arguments with inherited stdio.

- [x] **Step 4: Run tests to verify GREEN**

Run: `.\node_modules\.bin\vitest.cmd run tests/unit/pinned-pnpm-runner.test.ts`

Expected: all tests pass.

### Task 2: Stable Verification Scripts

**Files:**
- Modify: `package.json`
- Modify: `docs/multi-agent-orchestration/2026-07-08-role-first-completion-audit.md`

**Interfaces:**
- Produces `pnpm run verify:pinned-pnpm`.
- Produces `pnpm run verify:typecheck`.
- Produces `pnpm run verify:harness:gateway`.

- [x] **Step 1: Add package scripts**

Add:

```json
"verify:pinned-pnpm": "node scripts/run-with-pinned-pnpm.mjs --version",
"verify:typecheck": "node scripts/run-with-pinned-pnpm.mjs run typecheck:node && node scripts/run-with-pinned-pnpm.mjs run typecheck:web",
"verify:harness:gateway": "node scripts/run-with-pinned-pnpm.mjs harness validate --spec harness/specs/scenarios/gateway-backend-communication.md --no-diff && node scripts/run-with-pinned-pnpm.mjs harness run --spec harness/specs/scenarios/gateway-backend-communication.md --dry-run"
```

- [x] **Step 2: Update audit docs**

Record the new stable commands and keep the old bare `pnpm` caveat as environment context only.

- [x] **Step 3: Verify**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/pinned-pnpm-runner.test.ts
node scripts/run-with-pinned-pnpm.mjs --version
node scripts/run-with-pinned-pnpm.mjs run typecheck:node
node scripts/run-with-pinned-pnpm.mjs run typecheck:web
node scripts/run-with-pinned-pnpm.mjs harness validate --spec harness/specs/scenarios/gateway-backend-communication.md --no-diff
node scripts/run-with-pinned-pnpm.mjs harness run --spec harness/specs/scenarios/gateway-backend-communication.md --dry-run
```

Expected: every command exits `0`.
