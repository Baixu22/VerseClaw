# E2 long-session resource reclamation evidence

Source candidate: 3100f8a6ac6393741f6d14ff2091c14d6d9748b2.

- resource-owner-inventory.json: owner schema, action contracts and a live runtime inventory sample.
- reclamation-cycle-results.json: 50 real runtime cycles and 50 terminal archive/delete cycles with parsed residue counts.
- real-owner-reclamation-receipt.json: actual built Electron → Host → Gateway receipt for generation-bound terminal, stop and archive behavior.
- resource-recovery-required.json: failed/unknown owner fixtures, each requiring recovery with a stable retry identity.
- verification-receipt.json: exact commands, exit codes, output digests and acceptance mapping.

All actions are agent-driven (driven_by: agent, actor: codex-long-session-e2). No real-human evidence is claimed.
