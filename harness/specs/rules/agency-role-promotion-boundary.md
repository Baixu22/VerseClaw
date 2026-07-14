---
id: agency-role-promotion-boundary
title: Agency Role Promotion Boundary
type: rule
appliesTo:
  - agency-role-promotion-control-plane
pathPatterns:
  - openclaw_runtime/src/agents/agency-*
  - electron/services/roles-api.ts
  - electron/services/role-promotion-store.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/*Role*Promotion*
---

# Agency Role Promotion Boundary

## Rule

Agency source entries are immutable review inputs. Only a separately
materialized and validated config `RoleContract` may enter the runtime role
registry.

## Requirements

- `canSpawnAgencyDraft()` returns literal `false` for every Agency draft.
- Lifecycle and evidence qualification do not derive runtime permissions.
- Agency prompt, tool, handoff, division, and runbook text does not grant
  runtime authority.
- Every tool hint has an explicit mapped or waived disposition.
- Approval records include source fingerprint, reviewer, decision time,
  evidence references, candidate contract digest, and materialization status.
- Approval writes through the existing `agents.roles` config path.
- Reconciliation and retirement require exact contract digest identity, not
  role name alone.
- Main owns source reads, persistence, config writes, reconciliation, and
  retirement.
- Renderer uses the typed roles Host API facade only.

## Forbidden Patterns

- Agency draft runtime activation
- maturity-driven permission grants
- automatic tool-hint grants
- a second role registry or spawn path
- renderer direct IPC or Gateway transport
- shared memory, self-edit, sleeptime, ToolRule, or executor implementation

## Validation

- `pnpm exec vitest run tests/unit/agency-role-importer.test.ts tests/unit/agency-role-promotion.test.ts tests/unit/roles-api.test.ts`
- `pnpm contract:check`
- `pnpm i18n:lint`
- `pnpm exec playwright test tests/e2e/agency-role-promotion.spec.ts`
