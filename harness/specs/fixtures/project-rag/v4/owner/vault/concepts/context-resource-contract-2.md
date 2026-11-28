---
title: docs/context-runtime-kit/README.md
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T05:05:56.255Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: docs/context-runtime-kit/README.md
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~markdown
# Context Runtime Kit Long-Task Control Pack

This directory is the control pack for goal-mode implementation of Context Runtime Kit.

Goal-mode workers must not infer phase scope from conversation memory. They must read the relevant files in this order:

1. `AGENTS.md`
2. `docs/superpowers/plans/2026-07-06-context-runtime-kit.md`
3. `docs/context-runtime-kit/goal-mode-development-protocol.md`
4. `docs/context-runtime-kit/acceptance-and-test-matrix.md`
5. `docs/context-runtime-kit/phase-constraints/phase-XX-*.md` for the current phase
6. `harness/specs/tasks/context-runtime-kit.md`
7. `harness/specs/rules/context-runtime-kit-boundary.md`
8. `harness/specs/scenarios/context-runtime-kit.md`

## Operating Rule

Each goal-mode run implements one phase only unless the user explicitly starts a new goal for the next phase.

The active phase file is binding. If the phase file conflicts with a later design idea, stop and report the conflict. Do not silently expand the phase.

## Phase Files

- `phase-00-spec-and-harness.md`
- `phase-01-protocol-types.md`
- `phase-02-tool-skill-rule-compiler.md`
- `phase-03-selector-resolver.md`
- `phase-04-view-generator.md`
- `phase-05-shadow-router.md`
- `phase-06-tool-call-gate.md`
- `phase-07-compression-artifact-integration.md`
- `phase-08-recovery-context.md`
- ~~`phase-09-codebase-index.md`~~ (removed 2026-08-15: the orphaned in-memory
  codebase index was superseded by the FactStore tree-sitter pipeline —
  symbols, `calls`/`imports`/`tested_by` edges via
  `openclaw_runtime/src/context-engine/producers/analyzers/*` — which is the
  canonical content-level code-understanding path)
- `phase-10-eval-reporting.md`

## Default-On Promotion

After Phase 1-10, default runtime promotion is governed by
`harness/specs/tasks/context-runtime-kit-default-on.md`.

Backend context, prompt addition, and recovery may use the core-owned
`context-runtime-kit` engine by default when `plugins.slots.contextEngine` is
absent and `runtime.contextRuntimeKit.enabled !== false`. Explicit context
engine slots remain authoritative, including `legacy`.

Rollback is config-only:

- set `runtime.contextRuntimeKit.enabled: false`, or
- set `plugins.slots.contextEngine: "legacy"`.

The default fallback engine remains `legacy`. CRK failures are quarantined for
the current process and downgraded to legacy behavior. Tool-call gate output
stays `report_only`; active tool-call blocking and frontend settings UI are not
part of the default-on promotion.

## Default Gates

Every phase must finish with:

- focused unit tests for changed behavior,
- relevant harness validation,
- `corepack pnpm run typecheck`,
- `git diff --check` for phase-owned files,
- a written result summary that maps every acceptance criterion to evidence.

If a gate fails because of unrelated existing drift, the worker must run narrower diagnostics and classify failures as:

- introduced by this phase,
- pre-existing unrelated drift,
- dependency or environment issue.

No phase is complete while a phase-introduced failure remains.

~~~
