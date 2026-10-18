---
id: identity-scope-boundary
title: Identity and Scope Boundary
type: ai-coding-rule
severity: error
---

New identity boundaries import WorkspaceId, ProjectId, SessionKey, RunId and
TaskId from `shared/types/identity-scope.ts` (also exported by the existing
product-semantics module). Do not recreate these brands in another layer.

- Workspace is an execution and permission context; Project is a long-lived
  user work container. Their transitional value mapping is not type equality.
- Use the shared compatibility functions for that mapping. Only apply the
  workspace-id compatibility mode to a ProjectId originating from that mapping;
  arbitrary project IDs require an owner-supplied association.
- Never fall back from workspaceKey/workspaceId to sessionKey/sessionId. A
  missing workspace stays missing and normalization rejects it.
- TaskId names a user-visible Task Ledger fact. Cross-boundary references use
  taskNodeId, runtimeTaskId, browserTaskId, cronRunId or installTaskId. A bare
  taskId is not an owner discriminator; the new adapter rejects it.
- Persist or transport a new run reference as ScopedRunId, carrying its scope.
  A standalone RunId is only an opaque token, not a globally addressable record.
- SessionKey identifies a conversation, not run lineage. Parent/retry/attempt
  relations require explicit execution-owner evidence, never string parsing.
- Brands and normalization do not grant authorization or validate workspace
  existence. Those decisions stay with the existing Main/runtime owner.

Enforcement for adopters: `tests/unit/identity-scope.test.ts` contains negative
type assignments executed by the full test-project typecheck and runtime
rejection cases executed by Vitest. This first slice does not claim a whole-repo
legacy-field migration. Old endpoint ownership is recorded in the product
semantics vocabulary; no new boundary may copy an old ambiguous field shape.

Keep existing ID bytes, persisted schemas, transports and frozen defaults. Full
OS sandboxing, a Project store and downstream execution protocols are out of scope.
