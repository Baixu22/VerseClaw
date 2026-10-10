---
lifecycleStatus: archived
id: sekb-runtime-long-task-development
title: SEKB Runtime Long Task Development
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Continue SEKB runtime knowledge development through goal-mode long tasks with explicit stage gates, test-first implementation, integration proof, and scoped documentation.
touchedAreas:
  - harness/specs/tasks/sekb-runtime-long-task-development.md
  - harness/specs/tasks/sekb-mvp.md
  - harness/specs/rules/sekb-runtime-development-loop.md
  - harness/specs/guides/sekb-long-task-stages.md
  - docs/enhancements/sekb-mvp.md
  - docs/enhancements/sekb-runtime-roadmap.md
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/state/**
  - openclaw_runtime/src/agents/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - electron/services/**
expectedUserBehavior:
  - Future SEKB work starts from the committed v0.2 runtime advisory baseline instead of a fresh MVP prompt.
  - Goal-mode agents can read one task spec and discover the required SEKB rules, stage guide, roadmap, tests, and closure gates.
  - Each stage produces working software, focused tests, integration proof when runtime wiring changes, and a documented handoff state.
  - Unrelated branch changes are kept out of SEKB commits and final proof.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - sekb-runtime-development-loop
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/sekb-runtime-long-task-development.md
  - pnpm harness validate --spec harness/specs/tasks/sekb-runtime-long-task-development.md
  - openclaw_runtime: node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
  - openclaw_runtime: node scripts/generate-kysely-types.mjs --verify
  - pnpm run comms:replay when communication paths change
  - pnpm run comms:compare when communication paths change
acceptance:
  - The active goal has a stage checklist derived from this task spec and `harness/specs/guides/sekb-long-task-stages.md`.
  - Runtime SEKB work stays explicit, default-off, advisory, and SQLite-backed unless a later approved spec changes that contract.
  - Every implementation stage uses red-green focused tests or is explicitly docs-only.
  - Schema changes include generated Kysely verification and keep nullable embeddings plus deterministic lexical retrieval.
  - Runtime hook changes prove real hook behavior or explain why only the adapter contract changed.
  - Renderer/Main/Gateway changes, if any, use host-api/api-client boundaries and run comms replay/compare.
  - UI changes, if any, include locale coverage and Electron E2E coverage.
  - Final proof lists commands run, pass/fail status, skipped-command rationale, scoped diff summary, and README translation decision.
docs:
  required: true
  note: Keep reusable SEKB constraints in harness/specs/** and roadmap or product-facing context in docs/enhancements/**.
---

This is the goal-mode entrypoint for SEKB work after the v0.2 runtime
knowledge baseline. It converts the original SEKB-MVP prompt into a durable
repo-owned contract that long-running agents can reload.

## Required Reading

Before editing code or docs, read:

- `harness/specs/tasks/sekb-runtime-long-task-development.md`
- `harness/specs/rules/sekb-runtime-development-loop.md`
- `harness/specs/guides/sekb-long-task-stages.md`
- `docs/enhancements/sekb-mvp.md`
- `docs/enhancements/sekb-runtime-roadmap.md`
- `openclaw_runtime/AGENTS.md` when touching `openclaw_runtime/**`

Then run:

```powershell
pnpm harness context --spec harness/specs/tasks/sekb-runtime-long-task-development.md
```

Read any additional context files returned by the harness command.

## Current Baseline

SEKB v0.2 is already implemented as a runtime-side advisory substrate:

- `TrajectoryCapture` records L3 trajectories and deterministic error
  signatures.
- `KnowledgeStore` persists L3 trajectories, L2 principles, L1 index data,
  error-signature cache entries, and distillation rejections in SQLite.
- `RetrievalEngine` supports deterministic lexical fallback and advisory
  prompt formatting.
- `DistillationTool.confirm_and_save` is the explicit write path for confirmed
  L2 principles.
- `installSekbHarnessHooks` installs optional AgentHarness-like hooks and is
  no-op unless explicitly enabled.
- `buildSekbOperatorReport` provides read-only operator evidence.

Do not restart from the pasted MVP prompt. Treat it as historical intent and
use the current code/docs as the source of truth.

## Recommended Next Long Task

Use option 1 as the next development package: SEKB runtime integration closure.

Goal: prove the v0.2 adapter against real runtime hook shapes, preserve the
default-off advisory contract, and produce operator-ready evidence without
adding desktop UI.

Expected deliverables:

- A focused runtime integration test that uses the real AgentHarness hook/event
  types or the closest stable owner seam.
- Any minimal adapter changes needed to align `installSekbHarnessHooks` with
  real runtime events.
- Updated docs explaining how a runtime owner enables SEKB and what evidence
  proves it worked.
- Fresh focused unit/integration proof and harness validation.

Defer desktop UI, default-on enablement, autonomous distillation, verifier,
curator, and external vector service work unless the user explicitly selects a
new task spec for those surfaces.

## Stage Checklist For Goal Mode

1. Context and branch hygiene:
   - Run `git status --short --branch`.
   - Record unrelated dirty files and do not stage them.
   - Run the harness context command for this spec.
2. Scope mapping:
   - Pick exactly one SEKB work category from the stage guide.
   - Stop for user confirmation if the category requires UI, default-on
     behavior, autonomous writes, new config/env, or external services.
3. Test design:
   - Add the focused failing unit or integration test first.
   - Name the expected failure before implementing.
4. Implementation:
   - Keep state in SQLite and runtime logic in existing SEKB modules unless the
     chosen stage justifies a new narrow file.
   - Do not add hidden correction, retry, pause, block, or output rewrite paths.
5. Verification:
   - Run focused SEKB tests.
   - Run schema verification if schema changed.
   - Run harness validation for this spec.
   - Run comms replay/compare only if communication paths changed.
6. Documentation:
   - Update SEKB enhancement docs or roadmap for behavior and stage-boundary
     changes.
   - State README translation impact.
7. Closure:
   - Inspect `git diff --stat` and `git status --short --branch`.
   - List implemented items, deferred items, verification evidence, and known
     risks.

## Non-Negotiable Boundaries

- No renderer direct IPC or Gateway HTTP/WebSocket calls.
- No required external vector database or embedding service.
- No JSON sidecar state for SEKB runtime data.
- No automatic L2 principle write except `confirm_and_save`.
- No invisible prompt rewriting or hidden recovery.
- No broadened runtime authority from renderer metadata.
- No staged unrelated files.

## Definition Of Done

A SEKB long task is done only when the final response can name:

- The exact active branch and scoped diff.
- Each planned stage and whether it was implemented or explicitly deferred.
- Fresh verification commands and their outcomes.
- Whether comms replay/compare was required.
- Whether README translation updates were required.
- Any remaining user decision required for the next stage.
