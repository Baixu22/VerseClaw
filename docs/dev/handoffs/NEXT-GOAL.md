# Next Goal - TF-0013 Residual

Workspace: `C:\Users\27933\Desktop\clawx\ClawX`

## First checks

```powershell
git status --short --branch
Get-Content -TotalCount 35 docs/dev/handoffs/LATEST.md
Get-Content -Raw docs/dev/tf0013-residual-crosscheck-20260930.md
```

## Goal

Updated 2026-09-30: the [COMPASS budget slice](../tf0013-compass-budget-20260930.md) implements shared candidate arbitration for immediate, queued, CLI and native harness execution. The next engineering slice remains TF-0013: trace ContextEngine `assemble().messages` replacement, distinguish existing history from new injected content, and prove that new contributions cannot bypass candidate arbitration or the turn budget. Start with `pnpm harness context --spec harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md`. Use the [four-residual crosscheck](../tf0013-residual-crosscheck-20260930.md) as the historical baseline, not a claim that every residual is closed.

The previous human-input blocker is superseded by AGENTS.md's 2026-09-27 policy. Interaction and verdict steps must be automated and labelled `driven_by: agent` with an actor, never real-human. TF-0009/TF-0007 agent acceptance is recorded in LATEST.md. TF-0010/TF-0028 D7 unfreezing remains an owner decision, separate from this engineering work.

## Hard bounds

- Engineering templates are not acceptance evidence or canary runs.
- Use no real credentials or remote side effects before the charter names the sandbox/disposable repository and allowed actions.
- `liveReady=false`, `productApproved=false`, and `defaultOn=false` remain fixed.
- Keep the frozen 6000/0.1 injection settings and C1 keep-off boundary.
- Apply routine Task Forest updates under the repository auto-close policy using disk evidence and a current proposal base hash.
- Publication, public exposure, product-lock changes and frozen defaults remain owner decisions.
