# ORCH-001 — Ordinary orchestration quality authority

Status: todo

Gap: ordinary `team_orchestrate` quality remains shadow-only and does not provide a verified quality-to-routing loop.

Required development:

- define the scorecard authority and explicit `shadow`/`active` boundary;
- reject active routing without scorecard-backed evidence;
- preserve Task Loop repair semantics as a separate path.

Required tests:

- unit tests for scorecard authority and routing denial;
- integration test for ordinary orchestration diagnostics;
- committed-tree `pnpm run comms:replay` and `pnpm run comms:compare`.

Acceptance:

- [ ] A1 active routing is impossible without verified quality evidence;
- [ ] A2 shadow quality is visible but cannot change routing;
- [ ] A3 ordinary failures do not claim Task Loop repair semantics;
- [ ] A4 evidence manifest records commands, exit codes, and commit.
