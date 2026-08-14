# Capability Registry V3-03 Trusted Catalog Acceptance

## Scope

This record covers V3-03 only: an in-memory trusted Tool catalog, controlled
cold-start/reload registration, opaque session leases, and fail-closed
verification. It remains disconnected from the current OpenClaw execution
paths.

## Security Boundary

- Only validated `kind: "tool"` descriptors with a schema hash and a function
  supplied by a trusted runtime caller can enter a rebuild.
- No incremental registration method exists after construction. Reload replaces
  the complete binding set and rotates the catalog epoch and every executor
  registration id.
- Public lease handles contain only `issuedId`. The private record binds all
  trusted facts and is checked immediately before explicit invocation.
- Model text, Skill content, DCS, MCP payloads, Host API, renderer input, and
  persistent stores are not registration sources.

## Decision

Acceptance evidence is recorded after the focused tests and static gates pass.
This package is not an active executor cutover or feature-default decision.
