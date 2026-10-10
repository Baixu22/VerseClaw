// Role registry: merges built-in role contracts with config-defined roles so
// role-first orchestration is driven by configuration, not hardcoded constants.
//
// Resolution order (later wins on name collision):
//   1. BUILT_IN_ROLE_CONTRACTS (role-contract.ts)
//   2. cfg.agents.roles[]  (raw config entries, normalized + validated here)
//
// Config entries reuse the same shape as a YAML role contract (snake_case or
// camelCase keys are both accepted by normalizeRoleContract). Invalid entries
// are skipped and reported in `issues` rather than throwing, so one malformed
// role never blocks the whole registry from loading.
import {
  BUILT_IN_ROLE_CONTRACTS,
  normalizeRoleContract,
  validateRoleContract,
  type RoleContract,
  type RoleContractValidationIssue,
} from "./role-contract.js";

/** Minimal config carrier so the registry is testable without a full OpenClawConfig. */
export type RoleRegistryConfigCarrier = {
  agents?: {
    roles?: unknown;
    teams?: unknown;
  };
};

/**
 * Origin of a RoleContract. Mirrors `shared/types/role-identity.ts` `RoleOrigin`
 * (kept local so the runtime package stays free of cross-package imports).
 *
 * - `built-in`: ships with BUILT_IN_ROLE_CONTRACTS.
 * - `config`:   authored in cfg.agents.roles[]; may override a built-in name.
 */
export type RoleOrigin = "built-in" | "config";

/**
 * Correlated read model for a concrete realization of a RoleContract at
 * orchestration time. Mirrors `shared/types/role-identity.ts`
 * `RoleInstanceDescriptor`. Assembled at spawn time from data that already
 * exists — no new store, no new lifecycle. Assembly is best-effort.
 */
export type RoleInstanceDescriptor = {
  roleName: string;
  roleOrigin: RoleOrigin;
  contractVersion?: string;
  roleInstanceId: string;
  agentId: string;
  childSessionKey: string;
  spawnedAt: string;
};

export type RoleRegistryIssue = RoleContractValidationIssue & {
  /**
   * Index of the offending entry in cfg.agents.roles; `-1` for a built-in
   * contract that is part of the merged registry.
   */
  index: number;
  /** Best-effort role name parsed from the raw entry. */
  name?: string;
};

export type RoleRegistry = {
  /** Roles in stable resolution order (built-ins first, config overrides applied in place). */
  roles: RoleContract[];
  byName: Map<string, RoleContract>;
  /** Names whose definition came from config rather than a built-in. */
  configRoleNames: string[];
  /** Validation issues for skipped config entries. */
  issues: RoleRegistryIssue[];
};

function readConfigRoleEntries(cfg?: RoleRegistryConfigCarrier): unknown[] {
  const roles = cfg?.agents?.roles;
  return Array.isArray(roles) ? roles : [];
}

/** Build a role registry from built-ins plus optional config-defined roles. */
export function buildRoleRegistry(cfg?: RoleRegistryConfigCarrier): RoleRegistry {
  const byName = new Map<string, RoleContract>();
  const order: string[] = [];
  for (const builtin of BUILT_IN_ROLE_CONTRACTS) {
    byName.set(builtin.name, builtin);
    order.push(builtin.name);
  }

  const issues: RoleRegistryIssue[] = [];
  const configRoleNames: string[] = [];
  const configIndexByName = new Map<string, number>();
  readConfigRoleEntries(cfg).forEach((raw, index) => {
    const role = normalizeRoleContract(raw);
    const validation = validateRoleContract(role);
    if (!validation.ok) {
      for (const issue of validation.issues) {
        issues.push({ ...issue, index, name: role.name });
      }
      return;
    }
    // Validation warnings do not block an entry, but they are diagnostics the
    // caller must see (issue #109) — an accepted role with a tool/permission
    // conflict is reported instead of being silently dropped or silently kept.
    for (const issue of validation.issues) {
      issues.push({ ...issue, index, name: role.name });
    }
    if (!byName.has(role.name)) {
      order.push(role.name);
    }
    byName.set(role.name, role);
    if (!configRoleNames.includes(role.name)) {
      configRoleNames.push(role.name);
    }
    configIndexByName.set(role.name, index);
  });

  // Post-merge diagnostics (issue #109). Handoff targets can only be resolved
  // once every role is known, so a forward reference inside the same config batch
  // and a reference to a built-in role are both valid. Built-in contracts are
  // diagnosed here as well, with index -1, because they are part of the merged
  // registry the caller sees; a config override replaces the built-in and is
  // diagnosed under its own config index instead.
  for (const name of order) {
    const role = byName.get(name);
    if (!role) {
      continue;
    }
    const index = configIndexByName.get(name) ?? -1;
    if (!configRoleNames.includes(name)) {
      for (const issue of validateRoleContract(role).issues) {
        issues.push({ ...issue, index, name });
      }
    }
    for (const field of ["handoff.to", "handoff.from"] as const) {
      const targets = field === "handoff.to" ? role.handoff.to : role.handoff.from;
      for (const target of targets) {
        if (!byName.has(target)) {
          issues.push({
            index,
            name,
            path: field,
            severity: "warning",
            message:
              `${field} target "${target}" is not a known role in this registry ` +
              "(built-in or config-defined).",
          });
        }
      }
    }
  }

  return {
    roles: order.map((name) => byName.get(name)!).filter(Boolean),
    byName,
    configRoleNames,
    issues,
  };
}

/** List all resolved role contracts (built-in + config). */
export function listRoleContracts(cfg?: RoleRegistryConfigCarrier): RoleContract[] {
  return buildRoleRegistry(cfg).roles;
}

/** Resolve a single role contract by name, honoring config overrides. */
export function resolveRoleContract(
  name: string,
  cfg?: RoleRegistryConfigCarrier,
): RoleContract | undefined {
  if (!name) {
    return undefined;
  }
  return buildRoleRegistry(cfg).byName.get(name);
}

/**
 * Report whether a role name is `built-in` or `config`-defined, using the
 * registry's already-computed `configRoleNames` set. A config entry that
 * overrides a built-in name reports `config` (that is exactly the signal a
 * maintainer needs when debugging surprising role behavior).
 */
export function roleOrigin(name: string, registry: RoleRegistry): RoleOrigin {
  return registry.configRoleNames.includes(name) ? "config" : "built-in";
}
