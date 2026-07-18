# ORCH-002 — Real worker-output handoff

Status: todo

Gap: handoff currently carries expected output schema rather than the actual preceding worker output.

Required development:

- capture bounded, redacted worker output at the handoff boundary;
- bind the artifact to run/task/attempt identity and provenance;
- keep handoff disabled or fail-closed when capture is unavailable.

Acceptance:

- [ ] A1 a downstream worker receives the actual bounded prior output;
- [ ] A2 oversized, secret, and malformed output is rejected or redacted;
- [ ] A3 replay evidence proves no cross-run handoff leakage;
- [ ] A4 committed-tree test and evidence manifest pass.
