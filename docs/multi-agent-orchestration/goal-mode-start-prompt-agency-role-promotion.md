# Agency Role Promotion Control Plane Goal-Mode Start Prompt

Use the following prompt to start implementation. It is intentionally strict:
the worker must read the current system and open-source references before
changing code.

```text
Goal:
Implement the Agency Role Promotion Control Plane only, in ordered rounds R0-R5.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX-role-promotion

Branch:
codex/agency-role-promotion-control-plane

Primary outcome:
An operator can select an Agency Agents repository, review an immutable draft,
explicitly map or waive tool hints, attach evidence, persist a review, approve
a separate config-backed RoleContract, retry interrupted materialization, and
retire the exact materialized role while preserving audit history.

The Agency source draft itself must remain permanently non-runnable.

Before any implementation, read these binding files in full:
1. AGENTS.md
2. openclaw_runtime/AGENTS.md
3. docs/superpowers/specs/2026-07-12-agency-role-promotion-control-plane-design.md
4. docs/multi-agent-orchestration/phase-constraints/agency-role-promotion-control-plane.md
5. docs/superpowers/plans/2026-07-12-agency-role-promotion-control-plane.md
6. harness/specs/tasks/agency-role-promotion-control-plane.md
7. harness/specs/rules/agency-role-promotion-boundary.md
8. harness/specs/scenarios/gateway-backend-communication.md
9. harness/specs/rules/backend-communication-boundary.md
10. harness/specs/rules/contract-first-boundary.md
11. harness/specs/rules/host-api-fallback-policy.md
12. harness/specs/rules/i18n-locale-coverage.md
13. harness/specs/rules/docs-sync.md
14. docs/role-first-design.md
15. docs/multi-agent-orchestration-development-plan.md

Read these current ClawX implementation anchors before making design claims:
16. openclaw_runtime/src/agents/role-contract.ts
17. openclaw_runtime/src/agents/role-registry.ts
18. openclaw_runtime/src/agents/role-spawn.ts
19. openclaw_runtime/src/agents/agency-draft-catalog.ts
20. openclaw_runtime/src/agents/agency-role-importer.ts
21. electron/services/roles-api.ts
22. electron/services/orchestration-presets-api.ts
23. electron/utils/config-mutex.ts
24. shared/host-api/contract.ts
25. src/lib/host-api.ts
26. src/components/agents/RolesOrchestrationPanel.tsx
27. tests/unit/agency-role-importer.test.ts
28. tests/unit/roles-api.test.ts
29. tests/unit/host-api-facade.test.ts
30. tests/e2e/role-management.spec.ts

Inspect these Agency Agents references directly:
31. C:\Users\27933\Desktop\verseshell\agency-agents-main\divisions.json
32. C:\Users\27933\Desktop\verseshell\agency-agents-main\tools.json
33. C:\Users\27933\Desktop\verseshell\agency-agents-main\strategy\runbooks.json
34. C:\Users\27933\Desktop\verseshell\agency-agents-main\engineering\engineering-code-reviewer.md
35. C:\Users\27933\Desktop\verseshell\agency-agents-main\testing\testing-reality-checker.md
36. C:\Users\27933\Desktop\verseshell\agency-agents-main\security\security-penetration-tester.md

Inspect these Letta references directly:
37. C:\Users\27933\Desktop\verseshell\letta-main\letta\schemas\agent.py
38. C:\Users\27933\Desktop\verseshell\letta-main\letta\schemas\tool_rule.py
39. C:\Users\27933\Desktop\verseshell\letta-main\letta\helpers\tool_rule_solver.py
40. C:\Users\27933\Desktop\verseshell\letta-main\letta\schemas\block.py
41. C:\Users\27933\Desktop\verseshell\letta-main\letta\services\block_manager.py
42. C:\Users\27933\Desktop\verseshell\letta-main\letta\groups\sleeptime_multi_agent_v4.py
43. C:\Users\27933\Desktop\verseshell\letta-main\letta\services\tool_executor\tool_execution_manager.py

Original proposal for comparison:
44. C:\Users\27933\.codex\attachments\c80f0e36-1692-45db-a755-ae7730931d95\pasted-text.txt

Reference discipline:
- Do not merely list these paths.
- For the active round, record which files were actually inspected.
- Record at least one concrete contract or design conclusion learned from each
  relevant reference.
- Agency Agents is source catalog/runbook material, not runtime authority.
- Letta is a design comparison, not an architecture to transplant.
- When the original proposal conflicts with the binding design spec, the
  binding design spec wins.
- If any required reference for the active round is missing, stop before
  implementation and report it.

Hard invariants:
- RoleContract is the only runtime role authority.
- canSpawnAgencyDraft() remains a literal false function.
- Promotion creates a separate config role; it never mutates a source draft
  into a runnable object.
- Lifecycle is draft -> reviewed -> active -> retired.
- Evidence qualification is unverified -> scenario-verified ->
  release-qualified.
- Lifecycle and evidence qualification never grant tools, filesystem/network
  access, commands, model access, memory access, background execution, or
  handoff authority.
- Every tool hint is explicitly mapped or waived.
- Suggested tools are advisory and never auto-selected.
- Approval enters runtime only through openclaw.json agents.roles and the
  existing buildRoleRegistry() path.
- Main owns source reads, persistence, config writes, reconciliation, and
  retirement.
- Renderer uses src/lib/host-api.ts only.
- Reconciliation and retirement require exact contract digest identity, not
  role name alone.

Forbidden scope:
- Agency Markdown runtime activation.
- Maturity fields or maturity-driven permission release.
- Automatic tool grants.
- Shared memory block implementation.
- Role memory self-edit or direct memory writes.
- Sleeptime/background Role execution.
- ToolRule solver or tool sequencing.
- New tool executor factory.
- Provider fallback/error refactor.
- Automatic runbook execution or scoring.
- Bulk promotion of the Agency corpus.
- Direct Renderer IPC, filesystem, Gateway HTTP, or Gateway WebSocket.
- Unrelated refactors or formatting churn.

Round order:
R0 Preflight and reference ledger.
R1 Immutable source identity and pure promotion domain.
R2 Typed Host API contract and facade.
R3 Main persistence, materialization, recovery, and retirement.
R4 Review UI and en/zh/ja/ru locale coverage.
R5 Electron E2E, docs synchronization, and full acceptance.

Execute only one round per development run unless the user explicitly approves
continuation after seeing the current round report.

At the start of each round:
1. Read the round section in:
   docs/multi-agent-orchestration/phase-constraints/agency-role-promotion-control-plane.md
2. Read the matching tasks in:
   docs/superpowers/plans/2026-07-12-agency-role-promotion-control-plane.md
3. Inspect all required references for that round.
4. Run:
   pnpm harness context --spec harness/specs/tasks/agency-role-promotion-control-plane.md
   pnpm harness validate --spec harness/specs/tasks/agency-role-promotion-control-plane.md --no-diff
   git status --short
5. Confirm the previous round exit criteria are green.

TDD discipline for every production round:
1. Write the focused failing test.
2. Run it and capture the expected RED result.
3. Implement the smallest complete behavior.
4. Rerun the focused test to GREEN.
5. Run every exit command declared for that round.
6. Do not claim completion without fresh command output.

Do not modify or revert unrelated user changes. Do not stage unrelated files.
Do not use git reset --hard or git checkout --.

Required final report for every round:
Active round:
Goal:
Files changed and responsibility:
References inspected:
Constraint learned from each reference:
RED evidence:
GREEN evidence:
Commands and exact results:
Acceptance checklist:
Forbidden-scope audit:
Unrelated dirty files/failures:
Ready for next round: yes/no

Project completion acceptance:
- Agency drafts remain permanently non-runnable.
- Source identities use relative paths and stable SHA-256 fingerprints.
- Every tool hint is mapped or waived.
- Evidence qualification does not alter runtime authority.
- Review persists without creating an active role.
- Approval creates a separate validated config RoleContract.
- Retry is idempotent and interrupted writes reconcile by exact digest.
- Retirement preserves audit and cannot delete a same-name replacement.
- Renderer uses typed Host API only.
- All display text has en/zh/ja/ru coverage.
- Unit, contract, i18n, typecheck, lint, comms, build, Electron E2E,
  Harness validation, and git diff checks pass with fresh evidence.
- Final report includes the full reference ledger and explicit non-goal audit.

Begin with R0 only. Do not edit production code in R0.
```
