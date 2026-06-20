# Harness Specs

Specs are the durable project knowledge base for agents working in this workspace. They complement ClawX Task Ledger; they do not replace it.

Use these directories by intent:

- `rules/` for mandatory constraints.
- `scenarios/` for workflows that cross files, layers, or user-facing surfaces.
- `tasks/` for concrete implementation contracts.
- `guides/` for softer process guidance.
- `layers/` for path-based subsystem conventions.

Prefer small, named specs over one large instruction file. When a private note becomes reusable, rewrite it as a rule, guide, layer, or scenario instead of committing raw journal text.

Task alignment flow:

1. Record durable task state in ClawX Task Ledger when it is available.
2. Create a task spec in `tasks/` when the work needs an implementation contract.
3. Add scenario, layer, rule, and guide links so future agents can load focused context.
4. Use `../workspace/*.md` as bridge docs, review aids, or exports; do not treat them as more authoritative than Task Ledger.
