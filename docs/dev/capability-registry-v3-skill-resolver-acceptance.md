# Capability Registry V3-02 Skill Resolver Acceptance

## Scope

This record covers the plan's V3-02 package only: a deterministic, in-memory
`category -> workflow namespace -> candidate` Skill discovery projection over
the V3 metadata shadow catalog.

It does not claim active Skill routing, prompt integration, Tool Search,
executor registration, lease verification, DCS projection, Code Mode,
provider-native loading, UI, or rollout readiness.

## Boundary

The resolver is called explicitly and defaults to disabled. Disabled resolution
returns `{ enabled: false, mode: "disabled" }` before inspecting the catalog.
When enabled, it consumes only caller-owned `CapabilityShadowCatalogSnapshot`
metadata, filters to `kind: "skill"`, and returns a new immutable-by-convention
projection. It does not import or call the Skill loader, `formatSkillsForPrompt`,
Tool Search, Code Mode, DCS, MCP, ArchiveHandle, storage, Gateway, Host API,
Electron, or renderer code.

## Resolution Model

- L0 contains whole structured category entries with aggregate trigger keywords
  and counts. It never truncates an arbitrary description or keyword string to
  fit a budget.
- L0 uses two caller-provided caps: a context-window character share and a
  maximum entry count. Entries that do not fit are omitted as whole entries and
  diagnostics record the cap reached.
- L1 namespaces and L2 candidates retain complete metadata projections. The
  caller may opt into direct projection only when it declares the catalog stable
  and supplies calibrated candidate and character limits.
- Ranking uses normalized query tokens, weighted metadata fields, and explicit
  category/namespace/capability tie-breakers, so input order does not affect the
  result.

## Acceptance Evidence

Acceptance run: 2026-08-14 on branch `codex/v3-capability-registry`.

### Focused Tests

`skill-resolver.test.ts` covers disabled no-op, Skill-only filtering, structured
L0 folding, both caps, direct-projection bypass, error-diagnostic fallback,
input-order stability, and category/namespace/candidate ranking.

### Decision

V3-02 is accepted as a pure shadow resolver. It is not an active Skill loader,
prompt owner, executor, feature default, or production retrieval measurement.
