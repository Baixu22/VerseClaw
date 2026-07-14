---
id: agency-role-memory-import-boundary
title: Agency Role Memory Import Boundary
type: rule
appliesTo:
  - electron/services/agency-role-memory-import.ts
  - electron/services/roles-api.ts
  - src/components/agents/AgencyRolePromotionPanel.tsx
  - shared/host-api/contract.ts
---

# Agency Role Memory Import Boundary

- Parse package Markdown with a Markdown AST, never heading string splitting.
- Generate only proposals for an exact active and complete materialized role.
- Exclude identity, personality, experience, tools, commands, code, mission,
  templates, and unrecognized sections.
- Use confidence `0.6` and the existing gatekeeper APIs.
- Never create or activate a memory card directly.
- RoleContract remains the only runtime permission authority.

