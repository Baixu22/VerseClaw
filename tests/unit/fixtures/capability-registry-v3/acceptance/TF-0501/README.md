# TF-0501 capability catalog authority decision

- Task: `TF-0501` — one capability catalog authority
- Actor: `codex`
- Evidence driver: `agent`
- VerseGit scope: excluded
- Release boundary: public release, GA, liveReady and productApproved are not claimed

## Decision

Adopt a single **discovery identity** for model-visible capabilities:

1. `v3-capability-catalog` owns the canonical capability descriptor identity,
   schema hash and permission annotation projection.
2. `skills-mcp-source-registry` remains the source-manifest owner for Skill and
   MCP metadata. It does not create a second discovery identity.
3. `tool-search-schema-expander` remains the Tool Search, schema-expansion and
   execution owner. V3 remains an internal, default-disabled compatibility
   adapter; it never becomes a second executor or a second product catalog.
4. The native runtime tool schema, Tool Search catalog and the V3 shadow catalog
   must derive `schemaHash` from the same canonical schema value. The
   `tool_registry` Block is a summary projection of the same effective tool
   list, not a second catalog.

This is a **keep-as-internal-adapter** decision, not a default graduation:
`component.v3-capability-catalog` is `internal` in both the authority manifest
and the component disposition catalog, with no user-visible entry, Settings
section, panel or route. No product lock or default value is flipped in this node.

## Why V3 is not retired here

The code already contains capability identity, canonical schema hashing,
permission annotations, lease verification, result pointers and bounded rollout
evidence behind explicit opt-in flags. Those are real unique adapter
responsibilities. They are not, however, a second model-visible catalog or a
second executor. Retiring V3 would delete the only metadata adapter that can
bind a Tool Search capability to a trusted lease. The decision therefore keeps
the adapter and removes the duplicate catalog/authority meaning.

## Why this is not a release claim

The V3 shadow catalog still has no default production caller. The only
production-adjacent caller is an explicit golden runner that derives a catalog
epoch for DCS. No product UI, config flag or default turn path gains V3. The
model-visible discovery catalog stays the existing coding catalog; V3 only
supplies an internal compatibility projection. TF-0502 may implement the single
capability catalog, but must not reintroduce a second V3 registry UI/route/flag.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| One capability catalog authority; every tool source traces to Skills / MCP / Tool Search | `raw-evidence.json#catalogAuthority`; source-anchor audit |
| V3 has no unique value -> retired; otherwise internal adapter only | `raw-evidence.json#v3Disposition`; ADR |
| Tool digest, schema hash and permission annotation have one source | `raw-evidence.json#digestAndSchema`; canonical hashing audit |
| Model profile uses the same catalog digest | `raw-evidence.json#modelProfileDigest`; `ModelCapabilityProfile` audit |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/run-verification.ps1'
```

## Unverified boundary

- The catalog comparison is static/source-level. It does not claim provider
  token, first-call-success or latency benefit for V3.
- The V3 A/B protocol is declared and frozen, but no live eligible sample was
  collected in this node. The report therefore returns `insufficient-evidence`
  rather than a pass.
- No public release, GA, liveReady, productApproved or real-human evidence is
  claimed.
