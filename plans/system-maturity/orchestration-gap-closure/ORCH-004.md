# ORCH-004 — Plan-editing Electron E2E closure

Status: in_progress

Gap: `tests/e2e/role-orchestration-plan-editing.spec.ts` timed out waiting for `orchestration-plan-edit-toggle`.

Acceptance:

- [ ] A1 the Plan view renders the edit toggle for a valid plan;
- [ ] A2 saving a lightweight edit writes the expected Task Ledger event;
- [ ] A3 the UI does not expose an unsupported edge editor;
- [ ] A4 the Electron E2E passes on a fresh build with no selector timeout;
- [ ] A5 the delivery record includes test output, acceptance evidence, and commit ancestry.
