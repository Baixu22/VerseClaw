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

export type RoleRegistryIssue = RoleContractValidationIssue & {
  /** Index of the offending entry in cfg.agents.roles. */
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
  readConfigRoleEntries(cfg).forEach((raw, index) => {
    const role = normalizeRoleContract(raw);
    const validation = validateRoleContract(role);
    if (!validation.ok) {
      for (const issue of validation.issues) {
        issues.push({ ...issue, index, name: role.name });
      }
      return;
    }
    if (!byName.has(role.name)) {
      order.push(role.name);
    }
    byName.set(role.name, role);
    if (!configRoleNames.includes(role.name)) {
      configRoleNames.push(role.name);
    }
  });

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
