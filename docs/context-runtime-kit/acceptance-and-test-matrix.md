# Context Runtime Kit Acceptance and Test Matrix

## Global Acceptance Priorities

Evidence quality takes priority over token savings.

The following metrics are hard gates once a phase introduces them:

- Source Coverage (SC)
- Selector Stability (SS)
- Artifact Reproducibility (AR)
- Reference Resolution Rate (RRR)
- Hard Constraint Recall (HCR)
- Evidence Retention Rate (ERR)
- Recovery Fidelity Score (RFS)

Token Saving Rate (TSR) is useful only after the evidence gates remain green.

## Standard Commands

Use project-pinned pnpm:

```powershell
corepack pnpm harness context --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm exec vitest run <focused-tests> --reporter=verbose
corepack pnpm run typecheck
git diff --check -- <phase-owned-files>
```

Do not use a PATH pnpm that differs from `packageManager`.

## Phase Gate Matrix

| Phase | Main Deliverable | Required Test Evidence | Runtime Behavior |
| --- | --- | --- | --- |
| P0 | Harness specs and phase docs | harness context, harness validate, typecheck | unchanged |
| P1 | Protocol types | pure unit tests for serialization and validation, typecheck | unchanged |
| P2 | Tool/skill/rule compiler fixtures | compiler unit tests, SC/RRR/AR fixture report, typecheck | unchanged |
| P3 | Selector resolver | resolver unit tests for valid/missing/stale/ambiguous/checksum cases, typecheck | unchanged unless report-only |
| P4 | View generator | view tests for navigation-only markers, hard selectors, token estimates | unchanged unless shadow |
| P5 | Shadow router provider | prompt parity tests, shadow diagnostics tests, typecheck | legacy authoritative |
| P6 | Tool call gate | report-only missing selector tests before enforcement tests | report-only first |
| P7 | CompressionArtifact refs | compatibility tests, recovery fixture tests, ERR evidence | additive only |
| P8 | Recovery context | compact recovery benchmark, stale/missing ref tests | gated or shadow until accepted |
| P9 | Codebase index | symbol/range selector tests, stability tests, staleness tests | index-only until routed |
| P10 | Eval/reporting | metric report tests, worst-case failure report tests, secret scan | reporting only unless promoted |

## Unit Test Standards

Unit tests must use real code paths. Avoid tests that only assert mocks were called.

Each test name should state behavior:

- good: `rejects hard claims without a checksum-backed selector`
- bad: `works`

Each production function introduced for CRK must have focused coverage for:

- valid input,
- invalid input,
- deterministic output,
- boundary conditions,
- failure diagnostics.

## Integration Test Standards

Integration tests are required when a phase touches:

- context-engine provider registry,
- prompt assembly,
- tool-call gating,
- compression artifact projection,
- host-api contracts,
- renderer-visible surfaces,
- gateway or backend communication.

Renderer-visible changes require Electron E2E and full i18n coverage.

Backend communication changes require the relevant harness task spec and validation before review.

## Evidence Classification

If a broad command fails, classify the failure:

- this phase introduced it,
- unrelated existing drift,
- dependency or environment issue.

For unrelated failures, run the narrowest relevant command that still proves phase correctness.

## Minimum Review Packet

Before review, provide:

- phase constraint file path,
- changed files,
- focused test output,
- full or narrow typecheck output,
- harness output where applicable,
- acceptance checklist,
- rollback notes.
