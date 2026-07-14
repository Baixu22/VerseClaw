---
id: agency-role-package-boundary
title: Agency Role Package Boundary
type: rule
appliesTo:
  - agency-role-package-localization
pathPatterns:
  - openclaw_runtime/src/agents/agency-*
  - electron/services/agency-role-package-store.ts
  - electron/services/role-promotion-store.ts
  - electron/services/roles-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/AgencyRolePromotionPanel.tsx
---

# Agency Role Package Boundary

## Requirements

- Imported roles are immutable content-addressed artifacts under app userData.
- Package identity excludes absolute source paths and import timestamps.
- Package reads verify manifest identity and every declared file hash.
- New promotion records reference `packageId` and do not persist `sourceRoot`.
- Approval and retry use the local package, not the external repository.
- Refresh creates a new package and never mutates an existing review or role.
- Legacy records are rewritten only after reconstructed package verification.
- Agency drafts and packages remain permanently non-runnable.
- Only the existing config-backed `RoleContract` path grants runtime authority.

## Forbidden Patterns

- symlinked or live external source authority
- Agency Markdown runtime activation
- package-derived tool or permission grants
- automatic package deletion
- bulk Agency import
- Role Memory import
- renderer filesystem or raw IPC access

