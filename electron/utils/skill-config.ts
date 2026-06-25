/**
 * Skill Config Utilities
 * Direct read/write access to Verse Claw-owned skill configuration.
 * This bypasses the Gateway RPC for faster and more reliable config updates.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getDataDir, getOpenClawDir, getOpenClawResolvedDir, getOpenClawSkillsDir, getResourcesDir } from './paths';
import { logger } from './logger';
import { cpAsyncSafe } from './plugin-install';
import { withConfigLock } from './config-mutex';

const BUNDLED_OPENCLAW_SKILL_ALLOWLIST = new Set(['skill-creator']);

export interface SkillConfigUpdates {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

type SkillEntry = SkillConfigUpdates;

interface SkillStoreDocument {
    entries?: Record<string, SkillEntry>;
}

interface PreinstalledSkillSpec {
    slug: string;
    version?: string;
    autoEnable?: boolean;
}

interface PreinstalledManifest {
    skills?: PreinstalledSkillSpec[];
}

interface PreinstalledLockEntry {
    slug: string;
    version?: string;
}

interface PreinstalledLockFile {
    skills?: PreinstalledLockEntry[];
}

interface PreinstalledMarker {
    source: 'verse-claw-preinstalled';
    slug: string;
    version: string;
    installedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let skillStoreInstance: any = null;

async function getSkillStore() {
    if (!skillStoreInstance) {
        const Store = (await import('electron-store')).default;
        const options = {
            name: 'verse-claw-skills',
            projectName: 'Verse Claw',
            cwd: getDataDir(),
            defaults: {
                entries: {},
            },
        };
        skillStoreInstance = new Store<SkillStoreDocument>(
            // electron-store forwards this to conf, which requires projectName
            // outside Electron. The published types do not expose that option.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            options as any,
        );
    }
    return skillStoreInstance;
}

async function readSkillEntries(): Promise<Record<string, SkillEntry>> {
    try {
        const store = await getSkillStore();
        return { ...(store.get('entries') || {}) };
    } catch (err) {
        console.error('Failed to read Verse Claw skill config:', err);
        return {};
    }
}

async function writeSkillEntries(entries: Record<string, SkillEntry>): Promise<void> {
    const store = await getSkillStore();
    store.set('entries', entries);
}

async function setSkillsEnabled(skillKeys: string[], enabled: boolean): Promise<void> {
    if (skillKeys.length === 0) {
        return;
    }
    return withConfigLock(async () => {
        const entries = await readSkillEntries();
        for (const skillKey of skillKeys) {
            const entry = entries[skillKey] || {};
            entry.enabled = enabled;
            entries[skillKey] = entry;
        }
        await writeSkillEntries(entries);
    });
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
    const entries = await readSkillEntries();
    return entries[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
function isEmptySkillEntry(entry: SkillEntry | undefined): boolean {
    if (!entry) return true;
    const hasEnabled = typeof entry.enabled === 'boolean';
    const hasApiKey = typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0;
    const hasEnv = !!entry.env && Object.keys(entry.env).length > 0;
    return !hasEnabled && !hasApiKey && !hasEnv;
}

async function applySkillConfigUpdates(
    entries: Record<string, SkillEntry>,
    updates: Array<{ skillKey: string; remove?: boolean } & SkillConfigUpdates>,
): Promise<void> {
    for (const update of updates) {
        const skillKey = update.skillKey.trim();
        if (!skillKey) continue;

        if (update.remove) {
            delete entries[skillKey];
            continue;
        }

        const entry = entries[skillKey] || {};

        if (update.enabled !== undefined) {
            entry.enabled = update.enabled;
        }

        if (update.apiKey !== undefined) {
            const trimmed = update.apiKey.trim();
            if (trimmed) {
                entry.apiKey = trimmed;
            } else {
                delete entry.apiKey;
            }
        }

        if (update.env !== undefined) {
            const newEnv: Record<string, string> = {};

            for (const [key, value] of Object.entries(update.env)) {
                const trimmedKey = key.trim();
                if (!trimmedKey) continue;

                const trimmedVal = value.trim();
                if (trimmedVal) {
                    newEnv[trimmedKey] = trimmedVal;
                }
            }

            if (Object.keys(newEnv).length > 0) {
                entry.env = newEnv;
            } else {
                delete entry.env;
            }
        }

        if (isEmptySkillEntry(entry)) {
            delete entries[skillKey];
        } else {
            entries[skillKey] = entry;
        }
    }
}

export async function updateSkillConfig(
    skillKey: string,
    updates: SkillConfigUpdates,
): Promise<{ success: boolean; error?: string }> {
    return updateSkillConfigs([{ skillKey, ...updates }]);
}

export async function updateSkillConfigs(
    updates: Array<{ skillKey: string } & SkillConfigUpdates>,
): Promise<{ success: boolean; error?: string }> {
    try {
        return await withConfigLock(async () => {
            const entries = await readSkillEntries();
            await applySkillConfigUpdates(entries, updates);
            await writeSkillEntries(entries);
            return { success: true };
        });
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

export async function removeSkillConfig(skillKey: string): Promise<{ success: boolean; error?: string }> {
    return removeSkillConfigs([skillKey]);
}

export async function removeSkillConfigs(skillKeys: string[]): Promise<{ success: boolean; removed: number; error?: string }> {
    try {
        return await withConfigLock(async () => {
            const entries = await readSkillEntries();
            const normalizedSkillKeys = skillKeys
                .map((skillKey) => skillKey.trim())
                .filter(Boolean);
            const removed = normalizedSkillKeys.filter((skillKey) => Object.prototype.hasOwnProperty.call(entries, skillKey)).length;

            if (removed === 0) {
                return { success: true, removed: 0 };
            }

            await applySkillConfigUpdates(
                entries,
                normalizedSkillKeys.map((skillKey) => ({ skillKey, remove: true })),
            );
            await writeSkillEntries(entries);
            return { success: true, removed };
        });
    } catch (err) {
        console.error('Failed to remove skill configs:', err);
        return { success: false, removed: 0, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
    return readSkillEntries();
}

function getDisallowedBundledOpenClawSkillSlugs(bundledSkillSlugs: string[]): string[] {
    return bundledSkillSlugs.filter((slug) => !BUNDLED_OPENCLAW_SKILL_ALLOWLIST.has(slug));
}

export async function trimBundledOpenClawSkills(options?: { bundledSkillsRoot?: string }): Promise<{ removed: number; removedSlugs: string[]; kept: string[] }> {
    const bundledSkillsRoot = options?.bundledSkillsRoot || join(getOpenClawResolvedDir(), 'skills');
    if (!existsSync(bundledSkillsRoot)) {
        return { removed: 0, removedSlugs: [], kept: Array.from(BUNDLED_OPENCLAW_SKILL_ALLOWLIST) };
    }

    try {
        const entries = await readdir(bundledSkillsRoot, { withFileTypes: true });
        const disallowed = getDisallowedBundledOpenClawSkillSlugs(
            entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name),
        );

        let removed = 0;
        const removedSlugs: string[] = [];
        for (const slug of disallowed) {
            const skillDir = join(bundledSkillsRoot, slug);
            if (!existsSync(join(skillDir, 'SKILL.md'))) {
                continue;
            }
            await rm(skillDir, { recursive: true, force: true });
            removed += 1;
            removedSlugs.push(slug);
        }

        return { removed, removedSlugs, kept: Array.from(BUNDLED_OPENCLAW_SKILL_ALLOWLIST) };
    } catch (error) {
        logger.warn('Failed to trim bundled OpenClaw skills:', error);
        return { removed: 0, removedSlugs: [], kept: Array.from(BUNDLED_OPENCLAW_SKILL_ALLOWLIST) };
    }
}

export async function trimBundledOpenClawSkillsAndConfigs(
    options?: { bundledSkillsRoot?: string },
): Promise<{ removed: number; removedSlugs: string[]; removedConfigs: number; kept: string[] }> {
    const trimResult = await trimBundledOpenClawSkills(options);
    const removeResult = trimResult.removedSlugs.length > 0
        ? await removeSkillConfigs(trimResult.removedSlugs)
        : { success: true, removed: 0 };

    if (!removeResult.success) {
        logger.warn(`Failed to prune stale bundled skill configs: ${removeResult.error || 'unknown error'}`);
    }

    return {
        ...trimResult,
        removedConfigs: removeResult.removed,
    };
}

/**
 * Built-in skills bundled with Verse Claw that should be pre-deployed to
 * the Verse Claw-managed skills directory on first launch. These come from the openclaw package's
 * extensions directory and are available in both dev and packaged builds.
 */
const BUILTIN_SKILLS = [] as const;

/**
 * Ensure built-in skills are deployed to the Verse Claw-managed skills directory.
 * Skips any skill that already has a SKILL.md present (idempotent).
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
    const skillsRoot = getOpenClawSkillsDir();

    for (const { slug, sourceExtension } of BUILTIN_SKILLS) {
        const targetDir = join(skillsRoot, slug);
        const targetManifest = join(targetDir, 'SKILL.md');

        if (existsSync(targetManifest)) {
            continue; // already installed
        }

        const openclawDir = getOpenClawDir();
        const sourceDir = join(openclawDir, 'extensions', sourceExtension, 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cpAsyncSafe(sourceDir, targetDir);
            logger.info(`Installed built-in skill: ${slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install built-in skill ${slug}:`, error);
        }
    }
}

const PREINSTALLED_MANIFEST_NAME = 'preinstalled-manifest.json';
const PREINSTALLED_MARKER_NAME = '.verse-claw-preinstalled.json';

async function readPreinstalledManifest(): Promise<PreinstalledSkillSpec[]> {
    const candidates = [
        join(getResourcesDir(), 'skills', PREINSTALLED_MANIFEST_NAME),
        join(process.cwd(), 'resources', 'skills', PREINSTALLED_MANIFEST_NAME),
    ];

    const manifestPath = candidates.find((p) => existsSync(p));
    if (!manifestPath) {
        return [];
    }

    try {
        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledManifest;
        if (!Array.isArray(parsed.skills)) {
            return [];
        }
        return parsed.skills.filter((s): s is PreinstalledSkillSpec => Boolean(s?.slug));
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills manifest:', error);
        return [];
    }
}

function resolvePreinstalledSkillsSourceRoot(): string | null {
    const candidates = [
        join(getResourcesDir(), 'preinstalled-skills'),
        join(process.cwd(), 'build', 'preinstalled-skills'),
        join(__dirname, '../../build/preinstalled-skills'),
    ];

    const root = candidates.find((dir) => existsSync(dir));
    return root || null;
}

async function readPreinstalledLockVersions(sourceRoot: string): Promise<Map<string, string>> {
    const lockPath = join(sourceRoot, '.preinstalled-lock.json');
    if (!existsSync(lockPath)) {
        return new Map();
    }
    try {
        const raw = await readFile(lockPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledLockFile;
        const versions = new Map<string, string>();
        for (const entry of parsed.skills || []) {
            const slug = entry.slug?.trim();
            const version = entry.version?.trim();
            if (slug && version) {
                versions.set(slug, version);
            }
        }
        return versions;
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills lock file:', error);
        return new Map();
    }
}

async function tryReadMarker(markerPath: string): Promise<PreinstalledMarker | null> {
    if (!existsSync(markerPath)) {
        return null;
    }
    try {
        const raw = await readFile(markerPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledMarker;
        if (!parsed?.slug || !parsed?.version) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Ensure third-party preinstalled skills (bundled in app resources) are
 * deployed to the Verse Claw-managed skills directory as full directories.
 *
 * Policy:
 * - If skill is missing locally, install it.
 * - If local skill exists without our marker, treat as user-managed and never overwrite.
 * - If marker exists with same version, skip.
 * - If marker exists with a different version, skip by default to avoid overwriting edits.
 */
export async function ensurePreinstalledSkillsInstalled(): Promise<void> {
    const skills = await readPreinstalledManifest();
    if (skills.length === 0) {
        return;
    }

    const sourceRoot = resolvePreinstalledSkillsSourceRoot();
    if (!sourceRoot) {
        logger.warn('Preinstalled skills source root not found; skipping preinstall.');
        return;
    }
    const lockVersions = await readPreinstalledLockVersions(sourceRoot);

    const targetRoot = getOpenClawSkillsDir();
    await mkdir(targetRoot, { recursive: true });
    const toEnable: string[] = [];

    for (const spec of skills) {
        const sourceDir = join(sourceRoot, spec.slug);
        const sourceManifest = join(sourceDir, 'SKILL.md');
        if (!existsSync(sourceManifest)) {
            logger.warn(`Preinstalled skill source missing SKILL.md, skipping: ${sourceDir}`);
            continue;
        }

        const targetDir = join(targetRoot, spec.slug);
        const targetManifest = join(targetDir, 'SKILL.md');
        const markerPath = join(targetDir, PREINSTALLED_MARKER_NAME);
        const desiredVersion = lockVersions.get(spec.slug)
            || (spec.version || 'unknown').trim()
            || 'unknown';
        const marker = await tryReadMarker(markerPath);

        if (existsSync(targetManifest)) {
            if (!marker) {
                logger.info(`Skipping user-managed skill: ${spec.slug}`);
                continue;
            }
            if (marker.version === desiredVersion) {
                continue;
            }
            logger.info(`Skipping preinstalled skill update for ${spec.slug} (local marker version=${marker.version}, desired=${desiredVersion})`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cpAsyncSafe(sourceDir, targetDir);
            const markerPayload: PreinstalledMarker = {
                source: 'verse-claw-preinstalled',
                slug: spec.slug,
                version: desiredVersion,
                installedAt: new Date().toISOString(),
            };
            await writeFile(markerPath, `${JSON.stringify(markerPayload, null, 2)}\n`, 'utf-8');
            if (spec.autoEnable) {
                toEnable.push(spec.slug);
            }
            logger.info(`Installed preinstalled skill: ${spec.slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install preinstalled skill ${spec.slug}:`, error);
        }
    }

    if (toEnable.length > 0) {
        try {
            await setSkillsEnabled(toEnable, true);
        } catch (error) {
            logger.warn('Failed to auto-enable preinstalled skills:', error);
        }
    }
}
