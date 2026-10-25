# E2 long-session resource reclamation evidence

Source candidate: 7c8348b579f0278b09595c8929a83e09ab0da232.

- resource-owner-inventory.json: the five existing owners, the six action contracts (ui-unload / run-cancel / archive / delete / workspace-switch / quit) and the boundary matrix.
- reclamation-cycle-results.json: 50 create/archive/delete cycles; managed residue is zero and keep_on_leave terminals are counted separately.
- resource-recovery-required.json: recovery_required fixtures for a failing browser close, a still-reachable managed port and an unresolvable worktree owner.
- verification-receipt.json: acceptance mapping, gate receipt, counts and limits.

All actions are agent-driven (driven_by: agent, actor: codex-long-session-e2). No real-human verdict or data is claimed.
