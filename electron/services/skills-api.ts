import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import { findCatalogEntry, searchCatalog } from '../gateway/skill-catalog';
import {
  installSkillFromCatalog,
  resolveInstalledSkillDir,
  verifyInstalledSkillIntegrity,
} from '../gateway/skill-installer';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getAllSkillConfigs, getSkillConfig, updateSkillConfig, updateSkillConfigs } from '../utils/skill-config';
import {
  collectQuickAccessSkills,
  filterEnabledQuickAccessSkills,
} from '../utils/skill-quick-access';
import { listLocalSkills } from './skills/local-skill-service';
import { isRecord } from './payload-utils';

type SkillConfigPayload = {
  skillKey?: unknown;
  enabled?: unknown;
  apiKey?: unknown;
  env?: unknown;
};

type SkillConfigsPayload = {
  updates?: unknown;
};

type NormalizedSkillConfigUpdate = {
  skillKey: string;
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
};

type QuickAccessPayload = {
  workspace?: unknown;
};

type SkillOpenPayload = {
  slug?: unknown;
  skillKey?: unknown;
  baseDir?: unknown;
};

const WORK_MODE_INSTALLABLE_CATALOG_SLUGS = new Set([
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'frontend-design',
  'web-artifacts-builder',
]);

/** Requested versions are forwarded to the installer, which decides whether they are a real git ref. */
const MAX_REQUESTED_SKILL_VERSION_LENGTH = 120;

function getRequestedVersion(payload: unknown): string | undefined {
  const body = isRecord(payload) ? payload as { version?: unknown } : {};
  if (typeof body.version !== 'string') return undefined;
  const version = body.version.trim();
  if (!version || version.length > MAX_REQUESTED_SKILL_VERSION_LENGTH) return undefined;
  return version;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSkillKey(payload: unknown): string {
  const body = isRecord(payload) ? payload as SkillConfigPayload : {};
  if (typeof body.skillKey !== 'string' || !body.skillKey.trim()) {
    throw new Error('skillKey is required');
  }
  return body.skillKey.trim();
}

function getEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function getConfigUpdate(payload: unknown): NormalizedSkillConfigUpdate {
  const body = isRecord(payload) ? payload as SkillConfigPayload : {};
  return {
    skillKey: getSkillKey(payload),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    env: getEnv(body.env),
  };
}

function getConfigUpdates(payload: unknown): NormalizedSkillConfigUpdate[] {
  const body = isRecord(payload) ? payload as SkillConfigsPayload : {};
  if (!Array.isArray(body.updates)) return [];
  return body.updates.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const skillKey = typeof entry.skillKey === 'string' ? entry.skillKey.trim() : '';
    if (!skillKey) return [];
    return [{
      skillKey,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
      apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
      env: getEnv(entry.env),
    }];
  });
}

function getCatalogSlug(payload: unknown): string {
  const body = isRecord(payload) ? payload as { slug?: unknown } : {};
  if (typeof body.slug !== 'string' || !body.slug.trim()) {
    throw new Error('slug is required');
  }
  const slug = body.slug.trim();
  if (!WORK_MODE_INSTALLABLE_CATALOG_SLUGS.has(slug)) {
    throw new Error(`Skill "${slug}" is not available from the built-in Work Mode catalog.`);
  }
  return slug;
}

export function createSkillsApi({
  clawHubService,
  gatewayManager,
}: {
  clawHubService: ClawHubService;
  gatewayManager: GatewayManager;
}): CompleteHostServiceRegistry['skills'] {
  return {
    local: async () => ({ success: true, skills: await listLocalSkills() }),
    configs: async () => getAllSkillConfigs(),
    allConfigs: async () => getAllSkillConfigs(),
    getConfig: async (payload) => {
      const config = await getSkillConfig(getSkillKey(payload));
      return config ? { ...config } : undefined;
    },
    updateConfig: async (payload) => {
      const { skillKey, ...updates } = getConfigUpdate(payload);
      return updateSkillConfig(skillKey, updates);
    },
    updateConfigs: async (payload) => updateSkillConfigs(getConfigUpdates(payload)),
    status: async () => {
      const skills = await listLocalSkills();
      return {
        skills: skills.map((skill) => ({
          skillKey: skill.id,
          slug: skill.id,
          name: skill.name,
          description: skill.description,
          disabled: !skill.enabled,
          source: skill.source,
          baseDir: skill.baseDir,
          filePath: skill.filePath,
          bundled: skill.isCore,
        })),
      };
    },
    update: async (payload) => gatewayManager.rpc('skills.update', isRecord(payload) ? payload : {}),
    quickAccess: async (payload) => {
      const body = isRecord(payload) ? payload as QuickAccessPayload : {};
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
        }),
        getAllSkillConfigs(),
      ]);
      return {
        success: true,
        skills: filterEnabledQuickAccessSkills(scannedSkills, undefined, configs),
      };
    },
    clawhubCapability: async () => {
      try {
        const marketplaceCapability = await clawHubService.getMarketplaceCapability();
        return {
          success: true,
          capability: {
            ...marketplaceCapability,
            builtInCatalog: true,
            installableSlugs: [...WORK_MODE_INSTALLABLE_CATALOG_SLUGS],
          },
        };
      } catch (error) {
        return {
          success: true,
          capability: {
            available: true,
            provider: 'built-in',
            builtInCatalog: true,
            installableSlugs: [...WORK_MODE_INSTALLABLE_CATALOG_SLUGS],
            fallbackReason: errorMessage(error),
          },
        };
      }
    },
    clawhubList: async () => {
      try {
        return { success: true, results: await clawHubService.listInstalled() };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubSearch: async (payload) => {
      const body = isRecord(payload) ? payload as { query?: unknown } : {};
      const query = typeof body.query === 'string' ? body.query : '';
      const results = searchCatalog(query)
        .filter((entry) => WORK_MODE_INSTALLABLE_CATALOG_SLUGS.has(entry.slug))
        .map((entry) => ({
          slug: entry.slug,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          author: entry.author,
        }));
      return { success: true, results };
    },
    clawhubInstall: async (payload) => {
      try {
        const slug = getCatalogSlug(payload);
        const entry = findCatalogEntry(slug);
        if (!entry) {
          throw new Error(`Skill "${slug}" was not found in the built-in catalog.`);
        }
        const requestedVersion = getRequestedVersion(payload);
        const identity = await installSkillFromCatalog(entry, requestedVersion);
        // Explicit trust gate (issue #131): Main never enables a skill whose
        // recorded byte identity does not match what is actually on disk.
        const integrity = verifyInstalledSkillIntegrity(resolveInstalledSkillDir(slug));
        if (!integrity.verified) {
          throw new Error(
            `Skill "${slug}" failed integrity verification (${integrity.reason}); it was not enabled.`,
          );
        }
        console.log(
          `[skills] Install verified for ${slug}: ref=${identity.trackedRef} ` +
            `digest=sha256:${identity.contentDigest.slice(0, 12)}… ` +
            `declaredVersion=${identity.declaredCatalogVersion} requested=${identity.requestedVersionStatus}`,
        );
        const saved = await updateSkillConfig(slug, { enabled: true });
        if (!saved.success) throw new Error(saved.error || 'Failed to enable installed skill');
        return { success: true, result: null };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubUninstall: async (payload) => {
      try {
        const slug = isRecord(payload) && typeof payload.slug === 'string' ? payload.slug.trim() : '';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(slug)) throw new Error('Invalid managed skill slug');
        await clawHubService.uninstall({ slug });
        return { success: true, result: null };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillReadme: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as SkillOpenPayload : {};
        const skillKey = typeof body.skillKey === 'string' ? body.skillKey : '';
        const slug = typeof body.slug === 'string' ? body.slug : undefined;
        const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
        await clawHubService.openSkillReadme(skillKey || slug || '', slug, baseDir);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillPath: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as SkillOpenPayload : {};
        const skillKey = typeof body.skillKey === 'string' ? body.skillKey : '';
        const slug = typeof body.slug === 'string' ? body.slug : undefined;
        const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
        await clawHubService.openSkillPath(skillKey || slug || '', slug, baseDir);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}
