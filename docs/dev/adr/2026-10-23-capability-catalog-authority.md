# ADR-0026: Single capability catalog authority

- Status: accepted (TF-0501)
- Date: 2026-10-23
- Owner: `codex` (agent-driven)
- Tree: `D:\ClawX-work\component-graduation-20261021`
- Scope: Skills / MCP / Tool Search / Capability Registry V3
- Release boundary: this ADR does **not** authorize public release, GA, liveReady or
  productApproved, and does not flip any product default.

## Context

The component graduation worktree has four capability-discovery projections in
the production narrative:

1. native runtime tool schema;
2. Tool Search's effective catalog;
3. the `tool_registry` Block summary;
4. the Capability Registry V3 descriptor shadow catalog.

The static caller audit in `tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/`
shows that V3 has no default production caller. Its only production-adjacent
caller is the explicit Stage 2 golden runner, which derives a DCS catalog epoch
from a V3 shadow-catalog snapshot. Tool Search remains the owner of search,
schema expansion and target execution; the Skill loader remains the Skill body
owner; MCP remains the external protocol owner.

## Decision

### 1. Canonical discovery identity

`v3-capability-catalog` is the canonical **identity and metadata projection**
for model-visible capabilities. A capability id is the pair:

```text
<kind>:<owner>:<local-name>
```

The descriptor may contain identity, category, workflow namespace, title,
description, trigger keywords, revision, manifest hash, schema hash, source
provenance, dependencies and permissions. It must **not** contain an executor,
a body, or a second copy of source payloads.

`skills-mcp-source-registry` publishes the source manifests; it does not create
a second discovery identity. `tool-search-schema-expander` owns search, schema
expansion and execution; it consumes the canonical descriptor but does not
become a second catalog authority.

### 2. V3 disposition: internal adapter, not a second product catalog

V3 remains available behind an explicit caller/flag because it has real unique
adapter responsibilities: canonical schema hashing, permission annotations,
trusted leases, result pointers and bounded rollout evidence. It is **not**
retired, but it is also **not** promoted:

- authority `defaultMode`: `internal`
- component disposition: `internal`
- authority role: metadata/discovery projection only
- default production caller: none
- user-visible entry: none
- The existing Models page and `ProvidersSettings` remain owned by
  `renderer-ui-surface` as provider/model configuration; they are not a V3
  registry surface.
- The V3 catalog remains an internal metadata owner, not a second product
  marketplace. TF-0502 may build the single model capability catalog on top of
  this decision, but it must not reintroduce a separate V3 UI, route or flag.
- model-visible default catalog: the existing coding catalog / Tool Search
- V3 cannot execute, authorize or own context candidates

If a later node proves V3 is redundant with Tool Search and removes all orphan
callers, it may be retired. That decision is not made here.

### 3. One digest/schema/permission source

Tool Search, native schema and V3 use the same canonical schema value and the
same canonical metadata hashing function. The schema hash is
`sha256(canonicalJSON(schema))`; the permission annotation is a sorted,
deduplicated string list; the catalog digest is the hash of the canonical
descriptor sequence. The `tool_registry` Block is a **summary projection** of the
same effective tool list, not a separate catalog with its own schema truth.

### 4. Model profile

The ModelCapabilityProfile uses the same catalog digest. Its static capability
positioning may change over time, but it must not invent a second capability
identity or a second schema/permission source.

## Consequences

- One capability identity per tool, even when the tool is reachable through
  native schema, Tool Search, `tool_registry` and V3.
- V3 stays opt-in and internal; no user-facing second marketplace or registry.
- A future V3 retirement requires removing orphan callers first; a future V3
  graduation requires live evidence and the normal graduation gate.
- The catalog comparison is static/contract evidence. The A/B protocol is
  frozen, but this ADR does not claim provider token, first-call-success or
  latency benefit without live samples.

## Evidence

- `tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/raw-evidence.json`
- `tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/ab-protocol.json`
- `tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/ab-report.json`
- `openclaw_runtime/src/capabilities/v3/capability-descriptor.ts`
- `openclaw_runtime/src/agents/tool-search-capability-v3.ts`
- `openclaw_runtime/src/capabilities/v3/shadow-catalog.ts`
- `shared/component-authority-manifest.ts`
- `shared/dcs/component-disposition-catalog.ts`
