---
id: workspace-harness-single-source
title: Workspace Harness Single Source
type: ai-coding-rule
appliesTo:
  - workspace-harness-bootstrap
---

ClawX-managed workspaces must use `.clawx/harness/` as the workspace-local project harness and Task Ledger bridge. Do not add a parallel `.trellis/` source of truth.

Workspace harness seeding must be conservative:

- Seed from ClawX-owned templates under `resources/workspace-harness/`.
- Write missing files only; never overwrite user-edited harness docs.
- Keep `AGENTS.md` as the lightweight entry point and route durable project knowledge to `.clawx/harness/specs/**`.
- Treat ClawX Task Ledger as authoritative for long-running task state.
- Treat ClawGraph as authoritative for long-task execution state.
- Treat Context Pack docs as recipes or explanations only; runtime Context Packs are bounded injections and not durable truth.
- Keep `.clawx/harness/workspace/` files as bridge docs, bootstrap notes, mirrors, or exports, not a second task database.
- Keep private journals under `.clawx/harness/workspace/` ignored by default.
