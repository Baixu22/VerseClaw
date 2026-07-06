// Role identity vocabulary for the role-driven architecture (Area 1).
//
// Canonical taxonomy (see docs/role-identity-taxonomy.md):
//   - Assistant  = AgentSummary        (persistent identity, user-created)
//   - Persona    = AgentRoleProfile    (1:1 attribute of an Assistant, compiled to SOUL.md)
//   - Role Contract = RoleContract     (library item, M:N with Assistants)
//
// These types are pure vocabulary — no runtime state, no behavior. They exist so
// every surface (UI, gateway, runtime, docs) can name which "role" concept it
// means without re-defining it. Areas 2-5 import from here.

/**
 * Discriminator for the three "role" concepts in the codebase.
 * Used in JSDoc, debug surfaces, and future type guards — not persisted.
 */
export type RoleIdentityKind = 'assistant' | 'persona' | 'contract';

/**
 * Origin of a RoleContract within the registry.
 *
 * - `built-in`: ships with the runtime (BUILT_IN_ROLE_CONTRACTS).
 * - `config`:   authored by the user in cfg.agents.roles[]; may override a
 *               built-in of the same name (later-wins resolution).
 *
 * The registry already computes this distinction (configRoleNames); this type
 * surfaces it through `roles.list` and the RoleCard UI so a maintainer can see
 * at a glance whether a role is shipped or user-defined.
 */
export type RoleOrigin = 'built-in' | 'config';

/**
 * Correlated read model for a concrete realization of a RoleContract at
 * orchestration time. Assembled at spawn time from data that already exists —
 * no new store, no new lifecycle.
 *
 * Fields are gathered from three sources that today are only correlated by
 * convention:
 *   - roleInstanceId  (orchestration ledger, orchestration-protocol.ts)
 *   - subagentRole    (session patch, subagent-spawn.ts)
 *   - childSessionKey (session key, subagent-spawn.ts)
 *
 * Assembly is best-effort: a missing field never blocks a spawn. Embedded in
 * the existing `subagent-lifecycle` broadcast payload and observability trace
 * spans so the renderer and traces can show "which contract, which version,
 * which attempt" without joining three sources.
 */
export type RoleInstanceDescriptor = {
  /** RoleContract.name at spawn time. */
  roleName: string;
  /** Whether the contract came from BUILT_IN_ROLE_CONTRACTS or cfg.agents.roles. */
  roleOrigin: RoleOrigin;
  /** RoleContract.version at spawn time, if declared. */
  contractVersion?: string;
  /** Existing ledger id (orchestration-protocol.ts: `${runId}:${taskId}:${roleName}:attempt-N`). */
  roleInstanceId: string;
  /** Hosting Assistant (AgentSummary.id). */
  agentId: string;
  /** Child session key: `agent:{agentId}:subagent:{uuid}`. */
  childSessionKey: string;
  /** ISO timestamp of the spawn. */
  spawnedAt: string;
};
