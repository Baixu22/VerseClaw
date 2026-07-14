# Agency Role Package Localization Round Constraints

Run R0 through R5 in order. The user has authorized continuation across rounds,
but each round still requires fresh exit evidence before the next begins.

## Global Invariants

- `canSpawnAgencyDraft()` remains literal `false`.
- New canonical promotion records contain `packageId` and no `sourceRoot`.
- Approval, retry, reconciliation, and retirement do not read the external
  Agency repository.
- Package prose, runbooks, tools, lifecycle, and evidence do not grant runtime
  authority.
- Main owns package files and promotion persistence; Renderer uses typed Host
  API only.
- Do not implement Role Memory import in this task.

## R0: Control Pack

Add the design, Harness task/rule, and record baseline evidence. No production
code.

## R1: Package Domain And Store

Use TDD to implement deterministic package identity, per-role package creation,
atomic persistence, integrity verification, idempotent import, changed-content
versioning, and reconstructed legacy packages.

Focused proof:

```powershell
pnpm exec vitest run tests/unit/agency-role-package.test.ts
```

## R2: Typed Contract

Declare package payloads/results and exact facade forwarding before Main or UI
uses them.

Focused proof:

```powershell
pnpm exec vitest run tests/unit/host-api-facade.test.ts
pnpm contract:check
```

## R3: Promotion Integration And Migration

Switch preview/review/approval to local packages, migrate legacy records only
after verified package writes, and prove external deletion no longer blocks
approval or retry.

Focused proof:

```powershell
pnpm exec vitest run tests/unit/agency-role-package.test.ts tests/unit/roles-api.test.ts
```

## R4: Local Library UI

Add external and local views, per-role import, explicit refresh, package state
labels, reconstructed warnings, four-locale coverage, and component tests.

Focused proof:

```powershell
pnpm exec vitest run tests/unit/agency-role-promotion-panel.test.tsx tests/unit/roles-orchestration-panel.test.tsx
pnpm i18n:lint
```

## R5: Acceptance

Add Electron E2E for import, repository-independent approval, refresh
versioning, retry, and retirement. Synchronize docs and run every command in
the Harness task.

