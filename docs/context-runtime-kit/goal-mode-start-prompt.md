# Goal-Mode Start Prompt for Context Runtime Kit

Use this prompt to start a goal-mode run. Replace `<PHASE_NUMBER>` and `<PHASE_FILE>`.

```text
Goal: Complete Context Runtime Kit Phase <PHASE_NUMBER> only.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Before doing any implementation, read these files in full:
1. AGENTS.md
2. docs/superpowers/plans/2026-07-06-context-runtime-kit.md
3. docs/context-runtime-kit/README.md
4. docs/context-runtime-kit/goal-mode-development-protocol.md
5. docs/context-runtime-kit/acceptance-and-test-matrix.md
6. docs/context-runtime-kit/phase-constraints/<PHASE_FILE>
7. harness/specs/tasks/context-runtime-kit.md
8. harness/specs/rules/context-runtime-kit-boundary.md
9. harness/specs/scenarios/context-runtime-kit.md

Hard constraints:
- Implement only the active phase.
- Do not implement later-phase deliverables.
- Do not reset, checkout, or revert unrelated user changes.
- Use project-pinned pnpm via corepack.
- Follow TDD for production behavior.
- For documentation/spec phases, run harness validation before and after edits when possible.
- Keep runtime behavior unchanged unless the active phase explicitly permits active behavior.
- Do not introduce a parallel durable source of truth.
- Do not change UI/i18n/E2E unless the active phase explicitly requires a user-visible surface.

Required final report:
- active phase,
- changed files and responsibilities,
- RED -> GREEN evidence when applicable,
- commands run and results,
- acceptance checklist,
- unrelated dirty files or failures,
- blockers,
- whether the phase is ready for review.
```
