import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { readOpenClawConfig, writeOpenClawConfig, type OpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import type {
  RoleConfigPermissions,
  RoleConfigRoleSummary,
  RoleUpsertConfigRolePayload,
} from '@shared/host-api/contract';

type ConfigRoleEntry = RoleConfigRoleSummary & {
  model: { default: null; fallback: string[]; provider: null };
  outputSchema: { format: 'markdown'; sections: string[] };
  handoff: { to: string[]; from: string[]; requiresReview: boolean };
};

type OpenClawConfigWithRoles = OpenClawConfig & {
  agents?: Record<string, unknown> & {
    roles?: unknown;
  };
};

const CONFIG_ROLE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const BUILT_IN_ROLE_NAMES = new Set([
  'architect',
  'implementer',
  'reviewer',
  'tester',
  'researcher',
  'planner',
  'documenter',
  'devops',
]);

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizePermissions(value: RoleConfigPermissions | undefined): RoleConfigRoleSummary['permissions'] {
  return {
    filesystem: value?.filesystem ?? 'read',
    network: value?.network ?? 'limited',
    commands: stringList(value?.commands),
    ...(value?.readPaths ? { readPaths: stringList(value.readPaths) } : {}),
    ...(value?.writePaths ? { writePaths: stringList(value.writePaths) } : {}),
  };
}

function validatePayload(payload: RoleUpsertConfigRolePayload): void {
  if (!CONFIG_ROLE_NAME_PATTERN.test(payload.name)) {
    throw new Error('Role name must match /^[a-z][a-z0-9-]{1,63}$/');
  }
  if (BUILT_IN_ROLE_NAMES.has(payload.name)) {
    throw new Error('Cannot overwrite built-in role');
  }
  if (!payload.displayName?.trim()) {
    throw new Error('displayName is required');
  }
  if (!payload.rolePrompt?.trim()) {
    throw new Error('rolePrompt is required');
  }
  if (!['low', 'medium', 'high'].includes(payload.effort)) {
    throw new Error('effort must be one of low, medium, high');
  }
}

function toConfigRole(payload: RoleUpsertConfigRolePayload): ConfigRoleEntry {
  const summary: RoleConfigRoleSummary = {
    name: payload.name.trim(),
    displayName: payload.displayName.trim(),
    ...(payload.description?.trim() ? { description: payload.description.trim() } : {}),
    rolePrompt: payload.rolePrompt.trim(),
    tools: stringList(payload.tools),
    effort: payload.effort,
    permissions: normalizePermissions(payload.permissions),
    tags: stringList(payload.tags),
    origin: 'config',
  };
  return {
    ...summary,
    model: { default: null, fallback: [], provider: null },
    outputSchema: { format: 'markdown', sections: [] },
    handoff: { to: [], from: [], requiresReview: true },
  };
}

function ensureAgentsConfig(config: OpenClawConfigWithRoles): Record<string, unknown> & { roles?: unknown } {
  if (!config.agents || typeof config.agents !== 'object' || Array.isArray(config.agents)) {
    config.agents = {};
  }
  return config.agents;
}

function readExistingRoles(config: OpenClawConfigWithRoles): unknown[] {
  const agents = ensureAgentsConfig(config);
  return Array.isArray(agents.roles) ? agents.roles : [];
}

function readRoleName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = (value as Record<string, unknown>).name;
  return typeof name === 'string' ? name : null;
}

export function createRolesApi(): CompleteHostServiceRegistry['roles'] {
  return {
    upsertConfigRole: async (payload) => {
      validatePayload(payload);
      const role = toConfigRole(payload);

      await withConfigLock(async () => {
        const config = await readOpenClawConfig() as OpenClawConfigWithRoles;
        const agents = ensureAgentsConfig(config);
        const existing = readExistingRoles(config)
          .filter((entry) => readRoleName(entry) !== role.name);
        agents.roles = [...existing, role];
        await writeOpenClawConfig(config);
      });

      return {
        success: true,
        role,
        pendingRuntimeRefresh: true,
      };
    },
  };
}
