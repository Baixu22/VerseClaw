---
lifecycleStatus: active
id: coding-run-protocol-v1
title: CodingRun Versioned JSONL Protocol (TF-0378)
type: task
intent: Add a versioned, fail-closed JSONL interchange contract and a CI summary consumer for existing CodingRun projections without changing runtime event semantics.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/coding-run.ts
  - shared/product-semantics.ts
  - scripts/coding-run-summary.mjs
  - docs/dev/coding-run-protocol.md
  - tests/unit/coding-run.test.ts
  - tests/fixtures/coding-run-protocol/**
  - harness/specs/tasks/coding-run-protocol-v1.md
  - harness/specs/fixtures/tf0378-coding-run-protocol/**
---

# TF-0378 CodingRun Versioned JSONL Protocol

## Objective

Freeze a small CI-consumable envelope over the existing read-only CodingRun
projection. The envelope has an explicit version, ordered records and a strict
parser; it is not a new runtime event source or a Codex CLI compatibility layer.

## Scope

- Every record carries `schema: coding-run/v1`, `sequence`, `recordType` and
  `payload`; the first record is the CodingRun projection.
- `parseCodingRunJsonl` rejects malformed JSON, missing fields, unknown fields,
  invalid schema, invalid record types and sequence errors.
- `scripts/coding-run-summary.mjs` consumes a valid stream and prints a stable
  JSON summary; invalid input exits non-zero with a structured error.
- Existing runtime event meanings, Task Ledger/Task Loop state machines,
  persistence and frozen defaults remain unchanged.
- The documented boundary explicitly excludes Codex exec's streaming CLI
  protocol and does not claim a complete Codex CLI compatibility layer.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm exec vitest run tests/unit/coding-run.test.ts` passes.
- Positive and negative fixtures cover valid, missing-field, invalid-event and
  unknown-field inputs.
- `node scripts/coding-run-summary.mjs tests/fixtures/coding-run-protocol/valid.jsonl`
  exits 0 and prints a summary.
- The invalid fixture exits 1 with a schema error.
- `pnpm harness validate --spec harness/specs/tasks/coding-run-protocol-v1.md` passes.
- `git diff --check` passes.
- No new runtime event authority, persistence, CLI runtime or downstream node
  implementation is included.

## Notes

The protocol is a display/CI interchange contract. All receipts are agent-driven;
no real-human evidence is claimed.
