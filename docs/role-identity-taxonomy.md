# Role Identity Taxonomy

> Canonical naming for the three concepts in the codebase that all share the word "role". This document is the single source of truth for Area 1 of the role-driven architecture refinement.

## The Three Concepts

| Concept | Canonical English | Canonical Chinese | Type (unchanged) | Lifecycle | Origin |
|---|---|---|---|---|---|
| Agent | **Assistant** | 助手 | `AgentSummary` | user-created, persistent | `AgentSummary` |
| AgentRoleProfile | **Persona** | 人设 | `AgentRoleProfile` | 1:1 attribute of an Assistant | compiled to/from SOUL.md |
| RoleContract | **Role Contract** | 角色契约 | `RoleContract` | library item, M:N with Assistants | built-in or config-defined |

**Do not rename the types.** The canonical names are documentation-level labels. `AgentSummary` stays `AgentSummary` in code; "Assistant" is what we call it in docs, UI, and discussions. Renaming would churn 100+ call sites for zero behavior change.

## Concept Map

```
Assistant (AgentSummary)          Role Contract (RoleContract)
  │  persistent identity            │  reusable library item
  │  owns: workspace, model,        │  authored: built-in or cfg.agents.roles[]
  │         channels, sessions      │  spawned: hard-scoped subagent
  │                                 │
  ├── 1:1 ── Persona                │  M:N ── used in orchestrations
  │         (AgentRoleProfile)      │         (planner, implementer, ...)
  │         compiled to SOUL.md     │
  │         mirrored to             │
  │         role-profile.json       │
  │                                 │
  └── channel bindings              │  NO channel field on contracts
      (AgentSummary.channelTypes)   │  (capability ≠ delivery identity)
```

## Why Three Concepts

The codebase uses "role" for all three, which created ambiguity:

- **"Switch role"** on the chat page means switch **Assistant** (Area 2 separates model switching from Assistant switching).
- **"Role memory"** binds cards to a **Role Contract** name (Area 4 federates this with Runtime Memory).
- **"Role profile editor"** edits a **Persona** (the 1:1 attribute of an Assistant).
- **"Knowledge steward role"** is a **Role Contract** used by the KB (Area 5).

Every new feature had to re-decide which "role" it meant. This taxonomy fixes the vocabulary so Areas 2-5 can reference "Assistant / Persona / Role Contract" without re-defining them.

## Persona Round-Trip

SOUL.md is free-form Chinese Markdown — the model-facing prompt artifact. It is hand-editable. The structured `AgentRoleProfile` is mirrored to `role-profile.json` (the sidecar) with a `soulHash` (sha256 of the SOUL.md it compiled from).

- **Read**: if the sidecar exists and `soulHash` matches the current SOUL.md, the sidecar is authoritative (lossless). If the user hand-edited SOUL.md, the hash mismatches and the system falls back to heuristic parse — **user edits always win**.
- **Write**: `writeAgentRoleProfile` writes SOUL.md first, then the sidecar (best-effort; sidecar write failure is non-fatal).
- **Runtime**: never reads the sidecar. SOUL.md remains the only artifact the runtime reads.

This makes `customStyle` and other fields that were previously lost in the heuristic parse-back fully recoverable, without forcing structure into SOUL.md itself.

## Role Contract Origin

Role Contracts come from two sources, surfaced via `roles.list` and the RoleCard badge:

- **`built-in`**: ships with the runtime (`BUILT_IN_ROLE_CONTRACTS` in `role-contract.ts`). The 8 defaults: planner, architect, implementer, tester, reviewer, security-reviewer, docs-writer, skeptic.
- **`config`**: authored by the user in `cfg.agents.roles[]`. May override a built-in of the same name (later-wins resolution). A config override of a built-in reports `origin: 'config'` — that is exactly the signal a maintainer needs when debugging surprising role behavior.

The registry already computed this distinction (`configRoleNames`); Area 1 only surfaces it.

## Role Instance

A **Role Instance** is a concrete realization of a Role Contract at orchestration time. It is not a new runtime object — it is a correlated read model (`RoleInstanceDescriptor`) assembled at spawn time from data that already exists:

- `roleName` — RoleContract.name
- `roleOrigin` — built-in or config
- `contractVersion` — RoleContract.version at spawn time
- `roleInstanceId` — existing ledger id (`${runId}:${taskId}:${roleName}:attempt-N`)
- `agentId` — hosting Assistant
- `childSessionKey` — `agent:{agentId}:subagent:{uuid}`
- `spawnedAt` — ISO timestamp

Embedded in the `subagent-lifecycle` broadcast payload so the renderer can show "which contract, which version, which attempt" from one event without joining three sources.

## Channel Binding Decision

**Channel binding stays at the Assistant level** (`AgentSummary.channelTypes`, bindings in `config.bindings[]`).

Role Contracts get **no** channel field. A contract describes *capability*, and channels are *delivery identity*. Mixing them would let an orchestration-time library item claim delivery routes, crossing the Agent-owns-channels boundary.

A user wanting "the docs-writer role answering on Discord" models that as:
- An **Assistant** bound to Discord
- Whose orchestrations use the **docs-writer** contract

## Type Definitions

- Shared vocabulary: [`shared/types/role-identity.ts`](../shared/types/role-identity.ts)
- Assistant + Persona + Role Contract: [`shared/types/agent.ts`](../shared/types/agent.ts)
- Runtime Role Contract (authoritative): [`openclaw_runtime/src/agents/role-contract.ts`](../openclaw_runtime/src/agents/role-contract.ts)
- Registry + origin helper: [`openclaw_runtime/src/agents/role-registry.ts`](../openclaw_runtime/src/agents/role-registry.ts)
