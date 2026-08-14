---
id: capability-registry-v3
title: Capability Registry V3
type: capability-registry-boundary
ownedPaths:
  - docs/dev/capability-registry-v3-development-plan.md
  - docs/dev/capability-registry-v3-foundation-acceptance.md
  - docs/dev/capability-registry-v3-skill-resolver-acceptance.md
  - docs/dev/capability-registry-v3-trusted-catalog-acceptance.md
  - docs/dev/capability-registry-v3-unified-resolver-acceptance.md
  - docs/dev/capability-registry-v3-dcs-result-pointer-acceptance.md
  - docs/dev/capability-registry-v3-code-mode-acceptance.md
  - docs/dev/capability-registry-v3-provider-native-acceptance.md
  - docs/dev/capability-registry-v3-controlled-rollout-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-foundation.md
  - harness/specs/tasks/capability-registry-v3-skill-resolver.md
  - harness/specs/tasks/capability-registry-v3-trusted-catalog.md
  - harness/specs/tasks/capability-registry-v3-unified-resolver.md
  - harness/specs/tasks/capability-registry-v3-dcs-result-pointer.md
  - harness/specs/tasks/capability-registry-v3-code-mode.md
  - harness/specs/tasks/capability-registry-v3-provider-native.md
  - harness/specs/tasks/capability-registry-v3-controlled-rollout.md
  - openclaw_runtime/src/capabilities/v3/**
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
requiredRules:
  - capability-registry-v3-boundary
---

Capability Registry V3 is a progressive-disclosure metadata layer over existing
Skill, Tool, and Context owners. It provides discovery identity and diagnostics;
it does not become an executor, protocol, persistence store, or prompt owner.

## Ownership

| Surface | Existing owner | V3 role |
|---|---|---|
| Tool execution | OpenClaw Runtime | Metadata projection only until a later lease package is accepted. |
| Skill content loading | Skill loader | Metadata projection only. |
| Context selection and storage | Context Engine and its owners | Metadata projection only. |
| MCP protocol | MCP SDK | No V3 protocol replacement. |
| Large-result recovery | Existing archive owner | No V3 archive store. |

## Stage Order

Only one V3 package may be active at a time:

```text
V3-00/V3-01 foundation -> V3-02 catalog resolver -> V3-03 trusted catalog/lease
-> V3-04 resolver fallback -> V3-05 DCS projection/pointer -> V3-06 Code Mode
-> V3-07 provider-native adapter -> V3-08 evaluation and controlled rollout
```

The foundation package is metadata-only and has no active runtime integration.
Any later package that changes a prompt, tool execution, DCS, MCP, provider
transport, storage, Host API, or UI must add a narrower task spec and the
corresponding boundary evidence before implementation.

V3-02 remains an in-memory, caller-invoked Skill discovery projection. Its
default-disabled resolver must not be wired into the Skill loader or prompt
formatter. A later package owns any active routing decision.

V3-03 adds an in-memory trusted Tool binding and lease verifier, but it remains
unwired. Only cold-start/reload construction may register an executor; model,
Skill, DCS, Host API, and renderer data cannot create a trusted binding.

V3-04 adds an explicit opt-in unified resolver and a Tool Search compatibility
adapter. Tool Search remains the owner of search, schema description, hooks,
approval, and execution; V3 only maps descriptors and verifies a trusted lease.

V3-05 adds a pure metadata-only projection for DCS consumers plus a bounded
Result Pointer facade over the existing Context Family archive owner. It does
not write BlockStore, create a new Block type, replace `tool_registry`, or own
archive files.

V3-06 uses the existing Tool Search Code Mode sandbox/protocol with an opt-in
V3 bridge. The bridge issues/revokes trusted leases for Tool calls and returns
Result Pointers; the existing Tool Search path retains sandbox, timeout, abort,
approval, schema, hook, and target-execution ownership.

V3-07 defines a caller-injected provider-native deferred adapter. It requires
an exact provider/model/workflow allowlist match plus an affirmative capability
probe, and may fall back to the accepted proxy path only when provider evidence
proves that no native side effect started. It does not own provider transport.

V3-08 adds a caller-owned, default-disabled rollout and evidence controller.
Shadow mode never authorizes execution; opt-in/canary require exact target
allowlisting; bounded receipts contain metrics but no raw result. Reports never
change product locks or automatically graduate V3.
